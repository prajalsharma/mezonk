// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import {IMezonkExchange} from "./interfaces/IMezonkExchange.sol";
import {MezonkResolution} from "./MezonkResolution.sol";
import {MezonkMarketFactory} from "./MezonkMarketFactory.sol";
import {MezonkIncentives} from "./MezonkIncentives.sol";

/// @title MezonkExchange
/// @notice Binary prediction markets on Mezo with an order book and fully collateralized YES/NO shares.
///
/// Money model
///  - One YES share + one NO share (a complete set) is backed by exactly one unit of collateral (MUSD).
///  - Shares exist only by splitting collateral or by a fill that mints a set from two opposite buyers.
///    The contract never sells shares it does not hold and never takes a side: there is no house position.
///  - Prices are whole cents (1..99). Quantities are multiples of LOT (0.01 share), so every cost and fee
///    is an exact integer. Nothing rounds.
///
/// Liquidity
///  - Signed orders (EIP-712) stay in the maker's wallet until a taker fills them. Stale ones are skipped.
///  - Resting orders are escrowed here. During SEEDING only escrowed buy orders can be placed. They are the
///    seed commitments, and graduation is checked against them on-chain. After graduation they are ordinary
///    resting orders in the same book. There is one book, not two.
///  - Takers settle their own trades by passing the maker orders they want to hit. The matching service only
///    suggests orders; it holds no keys and cannot invent prices, quantities or trades.
///
/// Lifecycle: SEEDING → (graduate) LIVE → CLOSED → [resolution: proposed → disputed?] → FINALIZED,
///            or SEEDING → FAILED (refunds). Resolution and bonds live in MezonkResolution.
///
/// Trust model (docs/SECURITY_AND_SOLVENCY.md)
///  - Owner: policies for FUTURE markets, pause, withdraw accrued protocol fees (roles and config: factory). Cannot move
///    collateral, escrow, rebate or referral reserves, or bonds, and cannot change an outcome. No upgradeability.
///  - Pausing blocks publication, new orders, takes and splits. Never cancellation, merge, resolution or claims.
contract MezonkExchange is IMezonkExchange, Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant LOT = 1e16; // 0.01 share
    uint256 public constant ONE = 1e18;
    uint8 public constant YES = 0;
    uint8 public constant NO = 1;
    uint16 public constant MAX_FEE_BPS = 500;
    uint16 public constant MAX_INCENTIVE_SHARE_BPS = 8000; // rebates + referrals < fee: wash trading always loses

    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address maker,address taker,uint256 marketId,uint8 outcome,uint8 side,uint8 price,uint128 quantity,uint64 expiry,uint256 nonce,uint256 salt)"
    );

    IERC20 public immutable collateralToken;
    /// @notice The only address allowed to settle outcomes. Created here, so it can never be swapped.
    MezonkResolution public immutable resolution;
    /// @notice The only address allowed to open markets (verifies curator approvals and holds the role lists).
    MezonkMarketFactory public immutable factory;
    /// @notice Holds rebate and referral reserves, funded only from the fee share sent by `take`.
    MezonkIncentives public immutable incentives;

    uint256 public marketCount;
    uint32 public policyCount;
    uint256 public restingCount;

    // ── Accounting buckets. Token balance == totalCollateral + escrowedCollateral + protocolFees. ──
    uint256 public totalCollateral; // Σ market.collateral: backs every outstanding share
    uint256 public escrowedCollateral; // collateral locked in resting buy orders (refundable)
    uint256 public protocolFees; // accrued protocol revenue, withdrawable by the owner

    mapping(uint32 => Policy) internal _policies;
    mapping(uint32 => bool) public policyActive;

    mapping(uint256 => Market) internal _markets;
    /// @notice marketId => share index (0 YES, 1 NO) => account => free shares.
    mapping(uint256 => mapping(uint8 => mapping(address => uint256))) public sharesOf;

    // ── Resting book (escrowed orders), indexed in YES-price terms ──
    mapping(uint256 => RestingOrder) internal _resting;
    /// @dev marketId => [bids, asks] bitmaps; bit p set when depth at YES price p is non-zero.
    mapping(uint256 => uint256[2]) internal _levels;
    /// @dev marketId => bookSide (0 bid, 1 ask) => YES price => shares.
    mapping(uint256 => mapping(uint8 => mapping(uint8 => uint256))) public depthAt;

    // ── Signed orders ──
    mapping(bytes32 => uint128) public filledOf;
    mapping(bytes32 => bool) public cancelledOrder;
    mapping(address => uint256) public minNonce;

    // ── Seeding and incentives ──
    mapping(uint256 => mapping(address => uint256)) public seedWeight; // collateral escrowed in seed orders
    mapping(uint256 => uint256) public totalSeedWeight;
    mapping(uint256 => uint16) public seederCount;

    mapping(address => bool) public hasTraded;

    constructor(IERC20 collateral_, address owner_, Config memory config_)
        Ownable(owner_)
        EIP712("MEZONK Exchange", "1")
    {
        if (address(collateral_) == address(0)) revert InvalidParams();
        collateralToken = collateral_;
        resolution = new MezonkResolution(collateral_);
        factory = new MezonkMarketFactory(owner_, config_);
        incentives = new MezonkIncentives(collateral_);
    }

    // ═════════════════════════════ Views ═════════════════════════════

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return _market(marketId);
    }

    function getPolicy(uint32 policyId) external view returns (Policy memory) {
        return _policies[policyId];
    }

    function getResting(uint256 orderId) external view returns (RestingOrder memory) {
        return _resting[orderId];
    }

    function stageOf(uint256 marketId) public view returns (Stage) {
        return _stage(_market(marketId));
    }


    /// @notice Best resting YES bid and ask in cents (0 = none on that side). Signed orders are off-chain.
    function bestPrices(uint256 marketId) public view returns (uint8 bid, uint8 ask) {
        uint256[2] storage lv = _levels[marketId];
        bid = _highest(lv[0]);
        ask = _lowest(lv[1]);
    }

    /// @notice The graduation test, exactly as `graduate` applies it.
    function graduationCheck(uint256 marketId) public view returns (GraduationCheck memory g) {
        Market storage m = _market(marketId);
        Policy storage p = _policies[m.policyId];
        (g.bestBid, g.bestAsk) = bestPrices(marketId);
        g.seeders = seederCount[marketId];
        g.open = _stage(m) == Stage.Seeding;
        if (g.bestBid != 0) {
            uint8 lo = g.bestBid > p.band ? g.bestBid - p.band : 1;
            for (uint8 y = lo; y <= g.bestBid; y++) {
                g.bidDepth += depthAt[marketId][0][y];
            }
        }
        if (g.bestAsk != 0) {
            uint8 hi = uint256(g.bestAsk) + p.band < 99 ? g.bestAsk + p.band : 99;
            for (uint8 y = g.bestAsk; y <= hi; y++) {
                g.askDepth += depthAt[marketId][1][y];
            }
        }
        g.spreadOk = g.bestBid != 0 && g.bestAsk != 0 && g.bestAsk > g.bestBid && g.bestAsk - g.bestBid <= p.maxSpread;
        g.depthOk = g.bidDepth >= p.minBidDepth && g.askDepth >= p.minAskDepth;
        g.seedersOk = g.seeders >= p.minSeeders;
    }

    function orderHash(Order calldata o) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ORDER_TYPEHASH,
                    o.maker,
                    o.taker,
                    o.marketId,
                    o.outcome,
                    uint8(o.side),
                    o.price,
                    o.quantity,
                    o.expiry,
                    o.nonce,
                    o.salt
                )
            )
        );
    }



    // ═════════════════════════════ Publication ═════════════════════════════

    /// @notice Opens a market in SEEDING. Only the factory calls this, after verifying the curator approval.
    function openMarket(
        address creator,
        address resolver,
        uint32 policyId,
        uint64 closeTime,
        string calldata metadata,
        Config calldata c
    ) external whenNotPaused returns (uint256 marketId) {
        if (msg.sender != address(factory)) revert NotFactory();
        if (!policyActive[policyId]) revert PolicyInactive();
        uint64 seedingDeadline = uint64(block.timestamp) + _policies[policyId].seedingPeriod;
        if (closeTime < uint256(seedingDeadline) + c.minLiveDuration || closeTime > block.timestamp + c.maxDuration) {
            revert InvalidParams();
        }
        marketId = ++marketCount;
        Market storage m = _markets[marketId];
        m.creator = creator;
        m.resolver = resolver;
        m.arbitrator = c.arbitrator;
        m.createdAt = uint64(block.timestamp);
        m.seedingDeadline = seedingDeadline;
        m.closeTime = closeTime;
        m.policyId = policyId;
        m.proposalWindow = c.proposalWindow;
        m.challengeWindow = c.challengeWindow;
        m.arbitrationWindow = c.arbitrationWindow;
        m.proposerBond = c.proposerBond;
        m.disputeBond = c.disputeBond;
        bytes32 h = keccak256(bytes(metadata));
        m.metadataHash = h;
        emit MarketCreated(marketId, creator, resolver, policyId, seedingDeadline, closeTime, h, metadata);
    }

    // ═════════════════════════════ Graduation ═════════════════════════════

    /// @notice Permissionless. Moves a SEEDING market to LIVE if its escrowed book meets the market's policy.
    ///         One-time: a market never returns to SEEDING, even if depth later falls.
    function graduate(uint256 marketId) external nonReentrant whenNotPaused {
        Market storage m = _market(marketId);
        GraduationCheck memory g = graduationCheck(marketId);
        if (!g.open) revert WrongStage(_stage(m));
        if (!(g.spreadOk && g.depthOk && g.seedersOk)) revert GraduationUnmet();
        m.graduatedAt = uint64(block.timestamp);
        emit Graduated(marketId, g.bestBid, g.bestAsk, g.bidDepth, g.askDepth, g.seeders);
    }

    // ═════════════════════════════ Complete sets ═════════════════════════════

    /// @notice Lock `amount` collateral and receive `amount` YES and `amount` NO shares. LIVE only.
    function split(uint256 marketId, uint256 amount) external nonReentrant whenNotPaused {
        Market storage m = _market(marketId);
        if (_stage(m) != Stage.Live) revert NotTradable();
        _lot(amount);
        _pull(msg.sender, amount);
        m.collateral += amount;
        totalCollateral += amount;
        sharesOf[marketId][YES][msg.sender] += amount;
        sharesOf[marketId][NO][msg.sender] += amount;
        emit Split(marketId, msg.sender, amount);
    }

    /// @notice Burn `amount` YES and `amount` NO for `amount` collateral. Any time after graduation until final.
    function merge(uint256 marketId, uint256 amount) external nonReentrant {
        Market storage m = _market(marketId);
        if (m.graduatedAt == 0 || m.finalized) revert WrongStage(_stage(m));
        _lot(amount);
        _debit(marketId, YES, msg.sender, amount);
        _debit(marketId, NO, msg.sender, amount);
        m.collateral -= amount;
        totalCollateral -= amount;
        collateralToken.safeTransfer(msg.sender, amount);
        emit Merged(marketId, msg.sender, amount);
    }

    function transferShares(uint256 marketId, uint8 outcome, address to, uint256 amount) external nonReentrant {
        _market(marketId);
        if (outcome > NO || to == address(0) || to == msg.sender) revert InvalidParams();
        _lot(amount);
        _debit(marketId, outcome, msg.sender, amount);
        sharesOf[marketId][outcome][to] += amount;
        emit SharesTransferred(marketId, msg.sender, to, outcome, amount);
    }

    // ═════════════════════════════ Resting (escrowed) orders ═════════════════════════════

    /// @notice Escrow a limit order on-chain. In SEEDING only buy orders are allowed; they are seed commitments.
    ///         Buy escrows quantity × price collateral; sell escrows the shares. The book may not cross.
    function placeOrder(uint256 marketId, uint8 outcome, Side side, uint8 price, uint128 quantity)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 orderId)
    {
        Market storage m = _market(marketId);
        Stage s = _stage(m);
        bool seed = s == Stage.Seeding;
        if (!seed && s != Stage.Live) revert NotTradable();
        if (outcome > NO || price == 0 || price > 99) revert InvalidParams();
        if (seed && side != Side.Buy) revert InvalidParams();
        _lot(quantity);

        (uint8 bookSide, uint8 y) = _bookPosition(outcome, side, price);
        (uint8 bid, uint8 ask) = bestPrices(marketId);
        if (bookSide == 0 ? (ask != 0 && y >= ask) : (bid != 0 && y <= bid)) revert CrossesBook();

        if (side == Side.Buy) {
            uint256 cost = _cost(quantity, price);
            _pull(msg.sender, cost);
            escrowedCollateral += cost;
            if (seed) _addSeedWeight(marketId, msg.sender, cost, int256(1));
        } else {
            _debit(marketId, outcome, msg.sender, quantity);
        }

        orderId = ++restingCount;
        _resting[orderId] = RestingOrder({
            maker: msg.sender,
            outcome: outcome,
            side: side,
            price: price,
            seed: seed,
            placedAt: uint64(block.timestamp),
            marketId: marketId,
            quantity: quantity,
            remaining: quantity
        });
        _addDepth(marketId, bookSide, y, quantity);
        emit OrderPlaced(orderId, marketId, msg.sender, outcome, side, price, quantity, seed);
    }

    /// @notice Return a resting order's unfilled escrow to its maker. Seed orders are locked for `minRest` after
    ///         placement and again for `minRest` after graduation, so counted liquidity stays executable at launch.
    ///         After the seeding deadline fails, or once the market closes, cancellation is always allowed.
    function cancelOrder(uint256 orderId) external nonReentrant {
        RestingOrder storage o = _resting[orderId];
        if (o.maker == address(0)) revert UnknownOrder();
        if (o.maker != msg.sender) revert NotMaker();
        uint128 rem = o.remaining;
        if (rem == 0) revert NothingToClaim();
        Market storage m = _markets[o.marketId];
        Stage s = _stage(m);
        uint32 minRest = _policies[m.policyId].minRest;
        if (s == Stage.Seeding || s == Stage.Live) {
            uint64 from = o.placedAt;
            if (s == Stage.Live && o.seed && m.graduatedAt > from) from = m.graduatedAt;
            if (o.seed && block.timestamp < uint256(from) + minRest) revert StillLocked(from + minRest);
        }

        o.remaining = 0;
        (uint8 bookSide, uint8 y) = _bookPosition(o.outcome, o.side, o.price);
        _removeDepth(o.marketId, bookSide, y, rem);
        if (o.side == Side.Buy) {
            uint256 refund = _cost(rem, o.price);
            escrowedCollateral -= refund;
            // Seed weight only changes before graduation; after it, weight is fixed for rebates.
            if (s == Stage.Seeding) _addSeedWeight(o.marketId, msg.sender, refund, int256(-1));
            collateralToken.safeTransfer(msg.sender, refund);
        } else {
            sharesOf[o.marketId][o.outcome][msg.sender] += rem;
        }
        emit OrderCancelled(orderId, o.marketId, msg.sender, rem);
    }

    // ═════════════════════════════ Signed orders ═════════════════════════════

    function cancelSignedOrders(Order[] calldata orders) external {
        for (uint256 i; i < orders.length; i++) {
            if (orders[i].maker != msg.sender) revert NotMaker();
            bytes32 h = orderHash(orders[i]);
            cancelledOrder[h] = true;
            emit SignedOrderCancelled(h, msg.sender);
        }
    }

    /// @notice Invalidate every signed order with nonce below `newMin`.
    function raiseMinNonce(uint256 newMin) external {
        if (newMin <= minNonce[msg.sender]) revert InvalidParams();
        minNonce[msg.sender] = newMin;
        emit MinNonceRaised(msg.sender, newMin);
    }

    // ═════════════════════════════ Taking ═════════════════════════════

    struct Ctx {
        uint256 marketId;
        address taker;
        address referrer;
        uint8 outcome;
        Side side;
        uint8 limit;
        uint16 feeBps;
        uint128 left;
        uint256 cashIn; // taker owes (buy), before fee
        uint256 cashOut; // taker is owed (sell), before fee
        uint256 fee;
        uint256 referralFee; // fee from fills whose maker is not the taker's referrer
    }

    /// @notice Trade against the given maker orders, best first, never past `limitPrice`. Fills what valid,
    ///         funded liquidity exists up to `quantity`; the rest is not filled. Reverts if less than `minFill`.
    ///         Expired, cancelled, filled or unfunded signed orders are skipped, never forced.
    function take(TakeParams calldata t, Source[] calldata sources)
        external
        nonReentrant
        whenNotPaused
        returns (uint128 filled)
    {
        if (block.timestamp > t.deadline) revert Expired();
        Market storage m = _market(t.marketId);
        if (_stage(m) != Stage.Live) revert NotTradable();
        if (t.outcome > NO || t.limitPrice == 0 || t.limitPrice > 99 || t.minFill > t.quantity) {
            revert InvalidParams();
        }
        _lot(t.quantity);
        if (t.minFill % LOT != 0) revert BadLot();

        Ctx memory c;
        c.marketId = t.marketId;
        c.taker = msg.sender;
        c.referrer = incentives.referrerOf(msg.sender);
        c.outcome = t.outcome;
        c.side = t.side;
        c.limit = t.limitPrice;
        c.feeBps = _policies[m.policyId].takerFeeBps;
        c.left = t.quantity;

        for (uint256 i; i < sources.length && c.left > 0; i++) {
            if (sources[i].restingId != 0) _takeResting(m, c, sources[i].restingId);
            else _takeSigned(m, c, sources[i].order, sources[i].signature);
        }

        filled = t.quantity - c.left;
        if (filled == 0 || filled < t.minFill) revert InsufficientLiquidity(filled);
        hasTraded[msg.sender] = true;

        if (t.side == Side.Buy) {
            _pull(msg.sender, c.cashIn + c.fee);
        } else {
            collateralToken.safeTransfer(msg.sender, c.cashOut - c.fee);
        }
        (uint256 rebatePart, uint256 referralPart) = _accrueFee(c);
        emit TakeSettled(
            t.marketId,
            msg.sender,
            t.outcome,
            t.side,
            filled,
            t.side == Side.Buy ? c.cashIn : c.cashOut,
            c.fee,
            rebatePart,
            referralPart
        );
    }

    function _takeResting(Market storage m, Ctx memory c, uint256 id) internal {
        RestingOrder storage o = _resting[id];
        if (o.marketId != c.marketId) revert UnknownOrder();
        if (o.remaining == 0) return;
        if (o.maker == c.taker) revert SelfTrade();
        (bool ok, bool complement, uint8 takerPrice) = _compatible(c, o.outcome, o.side, o.price);
        if (!ok || !_priceOk(c, takerPrice)) return;
        uint128 q = o.remaining < c.left ? o.remaining : c.left;

        o.remaining -= q;
        (uint8 bookSide, uint8 y) = _bookPosition(o.outcome, o.side, o.price);
        _removeDepth(c.marketId, bookSide, y, q);
        if (o.side == Side.Buy) escrowedCollateral -= _cost(q, o.price);
        _settle(m, c, o.maker, o.outcome, o.side, o.price, q, complement);
        emit Fill(
            c.marketId, bytes32(id), c.taker, o.maker, true, o.outcome, o.side, o.price, q, complement, _fee(c, q, takerPrice)
        );
    }

    function _takeSigned(Market storage m, Ctx memory c, Order calldata o, bytes calldata sig) internal {
        if (o.marketId != c.marketId || o.outcome > NO || o.price == 0 || o.price > 99) revert InvalidParams();
        if (o.maker == c.taker) revert SelfTrade();
        bytes32 h = orderHash(o);
        if (!SignatureChecker.isValidSignatureNow(o.maker, h, sig)) revert BadOrderSignature();
        if (o.quantity % LOT != 0) revert BadLot();
        if (
            cancelledOrder[h] || block.timestamp > o.expiry || o.nonce < minNonce[o.maker]
                || (o.taker != address(0) && o.taker != c.taker)
        ) return;
        uint128 avail = o.quantity - filledOf[h];
        if (avail == 0) return;
        (bool ok, bool complement, uint8 takerPrice) = _compatible(c, o.outcome, o.side, o.price);
        if (!ok || !_priceOk(c, takerPrice)) return;
        uint128 q = avail < c.left ? avail : c.left;

        // Stale liquidity: skip makers who no longer hold what they signed for.
        if (o.side == Side.Buy) {
            uint256 cost = _cost(q, o.price);
            if (
                collateralToken.balanceOf(o.maker) < cost
                    || collateralToken.allowance(o.maker, address(this)) < cost
            ) return;
            _pull(o.maker, cost);
        } else {
            if (sharesOf[c.marketId][o.outcome][o.maker] < q) return;
            sharesOf[c.marketId][o.outcome][o.maker] -= q;
        }
        filledOf[h] += q;
        _settle(m, c, o.maker, o.outcome, o.side, o.price, q, complement);
        emit Fill(c.marketId, h, c.taker, o.maker, false, o.outcome, o.side, o.price, q, complement, _fee(c, q, takerPrice));
    }

    /// @dev Moves shares and collateral for one fill. The maker's side has already been secured: a buy maker's
    ///      collateral is in the contract (escrow or just pulled), a sell maker's shares were removed from its
    ///      free balance (escrow or just debited). Taker cash is netted in `c` and settled once in `take`.
    function _settle(
        Market storage m,
        Ctx memory c,
        address maker,
        uint8 mo,
        Side ms,
        uint8 p,
        uint128 q,
        bool complement
    ) internal {
        uint256 makerCash = _cost(q, p);
        uint256 otherCash = _cost(q, 100 - p);
        uint8 other = 1 - mo;
        if (ms == Side.Buy) {
            sharesOf[c.marketId][mo][maker] += q; // maker receives the outcome it bid for
            if (!complement) {
                // Taker sells `mo` to the maker for makerCash.
                _debit(c.marketId, mo, c.taker, q);
                c.cashOut += makerCash;
            } else {
                // Taker buys the other outcome for otherCash; together they fund one new complete set each share.
                sharesOf[c.marketId][other][c.taker] += q;
                m.collateral += q;
                totalCollateral += q;
                c.cashIn += otherCash;
            }
        } else {
            collateralToken.safeTransfer(maker, makerCash); // maker sold `mo` for makerCash
            if (!complement) {
                sharesOf[c.marketId][mo][c.taker] += q;
                c.cashIn += makerCash;
            } else {
                // Taker sells the other outcome; maker's `mo` plus taker's share merge back into collateral.
                _debit(c.marketId, other, c.taker, q);
                m.collateral -= q;
                totalCollateral -= q;
                c.cashOut += otherCash;
            }
        }
        uint256 f = _fee(c, q, complement ? 100 - p : p);
        c.fee += f;
        if (c.referrer != address(0) && c.referrer != maker) c.referralFee += f;
        c.left -= q;
    }

    function _compatible(Ctx memory c, uint8 mo, Side ms, uint8 p)
        internal
        pure
        returns (bool ok, bool complement, uint8 takerPrice)
    {
        if (mo == c.outcome && ms != c.side) return (true, false, p);
        if (mo != c.outcome && ms == c.side) return (true, true, 100 - p);
        return (false, false, 0);
    }

    function _priceOk(Ctx memory c, uint8 takerPrice) internal pure returns (bool) {
        return c.side == Side.Buy ? takerPrice <= c.limit : takerPrice >= c.limit;
    }

    function _fee(Ctx memory c, uint128 q, uint8 takerPrice) internal pure returns (uint256) {
        return (_cost(q, takerPrice) * c.feeBps) / BPS; // exact: cost is a multiple of 1e14
    }

    /// @dev The incentives contract decides (within the market policy's caps) how much of this fee goes to
    ///      seeder rebates and referral credit; exactly that moves there. The rest is protocol revenue.
    function _accrueFee(Ctx memory c) internal returns (uint256 rebatePart, uint256 referralPart) {
        if (c.fee == 0) return (0, 0);
        (rebatePart, referralPart) = incentives.accrue(c.marketId, c.referrer, c.fee, c.referralFee);
        uint256 out = rebatePart + referralPart;
        if (out > c.fee) revert InvalidParams();
        protocolFees += c.fee - out;
        if (out > 0) collateralToken.safeTransfer(address(incentives), out);
    }

    /// @notice Unclaimed rebates returned by the incentives contract after a claim window closes.
    function creditSweptRebates(uint256 amount) external {
        if (msg.sender != address(incentives)) revert NotIncentives();
        protocolFees += amount;
    }

    // ═════════════════════════════ Settlement ═════════════════════════════

    /// @notice Records the final outcome. Only callable by this exchange's own resolution contract, only once,
    ///         and only for a graduated market whose trading has closed.
    function settle(uint256 marketId, Outcome outcome) external {
        if (msg.sender != address(resolution)) revert NotResolution();
        Market storage m = _market(marketId);
        if (_stage(m) != Stage.Closed) revert WrongStage(_stage(m));
        if (outcome == Outcome.None) revert InvalidOutcome();
        m.finalized = true;
        m.finalOutcome = outcome;
        emit MarketSettled(marketId, outcome);
    }

    /// @notice Burn the caller's free shares in a finalized market. YES or NO pays 1 if it won, 0 if it lost;
    ///         INVALID pays 0.5 per share of either side. Cancel resting sell orders first to include them.
    function redeem(uint256 marketId) external nonReentrant returns (uint256 payout) {
        Market storage m = _market(marketId);
        if (!m.finalized) revert WrongStage(_stage(m));
        uint256 y = sharesOf[marketId][YES][msg.sender];
        uint256 n = sharesOf[marketId][NO][msg.sender];
        if (y == 0 && n == 0) revert NothingToClaim();
        sharesOf[marketId][YES][msg.sender] = 0;
        sharesOf[marketId][NO][msg.sender] = 0;
        payout = _payout(m.finalOutcome, y, n);
        m.collateral -= payout;
        totalCollateral -= payout;
        if (payout > 0) collateralToken.safeTransfer(msg.sender, payout);
        emit Redeemed(marketId, msg.sender, y, n, payout);
    }

    // ═════════════════════════════ Admin ═════════════════════════════


    /// @notice Adds an immutable policy version. Existing markets keep the policy they were published under.
    function addPolicy(Policy calldata p) external onlyOwner returns (uint32 id) {
        if (
            p.minBidDepth == 0 || p.minAskDepth == 0 || p.minBidDepth % LOT != 0 || p.minAskDepth % LOT != 0
                || p.minSeeders == 0 || p.maxSpread == 0 || p.maxSpread > 98 || p.band > 98
                || p.seedingPeriod < 1 hours || p.seedingPeriod > 60 days || p.minRest > 7 days
                || p.takerFeeBps > MAX_FEE_BPS || uint256(p.rebateShareBps) + p.referralShareBps > MAX_INCENTIVE_SHARE_BPS
                || p.rebatePeriod > 365 days || p.claimWindow < 7 days || p.claimWindow > 365 days
        ) revert InvalidConfig();
        id = ++policyCount;
        _policies[id] = p;
        policyActive[id] = true;
        emit PolicyAdded(id, p);
        emit PolicyActiveSet(id, true);
    }

    /// @notice Stop (or resume) new markets on a policy. Never affects markets already published on it.
    function setPolicyActive(uint32 id, bool active) external onlyOwner {
        if (id == 0 || id > policyCount) revert InvalidParams();
        policyActive[id] = active;
        emit PolicyActiveSet(id, active);
    }




    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Withdraws accrued protocol fees only. Cannot touch collateral, escrow, reserves or bonds.
    function withdrawProtocolFees(address to) external onlyOwner nonReentrant {
        uint256 amount = protocolFees;
        if (amount == 0) revert NothingToClaim();
        if (to == address(0)) revert InvalidParams();
        protocolFees = 0;
        collateralToken.safeTransfer(to, amount);
        emit ProtocolFeesWithdrawn(to, amount);
    }

    // ═════════════════════════════ Internals ═════════════════════════════

    function _market(uint256 marketId) internal view returns (Market storage m) {
        m = _markets[marketId];
        if (m.creator == address(0)) revert UnknownMarket();
    }

    function _stage(Market storage m) internal view returns (Stage) {
        if (m.finalized) return Stage.Finalized;
        if (m.graduatedAt == 0) return block.timestamp > m.seedingDeadline ? Stage.Failed : Stage.Seeding;
        if (block.timestamp >= m.closeTime) return Stage.Closed;
        return Stage.Live;
    }

    function _payout(Outcome outcome, uint256 y, uint256 n) internal pure returns (uint256) {
        if (outcome == Outcome.Yes) return y;
        if (outcome == Outcome.No) return n;
        if (outcome == Outcome.Invalid) return (y + n) / 2; // exact: both are multiples of LOT
        return 0;
    }

    /// @dev YES-price book position. Bids want YES (buy YES / sell NO); asks offer YES (sell YES / buy NO).
    function _bookPosition(uint8 outcome, Side side, uint8 price) internal pure returns (uint8 bookSide, uint8 y) {
        bool bid = (outcome == YES) == (side == Side.Buy);
        bookSide = bid ? 0 : 1;
        y = outcome == YES ? price : 100 - price;
    }

    function _addDepth(uint256 marketId, uint8 bookSide, uint8 y, uint256 q) internal {
        depthAt[marketId][bookSide][y] += q;
        _levels[marketId][bookSide] |= (uint256(1) << y);
    }

    function _removeDepth(uint256 marketId, uint8 bookSide, uint8 y, uint256 q) internal {
        uint256 d = depthAt[marketId][bookSide][y] - q;
        depthAt[marketId][bookSide][y] = d;
        if (d == 0) _levels[marketId][bookSide] &= ~(uint256(1) << y);
    }

    function _addSeedWeight(uint256 marketId, address who, uint256 amount, int256 dir) internal {
        Policy storage p = _policies[_markets[marketId].policyId];
        uint256 before = seedWeight[marketId][who];
        uint256 next = dir > 0 ? before + amount : before - amount;
        seedWeight[marketId][who] = next;
        totalSeedWeight[marketId] = dir > 0 ? totalSeedWeight[marketId] + amount : totalSeedWeight[marketId] - amount;
        bool was = before >= p.minSeederNotional && before > 0;
        bool now_ = next >= p.minSeederNotional && next > 0;
        if (!was && now_) seederCount[marketId] += 1;
        else if (was && !now_) seederCount[marketId] -= 1;
    }

    function _highest(uint256 bits) internal pure returns (uint8) {
        if (bits == 0) return 0;
        for (uint8 y = 99; y >= 1; y--) {
            if (bits & (uint256(1) << y) != 0) return y;
        }
        return 0;
    }

    function _lowest(uint256 bits) internal pure returns (uint8) {
        if (bits == 0) return 0;
        for (uint8 y = 1; y <= 99; y++) {
            if (bits & (uint256(1) << y) != 0) return y;
        }
        return 0;
    }

    function _debit(uint256 marketId, uint8 outcome, address who, uint256 amount) internal {
        uint256 bal = sharesOf[marketId][outcome][who];
        if (bal < amount) revert InsufficientShares();
        sharesOf[marketId][outcome][who] = bal - amount;
    }

    function _cost(uint256 q, uint256 price) internal pure returns (uint256) {
        return (q * price) / 100; // exact for q % LOT == 0
    }

    function _lot(uint256 amount) internal pure {
        if (amount == 0 || amount % LOT != 0) revert BadLot();
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _pull(address from, uint256 amount) internal {
        if (amount == 0) return;
        uint256 before = collateralToken.balanceOf(address(this));
        collateralToken.safeTransferFrom(from, address(this), amount);
        if (collateralToken.balanceOf(address(this)) - before != amount) revert UnsupportedToken();
    }

}
