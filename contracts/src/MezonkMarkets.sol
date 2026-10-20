// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import {IMezonkMarkets} from "./interfaces/IMezonkMarkets.sol";
import {FPMMMath} from "./libraries/FPMMMath.sol";

/// @title MezonkMarkets
/// @notice Non-custodial binary prediction markets settled in a single collateral token (MUSD on Mezo).
///
/// Mechanism
///  - Every YES/NO pair ("complete set") is backed by exactly one unit of collateral.
///  - Each market runs a fixed-product AMM over its pool of YES and NO shares, seeded by the creator.
///  - Positions can be bought or sold back to the pool until the market closes.
///  - After close an approved resolver proposes an outcome with an evidence hash and posts a bond.
///    Anyone can dispute during the challenge window by posting a bond; the market's arbitrator rules.
///  - If nobody proposes, or the arbitrator does not rule in time, the market settles as INVALID.
///  - Settlement: winning shares pay 1 unit each. INVALID pays 0.5 per share of either side.
///
/// Trust model (also documented in docs/security-model.md)
///  - Owner: can change global config for FUTURE markets only, approve resolvers, pause new
///    markets and trades, and withdraw accrued protocol fees. Owner cannot move user collateral,
///    creator fees, bonds or change any outcome. No upgradeability.
///  - Resolver (per market, snapshotted): proposes outcomes. Cannot finalize without the challenge window.
///  - Arbitrator (per market, snapshotted): rules only on disputed proposals, within a deadline.
///  - Pausing never blocks proposals, disputes, finalization, redemption or claims.
contract MezonkMarkets is IMezonkMarkets, Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint16 public constant MAX_FEE_BPS = 500; // 5%
    uint16 public constant MIN_YES_PROB_BPS = 500;
    uint16 public constant MAX_YES_PROB_BPS = 9500;
    uint32 public constant MIN_CHALLENGE_WINDOW = 1 hours;
    uint32 public constant MAX_WINDOW = 30 days;
    uint256 public constant MAX_METADATA_BYTES = 8192;

    /// @notice Settlement collateral. Fixed at deployment; never inferred from a symbol.
    IERC20 public immutable collateralToken;

    Config public config;
    uint256 public marketCount;
    uint256 public protocolFees;

    mapping(address => bool) public isResolver;
    /// @notice Wallets allowed to publish markets (each publication also needs a curator approval).
    mapping(address => bool) public isCreator;
    /// @notice Wallets (EOAs or ERC-1271 contracts such as a Safe) whose approvals authorize publication.
    mapping(address => bool) public isCurator;
    /// @notice Consumed approval nonces. An approval can publish at most one market.
    mapping(bytes32 => bool) public approvalUsed;

    bytes32 public constant MARKET_APPROVAL_TYPEHASH = keccak256(
        "MarketApproval(bytes32 metadataHash,address creator,address resolver,uint64 closeTime,uint64 deadline,bytes32 nonce)"
    );
    mapping(uint256 => Market) internal _markets;
    mapping(uint256 => mapping(address => uint256)) public yesBalance;
    mapping(uint256 => mapping(address => uint256)) public noBalance;
    /// @notice Bonds returned or won, withdrawable by the account (pull payments).
    mapping(address => uint256) public bondCredits;

    constructor(IERC20 collateral_, address owner_, Config memory config_)
        Ownable(owner_)
        EIP712("MEZONK Markets", "1")
    {
        if (address(collateral_) == address(0)) revert InvalidParams();
        collateralToken = collateral_;
        _setConfig(config_);
    }

    // ───────────────────────────── Views ─────────────────────────────

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return _market(marketId);
    }

    function stageOf(uint256 marketId) public view returns (Stage) {
        return _stage(_market(marketId));
    }

    /// @notice YES price in 1e18 fixed point (equals the implied YES probability before fees).
    function priceYes(uint256 marketId) external view returns (uint256) {
        Market storage m = _market(marketId);
        uint256 total = m.poolYes + m.poolNo;
        // After the creator claims liquidity both pools are empty; report the settlement price instead of reverting.
        if (total == 0) {
            if (m.finalOutcome == Outcome.Yes) return 1e18;
            if (m.finalOutcome == Outcome.No) return 0;
            return 5e17;
        }
        return Math.mulDiv(m.poolNo, 1e18, total);
    }

    function quoteBuy(uint256 marketId, bool isYes, uint256 amountIn)
        external
        view
        returns (uint256 sharesOut, uint256 fee)
    {
        Market storage m = _market(marketId);
        fee = (amountIn * m.feeBps) / BPS;
        (sharesOut,,) = isYes
            ? FPMMMath.buy(m.poolYes, m.poolNo, amountIn - fee)
            : FPMMMath.buy(m.poolNo, m.poolYes, amountIn - fee);
    }

    function quoteSell(uint256 marketId, bool isYes, uint256 sharesIn)
        external
        view
        returns (uint256 collateralOut, uint256 fee)
    {
        Market storage m = _market(marketId);
        (uint256 gross,,) = isYes
            ? FPMMMath.sell(m.poolYes, m.poolNo, sharesIn)
            : FPMMMath.sell(m.poolNo, m.poolYes, sharesIn);
        fee = (gross * m.feeBps) / BPS;
        collateralOut = gross - fee;
    }

    /// @notice What `account` would receive from `redeem` right now (0 if not finalized).
    function claimable(uint256 marketId, address account) external view returns (uint256) {
        Market storage m = _market(marketId);
        if (!m.finalized) return 0;
        return _payout(m.finalOutcome, yesBalance[marketId][account], noBalance[marketId][account]);
    }

    // ───────────────────────────── Creation ─────────────────────────────

    /// @notice Publish a reviewed market. Requires an approved creator and a matching, unused, unexpired
    ///         approval signed by an approved curator who is not the creator.
    function createMarket(
        CreateParams calldata p,
        MarketApproval calldata approval,
        address curator,
        bytes calldata signature
    ) external nonReentrant whenNotPaused returns (uint256 marketId) {
        Config memory c = config;
        uint256 metaLen = bytes(p.metadata).length;
        if (metaLen == 0 || metaLen > MAX_METADATA_BYTES) revert InvalidParams();
        if (p.closeTime < block.timestamp + c.minDuration || p.closeTime > block.timestamp + c.maxDuration) {
            revert InvalidParams();
        }
        if (!isResolver[p.resolver]) revert NotResolver();
        if (p.initialLiquidity < c.minLiquidity) revert InvalidParams();
        if (p.initialYesProbBps < MIN_YES_PROB_BPS || p.initialYesProbBps > MAX_YES_PROB_BPS) {
            revert InvalidParams();
        }
        _consumeApproval(p, approval, curator, signature);

        marketId = ++marketCount;
        (uint256 lpYes, uint256 lpNo) = _initMarket(marketId, p, c);
        _pull(msg.sender, p.initialLiquidity);
        _emitCreated(marketId, p, lpYes, lpNo);
        emit MarketApprovalUsed(marketId, curator, approval.nonce);
    }

    /// @notice Voids an approval before it is used. A curator can only void its own nonces in effect (a nonce
    /// it never signed is meaningless to void); the owner may void any. Used when a review is withdrawn.
    function cancelApproval(bytes32 nonce) external {
        if (!isCurator[msg.sender] && msg.sender != owner()) revert NotCurator();
        if (approvalUsed[nonce]) revert ApprovalUsed();
        approvalUsed[nonce] = true;
        emit MarketApprovalCancelled(msg.sender, nonce);
    }

    /// @notice EIP-712 digest a curator signs for `approval`.
    function approvalDigest(MarketApproval calldata a) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    MARKET_APPROVAL_TYPEHASH,
                    a.metadataHash,
                    a.creator,
                    a.resolver,
                    a.closeTime,
                    a.deadline,
                    a.nonce
                )
            )
        );
    }

    function _consumeApproval(
        CreateParams calldata p,
        MarketApproval calldata a,
        address curator,
        bytes calldata signature
    ) internal {
        if (!isCreator[msg.sender]) revert NotApprovedCreator();
        if (!isCurator[curator]) revert NotCurator();
        if (curator == msg.sender) revert SelfApproval();
        if (block.timestamp > a.deadline) revert ApprovalExpired();
        if (approvalUsed[a.nonce]) revert ApprovalUsed();
        if (
            a.creator != msg.sender || a.resolver != p.resolver || a.closeTime != p.closeTime
                || a.metadataHash != keccak256(bytes(p.metadata))
        ) revert ApprovalMismatch();
        if (!SignatureChecker.isValidSignatureNow(curator, approvalDigest(a), signature)) {
            revert BadApprovalSignature();
        }
        approvalUsed[a.nonce] = true;
    }

    function _initMarket(uint256 marketId, CreateParams calldata p, Config memory c)
        internal
        returns (uint256 lpYes, uint256 lpNo)
    {
        uint256 poolYes;
        uint256 poolNo;
        (poolYes, poolNo, lpYes, lpNo) = FPMMMath.initialPool(p.initialLiquidity, p.initialYesProbBps);
        if (poolYes == 0 || poolNo == 0) revert InvalidParams();

        Market storage m = _markets[marketId];
        m.creator = msg.sender;
        m.resolver = p.resolver;
        m.arbitrator = c.arbitrator;
        m.createdAt = uint64(block.timestamp);
        m.closeTime = p.closeTime;
        m.feeBps = c.feeBps;
        m.protocolFeeShareBps = c.protocolFeeShareBps;
        m.proposalWindow = c.proposalWindow;
        m.challengeWindow = c.challengeWindow;
        m.arbitrationWindow = c.arbitrationWindow;
        m.proposerBond = c.proposerBond;
        m.disputeBond = c.disputeBond;
        m.poolYes = poolYes;
        m.poolNo = poolNo;
        m.collateral = p.initialLiquidity;
        m.metadataHash = keccak256(bytes(p.metadata));

        if (lpYes > 0) yesBalance[marketId][msg.sender] = lpYes;
        if (lpNo > 0) noBalance[marketId][msg.sender] = lpNo;
    }

    function _emitCreated(uint256 marketId, CreateParams calldata p, uint256 lpYes, uint256 lpNo) internal {
        emit MarketCreated(
            marketId, msg.sender, p.resolver, _markets[marketId], p.initialYesProbBps, lpYes, lpNo, p.metadata
        );
    }

    // ───────────────────────────── Trading ─────────────────────────────

    function buy(uint256 marketId, bool isYes, uint256 amountIn, uint256 minSharesOut, uint256 deadline)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 sharesOut)
    {
        if (block.timestamp > deadline) revert Expired();
        Market storage m = _market(marketId);
        if (block.timestamp >= m.closeTime) revert NotTradable();

        uint256 fee = (amountIn * m.feeBps) / BPS;
        uint256 netIn = amountIn - fee;

        if (isYes) {
            (sharesOut, m.poolYes, m.poolNo) = FPMMMath.buy(m.poolYes, m.poolNo, netIn);
            yesBalance[marketId][msg.sender] += sharesOut;
        } else {
            (sharesOut, m.poolNo, m.poolYes) = FPMMMath.buy(m.poolNo, m.poolYes, netIn);
            noBalance[marketId][msg.sender] += sharesOut;
        }
        if (sharesOut < minSharesOut || sharesOut == 0) revert Slippage();

        m.collateral += netIn;
        _accrueFee(m, fee);
        _pull(msg.sender, amountIn);

        emit Trade(marketId, msg.sender, isYes, true, amountIn, fee, sharesOut, m.poolYes, m.poolNo);
    }

    function sell(uint256 marketId, bool isYes, uint256 sharesIn, uint256 minCollateralOut, uint256 deadline)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 collateralOut)
    {
        if (block.timestamp > deadline) revert Expired();
        Market storage m = _market(marketId);
        if (block.timestamp >= m.closeTime) revert NotTradable();

        uint256 gross;
        if (isYes) {
            yesBalance[marketId][msg.sender] -= sharesIn; // reverts on insufficient balance
            (gross, m.poolYes, m.poolNo) = FPMMMath.sell(m.poolYes, m.poolNo, sharesIn);
        } else {
            noBalance[marketId][msg.sender] -= sharesIn;
            (gross, m.poolNo, m.poolYes) = FPMMMath.sell(m.poolNo, m.poolYes, sharesIn);
        }

        uint256 fee = (gross * m.feeBps) / BPS;
        collateralOut = gross - fee;
        if (collateralOut < minCollateralOut || collateralOut == 0) revert Slippage();

        m.collateral -= gross;
        _accrueFee(m, fee);
        collateralToken.safeTransfer(msg.sender, collateralOut);

        emit Trade(marketId, msg.sender, isYes, false, gross, fee, sharesIn, m.poolYes, m.poolNo);
    }

    // ───────────────────────────── Resolution ─────────────────────────────

    function proposeOutcome(
        uint256 marketId,
        Outcome outcome,
        bytes32 evidenceHash,
        string calldata evidenceURI
    ) external nonReentrant {
        Market storage m = _market(marketId);
        if (msg.sender != m.resolver) revert NotResolver();
        Stage s = _stage(m);
        if (s != Stage.Closed) revert WrongStage(s);
        if (block.timestamp >= uint256(m.closeTime) + m.proposalWindow) revert WindowClosed();
        if (outcome == Outcome.None) revert InvalidOutcome();
        if (evidenceHash == bytes32(0)) revert InvalidParams();

        m.proposedOutcome = outcome;
        m.proposedAt = uint64(block.timestamp);
        _pull(msg.sender, m.proposerBond);

        emit OutcomeProposed(
            marketId,
            msg.sender,
            outcome,
            evidenceHash,
            evidenceURI,
            uint64(block.timestamp) + m.challengeWindow
        );
    }

    function dispute(uint256 marketId, bytes32 evidenceHash, string calldata evidenceURI)
        external
        nonReentrant
    {
        Market storage m = _market(marketId);
        Stage s = _stage(m);
        if (s != Stage.Proposed) revert WrongStage(s);
        if (block.timestamp >= uint256(m.proposedAt) + m.challengeWindow) revert WindowClosed();
        // Neither party to the ruling may open it: the resolver cannot challenge itself and the arbitrator
        // cannot create the dispute it then rules on (and collect the proposer bond).
        if (msg.sender == m.resolver || msg.sender == m.arbitrator) revert InvalidParams();
        if (evidenceHash == bytes32(0)) revert InvalidParams();

        m.disputer = msg.sender;
        m.disputedAt = uint64(block.timestamp);
        _pull(msg.sender, m.disputeBond);

        emit OutcomeDisputed(
            marketId, msg.sender, evidenceHash, evidenceURI, uint64(block.timestamp) + m.arbitrationWindow
        );
    }

    /// @notice Arbitrator ruling on a disputed proposal. The bond loser's bond goes to the winner.
    /// @param rationaleHash keccak256 of the published rationale document (required, non-zero).
    /// @param rationaleURI Where the rationale document can be read.
    function arbitrate(uint256 marketId, Outcome outcome, bytes32 rationaleHash, string calldata rationaleURI)
        external
        nonReentrant
    {
        Market storage m = _market(marketId);
        if (msg.sender != m.arbitrator) revert NotArbitrator();
        Stage s = _stage(m);
        if (s != Stage.Disputed) revert WrongStage(s);
        if (block.timestamp >= uint256(m.disputedAt) + m.arbitrationWindow) revert WindowClosed();
        if (outcome == Outcome.None) revert InvalidOutcome();
        if (rationaleHash == bytes32(0)) revert InvalidParams();

        uint256 bonds = uint256(m.proposerBond) + m.disputeBond;
        address winner = outcome == m.proposedOutcome ? m.resolver : m.disputer;
        _creditBond(marketId, winner, bonds);

        emit DisputeArbitrated(marketId, msg.sender, outcome, rationaleHash, rationaleURI);
        _finalize(marketId, m, outcome, FinalizeReason.Arbitrated);
    }

    /// @notice Permissionless finalization once a deadline has passed.
    ///  - Proposed and challenge window elapsed undisputed: proposal becomes final, bond refunded.
    ///  - Closed and no proposal within the proposal window: INVALID.
    ///  - Disputed and the arbitrator missed its deadline: INVALID, both bonds refunded.
    function finalize(uint256 marketId) external nonReentrant {
        Market storage m = _market(marketId);
        Stage s = _stage(m);
        if (s == Stage.Proposed) {
            if (block.timestamp < uint256(m.proposedAt) + m.challengeWindow) revert WindowOpen();
            _creditBond(marketId, m.resolver, m.proposerBond);
            _finalize(marketId, m, m.proposedOutcome, FinalizeReason.Undisputed);
        } else if (s == Stage.Closed) {
            if (block.timestamp < uint256(m.closeTime) + m.proposalWindow) revert WindowOpen();
            _finalize(marketId, m, Outcome.Invalid, FinalizeReason.NoProposal);
        } else if (s == Stage.Disputed) {
            if (block.timestamp < uint256(m.disputedAt) + m.arbitrationWindow) revert WindowOpen();
            _creditBond(marketId, m.resolver, m.proposerBond);
            _creditBond(marketId, m.disputer, m.disputeBond);
            _finalize(marketId, m, Outcome.Invalid, FinalizeReason.ArbitrationTimeout);
        } else {
            revert WrongStage(s);
        }
    }

    // ───────────────────────────── Settlement ─────────────────────────────

    /// @notice Burn all of the caller's shares in a finalized market and pay out collateral.
    function redeem(uint256 marketId) external nonReentrant returns (uint256 payout) {
        Market storage m = _market(marketId);
        if (!m.finalized) revert WrongStage(_stage(m));
        uint256 y = yesBalance[marketId][msg.sender];
        uint256 n = noBalance[marketId][msg.sender];
        if (y == 0 && n == 0) revert NothingToClaim();

        yesBalance[marketId][msg.sender] = 0;
        noBalance[marketId][msg.sender] = 0;
        payout = _payout(m.finalOutcome, y, n);
        m.collateral -= payout;
        if (payout > 0) collateralToken.safeTransfer(msg.sender, payout);

        emit Redeemed(marketId, msg.sender, y, n, payout);
    }

    /// @notice Creator redeems the pool's remaining shares after finalization.
    function claimLiquidity(uint256 marketId) external nonReentrant returns (uint256 payout) {
        Market storage m = _market(marketId);
        if (msg.sender != m.creator) revert NotCreator();
        if (!m.finalized) revert WrongStage(_stage(m));
        if (m.liquidityClaimed) revert NothingToClaim();

        m.liquidityClaimed = true;
        payout = _payout(m.finalOutcome, m.poolYes, m.poolNo);
        m.poolYes = 0;
        m.poolNo = 0;
        m.collateral -= payout;
        if (payout > 0) collateralToken.safeTransfer(msg.sender, payout);

        emit LiquidityClaimed(marketId, msg.sender, payout);
    }

    function claimCreatorFees(uint256 marketId) external nonReentrant returns (uint256 amount) {
        Market storage m = _market(marketId);
        if (msg.sender != m.creator) revert NotCreator();
        amount = m.creatorFees;
        if (amount == 0) revert NothingToClaim();
        m.creatorFees = 0;
        collateralToken.safeTransfer(msg.sender, amount);
        emit CreatorFeesClaimed(marketId, msg.sender, amount);
    }

    function withdrawBond() external nonReentrant returns (uint256 amount) {
        amount = bondCredits[msg.sender];
        if (amount == 0) revert NothingToClaim();
        bondCredits[msg.sender] = 0;
        collateralToken.safeTransfer(msg.sender, amount);
        emit BondWithdrawn(msg.sender, amount);
    }

    // ───────────────────────────── Admin ─────────────────────────────

    /// @notice Applies to markets created after this call only.
    function setConfig(Config calldata config_) external onlyOwner {
        _setConfig(config_);
    }

    function setCreator(address creator, bool approved) external onlyOwner {
        if (creator == address(0)) revert InvalidParams();
        isCreator[creator] = approved;
        emit CreatorUpdated(creator, approved);
    }

    function setCurator(address curator, bool approved) external onlyOwner {
        if (curator == address(0)) revert InvalidParams();
        isCurator[curator] = approved;
        emit CuratorUpdated(curator, approved);
    }

    function setResolver(address resolver, bool approved) external onlyOwner {
        if (resolver == address(0)) revert InvalidParams();
        isResolver[resolver] = approved;
        emit ResolverUpdated(resolver, approved);
    }

    /// @notice Pauses market creation and trading only. Resolution and all claims stay available.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Withdraws accrued protocol fees. Cannot touch collateral, creator fees or bonds.
    function withdrawProtocolFees(address to) external onlyOwner nonReentrant {
        uint256 amount = protocolFees;
        if (amount == 0) revert NothingToClaim();
        if (to == address(0)) revert InvalidParams();
        protocolFees = 0;
        collateralToken.safeTransfer(to, amount);
        emit ProtocolFeesWithdrawn(to, amount);
    }

    // ───────────────────────────── Internals ─────────────────────────────

    function _market(uint256 marketId) internal view returns (Market storage m) {
        m = _markets[marketId];
        if (m.creator == address(0)) revert UnknownMarket();
    }

    function _stage(Market storage m) internal view returns (Stage) {
        if (m.finalized) return Stage.Finalized;
        if (m.disputedAt != 0) return Stage.Disputed;
        if (m.proposedAt != 0) return Stage.Proposed;
        if (block.timestamp >= m.closeTime) return Stage.Closed;
        return Stage.Open;
    }

    function _finalize(uint256 marketId, Market storage m, Outcome outcome, FinalizeReason reason) internal {
        m.finalized = true;
        m.finalOutcome = outcome;
        emit MarketFinalized(marketId, outcome, reason);
    }

    function _payout(Outcome outcome, uint256 y, uint256 n) internal pure returns (uint256) {
        if (outcome == Outcome.Yes) return y;
        if (outcome == Outcome.No) return n;
        if (outcome == Outcome.Invalid) return (y + n) / 2;
        return 0;
    }

    function _accrueFee(Market storage m, uint256 fee) internal {
        if (fee == 0) return;
        uint256 protocolPart = (fee * m.protocolFeeShareBps) / BPS;
        protocolFees += protocolPart;
        m.creatorFees += fee - protocolPart;
    }

    function _creditBond(uint256 marketId, address account, uint256 amount) internal {
        if (amount == 0) return;
        bondCredits[account] += amount;
        emit BondCredited(marketId, account, amount);
    }

    /// @dev Rejects fee-on-transfer or otherwise non-standard tokens by checking the received amount.
    function _pull(address from, uint256 amount) internal {
        if (amount == 0) return;
        uint256 before = collateralToken.balanceOf(address(this));
        collateralToken.safeTransferFrom(from, address(this), amount);
        if (collateralToken.balanceOf(address(this)) - before != amount) revert UnsupportedToken();
    }

    function _setConfig(Config memory c) internal {
        if (
            c.feeBps > MAX_FEE_BPS || c.protocolFeeShareBps > BPS || c.minDuration == 0
                || c.maxDuration < c.minDuration || c.maxDuration > 730 days || c.proposalWindow == 0
                || c.proposalWindow > MAX_WINDOW || c.challengeWindow < MIN_CHALLENGE_WINDOW
                || c.challengeWindow > MAX_WINDOW || c.arbitrationWindow == 0
                || c.arbitrationWindow > MAX_WINDOW || c.minLiquidity == 0 || c.disputeBond == 0
                || c.arbitrator == address(0)
        ) revert InvalidConfig();
        config = c;
        emit ConfigUpdated(c);
    }
}
