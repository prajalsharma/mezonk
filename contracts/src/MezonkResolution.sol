// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IMezonkExchange} from "./interfaces/IMezonkExchange.sol";

interface IExchangeSettle {
    function getMarket(uint256 marketId) external view returns (IMezonkExchange.Market memory);
    function stageOf(uint256 marketId) external view returns (IMezonkExchange.Stage);
    function settle(uint256 marketId, IMezonkExchange.Outcome outcome) external;
    function collateralToken() external view returns (IERC20);
}

/// @title MezonkResolution
/// @notice Optimistic resolution for MezonkExchange markets, unchanged in substance from the audited v1 module:
///  - After close the market's resolver proposes an outcome with an evidence hash and posts a bond.
///  - Anyone except the resolver and arbitrator can dispute during the challenge window by posting a bond.
///  - The market's arbitrator rules within the arbitration window; the bond loser's bond goes to the winner.
///  - No proposal in time, or no ruling in time, settles INVALID (0.5 per share). Bonds are refunded on timeout.
/// Deployed by the exchange constructor; the only address the exchange accepts outcomes from.
/// Holds bonds only. Trading collateral never sits here.
contract MezonkResolution is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum RStage {
        NotClosed, // still seeding, live, or failed: nothing to resolve
        AwaitingProposal,
        Proposed,
        Disputed,
        Finalized
    }

    enum FinalizeReason {
        Undisputed,
        Arbitrated,
        NoProposal,
        ArbitrationTimeout
    }

    struct State {
        IMezonkExchange.Outcome proposedOutcome;
        uint64 proposedAt;
        uint64 disputedAt;
        address disputer;
        bool finalized;
    }

    IExchangeSettle public immutable exchange;
    IERC20 public immutable collateralToken;

    mapping(uint256 => State) public states;
    mapping(address => uint256) public bondCredits;
    uint256 public lockedBonds;
    uint256 public bondCreditsTotal;

    event OutcomeProposed(
        uint256 indexed marketId,
        address indexed resolver,
        IMezonkExchange.Outcome outcome,
        bytes32 evidenceHash,
        string evidenceURI,
        uint64 challengeDeadline
    );
    event OutcomeDisputed(
        uint256 indexed marketId,
        address indexed disputer,
        bytes32 evidenceHash,
        string evidenceURI,
        uint64 arbitrationDeadline
    );
    event DisputeArbitrated(
        uint256 indexed marketId,
        address indexed arbitrator,
        IMezonkExchange.Outcome outcome,
        bytes32 rationaleHash,
        string rationaleURI
    );
    event MarketFinalized(uint256 indexed marketId, IMezonkExchange.Outcome outcome, FinalizeReason reason);
    event BondCredited(uint256 indexed marketId, address indexed account, uint256 amount);
    event BondWithdrawn(address indexed account, uint256 amount);

    error WrongStage(RStage stage);
    error NotResolver();
    error NotArbitrator();
    error WindowClosed();
    error WindowOpen();
    error InvalidOutcome();
    error InvalidParams();
    error NothingToClaim();

    constructor(IERC20 collateral_) {
        exchange = IExchangeSettle(msg.sender);
        collateralToken = collateral_;
    }

    function stageOf(uint256 marketId) public view returns (RStage) {
        State storage s = states[marketId];
        if (s.finalized) return RStage.Finalized;
        if (s.disputedAt != 0) return RStage.Disputed;
        if (s.proposedAt != 0) return RStage.Proposed;
        if (exchange.stageOf(marketId) == IMezonkExchange.Stage.Closed) return RStage.AwaitingProposal;
        return RStage.NotClosed;
    }

    function proposeOutcome(
        uint256 marketId,
        IMezonkExchange.Outcome outcome,
        bytes32 evidenceHash,
        string calldata evidenceURI
    ) external nonReentrant {
        IMezonkExchange.Market memory m = exchange.getMarket(marketId);
        if (msg.sender != m.resolver) revert NotResolver();
        RStage st = stageOf(marketId);
        if (st != RStage.AwaitingProposal) revert WrongStage(st);
        if (block.timestamp >= uint256(m.closeTime) + m.proposalWindow) revert WindowClosed();
        if (outcome == IMezonkExchange.Outcome.None) revert InvalidOutcome();
        if (evidenceHash == bytes32(0)) revert InvalidParams();
        State storage s = states[marketId];
        s.proposedOutcome = outcome;
        s.proposedAt = uint64(block.timestamp);
        _pull(msg.sender, m.proposerBond);
        lockedBonds += m.proposerBond;
        emit OutcomeProposed(
            marketId, msg.sender, outcome, evidenceHash, evidenceURI, uint64(block.timestamp) + m.challengeWindow
        );
    }

    function dispute(uint256 marketId, bytes32 evidenceHash, string calldata evidenceURI) external nonReentrant {
        IMezonkExchange.Market memory m = exchange.getMarket(marketId);
        RStage st = stageOf(marketId);
        if (st != RStage.Proposed) revert WrongStage(st);
        State storage s = states[marketId];
        if (block.timestamp >= uint256(s.proposedAt) + m.challengeWindow) revert WindowClosed();
        if (msg.sender == m.resolver || msg.sender == m.arbitrator) revert InvalidParams();
        if (evidenceHash == bytes32(0)) revert InvalidParams();
        s.disputer = msg.sender;
        s.disputedAt = uint64(block.timestamp);
        _pull(msg.sender, m.disputeBond);
        lockedBonds += m.disputeBond;
        emit OutcomeDisputed(
            marketId, msg.sender, evidenceHash, evidenceURI, uint64(block.timestamp) + m.arbitrationWindow
        );
    }

    function arbitrate(
        uint256 marketId,
        IMezonkExchange.Outcome outcome,
        bytes32 rationaleHash,
        string calldata rationaleURI
    ) external nonReentrant {
        IMezonkExchange.Market memory m = exchange.getMarket(marketId);
        if (msg.sender != m.arbitrator) revert NotArbitrator();
        RStage st = stageOf(marketId);
        if (st != RStage.Disputed) revert WrongStage(st);
        State storage s = states[marketId];
        if (block.timestamp >= uint256(s.disputedAt) + m.arbitrationWindow) revert WindowClosed();
        if (outcome == IMezonkExchange.Outcome.None) revert InvalidOutcome();
        if (rationaleHash == bytes32(0)) revert InvalidParams();
        address winner = outcome == s.proposedOutcome ? m.resolver : s.disputer;
        _creditBond(marketId, winner, uint256(m.proposerBond) + m.disputeBond);
        emit DisputeArbitrated(marketId, msg.sender, outcome, rationaleHash, rationaleURI);
        _finalize(marketId, s, outcome, FinalizeReason.Arbitrated);
    }

    /// @notice Permissionless once a deadline has passed (see contract notice).
    function finalize(uint256 marketId) external nonReentrant {
        IMezonkExchange.Market memory m = exchange.getMarket(marketId);
        RStage st = stageOf(marketId);
        State storage s = states[marketId];
        if (st == RStage.Proposed) {
            if (block.timestamp < uint256(s.proposedAt) + m.challengeWindow) revert WindowOpen();
            _creditBond(marketId, m.resolver, m.proposerBond);
            _finalize(marketId, s, s.proposedOutcome, FinalizeReason.Undisputed);
        } else if (st == RStage.AwaitingProposal) {
            if (block.timestamp < uint256(m.closeTime) + m.proposalWindow) revert WindowOpen();
            _finalize(marketId, s, IMezonkExchange.Outcome.Invalid, FinalizeReason.NoProposal);
        } else if (st == RStage.Disputed) {
            if (block.timestamp < uint256(s.disputedAt) + m.arbitrationWindow) revert WindowOpen();
            _creditBond(marketId, m.resolver, m.proposerBond);
            _creditBond(marketId, s.disputer, m.disputeBond);
            _finalize(marketId, s, IMezonkExchange.Outcome.Invalid, FinalizeReason.ArbitrationTimeout);
        } else {
            revert WrongStage(st);
        }
    }

    function withdrawBond() external nonReentrant returns (uint256 amount) {
        amount = bondCredits[msg.sender];
        if (amount == 0) revert NothingToClaim();
        bondCredits[msg.sender] = 0;
        bondCreditsTotal -= amount;
        collateralToken.safeTransfer(msg.sender, amount);
        emit BondWithdrawn(msg.sender, amount);
    }

    function _finalize(uint256 marketId, State storage s, IMezonkExchange.Outcome outcome, FinalizeReason reason)
        internal
    {
        s.finalized = true;
        emit MarketFinalized(marketId, outcome, reason);
        exchange.settle(marketId, outcome);
    }

    function _creditBond(uint256 marketId, address account, uint256 amount) internal {
        if (amount == 0) return;
        lockedBonds -= amount;
        bondCredits[account] += amount;
        bondCreditsTotal += amount;
        emit BondCredited(marketId, account, amount);
    }

    function _pull(address from, uint256 amount) internal {
        if (amount == 0) return;
        uint256 before = collateralToken.balanceOf(address(this));
        collateralToken.safeTransferFrom(from, address(this), amount);
        if (collateralToken.balanceOf(address(this)) - before != amount) revert InvalidParams();
    }
}
