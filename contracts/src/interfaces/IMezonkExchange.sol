// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IMezonkExchange
/// @notice Types, events and errors for the MEZONK order-book exchange (fully collateralized YES/NO shares).
interface IMezonkExchange {
    // ───────────────────────────── Types ─────────────────────────────

    /// @notice Final outcome. Share indexes are separate: 0 = YES share, 1 = NO share.
    enum Outcome {
        None,
        Yes,
        No,
        Invalid
    }

    enum Side {
        Buy,
        Sell
    }

    /// @dev Derived lifecycle stage.
    enum Stage {
        Seeding, // published; collecting escrowed seed orders; no trading
        Live, // graduated; order book trading, split and merge
        Failed, // seeding deadline passed without graduating; refunds only
        Closed, // trading over; resolution runs in MezonkResolution
        Finalized // outcome final, redemptions open
    }

    /// @notice Publication and resolution parameters, snapshotted into every market at creation.
    struct Config {
        uint32 minLiveDuration; // min seconds between the seeding deadline and close
        uint32 maxDuration; // max seconds between creation and close
        uint32 proposalWindow;
        uint32 challengeWindow;
        uint32 arbitrationWindow;
        uint128 proposerBond;
        uint128 disputeBond;
        address arbitrator;
    }

    /// @notice A versioned, immutable graduation + fee + incentive policy. Markets reference one by id, so a later
    ///         policy never changes the terms an existing market was published under.
    struct Policy {
        // Graduation (all measured on escrowed orders only, in YES-price terms)
        uint128 minBidDepth; // shares bid for YES within `band` cents of the best bid
        uint128 minAskDepth; // shares offered for YES (escrowed NO bids) within `band` cents of the best ask
        uint128 minSeederNotional; // collateral a wallet must have escrowed to count as a distinct seeder
        uint16 minSeeders; // distinct wallets meeting `minSeederNotional`
        uint8 maxSpread; // best ask - best bid, in cents
        uint8 band; // depth window in cents
        uint32 seedingPeriod; // seconds from publication to the seeding deadline
        uint32 minRest; // seed orders can't be cancelled for this long after placement, and again after graduation
        // Fees
        uint16 takerFeeBps; // charged to takers on their notional; makers pay nothing
        uint16 rebateShareBps; // share of each taker fee set aside for the market's seeders
        uint16 referralShareBps; // share of each taker fee credited to the taker's referrer
        uint32 rebatePeriod; // seconds after graduation during which rebates accrue
        uint32 claimWindow; // seconds after the rebate period during which rebates can be claimed
        uint128 rebateCapPerMarket; // max rebates one market can accrue
        uint128 rebateCapPerWallet; // max rebate one seeder can claim from one market
        uint128 rebateBudget; // max rebates all markets on this policy can accrue together
        uint128 referralCapPerMarket; // max referral credit one referrer can earn from one market
    }

    struct CreateParams {
        string metadata; // canonical JSON: question, rules, sources, invalid conditions
        uint64 closeTime;
        address resolver;
        uint32 policyId;
    }

    /// @notice Curator approval for one market. Binds rules, creator, resolver, close and the graduation/fee policy.
    struct MarketApproval {
        bytes32 metadataHash;
        address creator;
        address resolver;
        uint64 closeTime;
        uint32 policyId;
        uint64 deadline;
        bytes32 nonce;
    }

    struct Market {
        address creator;
        address resolver;
        address arbitrator;
        uint64 createdAt;
        uint64 seedingDeadline;
        uint64 closeTime;
        uint64 graduatedAt;
        uint32 policyId;
        uint32 proposalWindow;
        uint32 challengeWindow;
        uint32 arbitrationWindow;
        Outcome finalOutcome;
        bool finalized;
        uint128 proposerBond;
        uint128 disputeBond;
        uint256 collateral; // outstanding complete sets = collateral backing them
        bytes32 metadataHash;
    }

    /// @notice An off-chain order signed by its maker (EIP-712). Not escrowed: assets move only when a taker fills it.
    struct Order {
        address maker;
        address taker; // 0 = anyone
        uint256 marketId;
        uint8 outcome; // 0 = YES, 1 = NO
        Side side;
        uint8 price; // cents per share, 1..99
        uint128 quantity; // shares (18 decimals), multiple of LOT
        uint64 expiry;
        uint256 nonce; // invalid once the maker raises minNonce above it
        uint256 salt;
    }

    /// @notice An order whose collateral (buy) or shares (sell) are held by the contract until filled or cancelled.
    struct RestingOrder {
        address maker;
        uint8 outcome;
        Side side;
        uint8 price;
        bool seed; // placed before graduation (counts toward graduation and rebates)
        uint64 placedAt;
        uint256 marketId;
        uint128 quantity;
        uint128 remaining;
    }

    struct TakeParams {
        uint256 marketId;
        uint8 outcome; // what the taker buys or sells
        Side side;
        uint8 limitPrice; // worst acceptable price in cents for the taker's outcome
        uint128 quantity; // max shares
        uint128 minFill; // revert if less than this fills (quantity = fill-or-kill)
        uint64 deadline;
    }

    /// @notice One maker the taker wants to trade against: a resting order (restingId != 0) or a signed order.
    struct Source {
        uint256 restingId;
        Order order;
        bytes signature;
    }

    struct GraduationCheck {
        uint8 bestBid;
        uint8 bestAsk;
        uint256 bidDepth;
        uint256 askDepth;
        uint16 seeders;
        bool spreadOk;
        bool depthOk;
        bool seedersOk;
        bool open; // still seeding and before the deadline
    }

    // ───────────────────────────── Events ─────────────────────────────

    event MarketCreated(
        uint256 indexed marketId,
        address indexed creator,
        address indexed resolver,
        uint32 policyId,
        uint64 seedingDeadline,
        uint64 closeTime,
        bytes32 metadataHash,
        string metadata
    );
    event Graduated(
        uint256 indexed marketId,
        uint8 bestBid,
        uint8 bestAsk,
        uint256 bidDepth,
        uint256 askDepth,
        uint16 seeders
    );

    event OrderPlaced(
        uint256 indexed orderId,
        uint256 indexed marketId,
        address indexed maker,
        uint8 outcome,
        Side side,
        uint8 price,
        uint128 quantity,
        bool seed
    );
    event OrderCancelled(
        uint256 indexed orderId, uint256 indexed marketId, address indexed maker, uint128 remaining
    );
    event SignedOrderCancelled(bytes32 indexed orderHash, address indexed maker);
    event MinNonceRaised(address indexed maker, uint256 minNonce);

    /// @param orderRef resting order id (as bytes32) or signed order hash
    /// @param complement true when the fill minted (taker buy) or merged (taker sell) a complete set
    event Fill(
        uint256 indexed marketId,
        bytes32 indexed orderRef,
        address indexed taker,
        address maker,
        bool resting,
        uint8 makerOutcome,
        Side makerSide,
        uint8 makerPrice,
        uint128 quantity,
        bool complement,
        uint256 takerFee
    );
    event TakeSettled(
        uint256 indexed marketId,
        address indexed taker,
        uint8 outcome,
        Side side,
        uint128 filled,
        uint256 notional,
        uint256 fee,
        uint256 rebatePart,
        uint256 referralPart
    );

    event Split(uint256 indexed marketId, address indexed account, uint256 amount);
    event Merged(uint256 indexed marketId, address indexed account, uint256 amount);
    event SharesTransferred(
        uint256 indexed marketId, address indexed from, address indexed to, uint8 outcome, uint256 amount
    );

    event MarketSettled(uint256 indexed marketId, Outcome outcome);
    event Redeemed(
        uint256 indexed marketId, address indexed account, uint256 yesBurned, uint256 noBurned, uint256 payout
    );

    event ProtocolFeesWithdrawn(address indexed to, uint256 amount);
    event PolicyAdded(uint32 indexed policyId, Policy policy);
    event PolicyActiveSet(uint32 indexed policyId, bool active);

    // ───────────────────────────── Errors ─────────────────────────────

    error InvalidConfig();
    error InvalidParams();
    error UnknownMarket();
    error UnknownOrder();
    error NotTradable();
    error WrongStage(Stage stage);
    error WindowOpen();
    error InvalidOutcome();
    error Expired();
    error NothingToClaim();
    error UnsupportedToken();
    error NotResolution();
    error NotFactory();
    error PolicyInactive();
    error BadLot();
    error CrossesBook();
    error NotMaker();
    error StillLocked(uint64 until);
    error SelfTrade();
    error BadOrderSignature();
    error InsufficientLiquidity(uint128 filled);
    error InsufficientShares();
    error GraduationUnmet();
    error NotIncentives();
}
