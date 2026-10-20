// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IMezonkMarkets
/// @notice Types, events and errors for the Mezonk binary prediction market manager.
interface IMezonkMarkets {
    // ───────────────────────────── Types ─────────────────────────────

    enum Outcome {
        None,
        Yes,
        No,
        Invalid
    }

    /// @dev Derived lifecycle stage. `Finalized` covers Resolved and Invalid; read `finalOutcome`.
    enum Stage {
        Open, // trading allowed
        Closed, // trading over, awaiting a proposal
        Proposed, // proposal live, challenge window running
        Disputed, // proposal challenged, awaiting arbitration
        Finalized // outcome is final, redemptions open
    }

    enum FinalizeReason {
        Undisputed,
        Arbitrated,
        NoProposal,
        ArbitrationTimeout
    }

    /// @notice Global parameters. Every market snapshots them at creation so later
    ///         changes by the owner never alter an existing market's economics or rules.
    struct Config {
        uint16 feeBps; // trading fee on buys (input) and sells (output)
        uint16 protocolFeeShareBps; // share of the fee kept by the protocol; rest accrues to the creator
        uint32 minDuration; // min seconds between creation and close
        uint32 maxDuration; // max seconds between creation and close
        uint32 proposalWindow; // seconds after close in which the resolver must propose
        uint32 challengeWindow; // seconds a proposal can be disputed
        uint32 arbitrationWindow; // seconds the arbitrator has to rule on a dispute
        uint128 minLiquidity; // minimum creator seed liquidity
        uint128 proposerBond; // bond posted by the resolver with a proposal
        uint128 disputeBond; // bond posted by a disputer
        address arbitrator; // rules on disputes
    }

    struct CreateParams {
        string metadata; // canonical JSON: question, rules, sources, invalid conditions
        uint64 closeTime; // trading stops at this timestamp
        address resolver; // must be an approved resolver
        uint256 initialLiquidity; // collateral seeded into the pool by the creator
        uint16 initialYesProbBps; // starting YES probability, 500..9500
    }

    /// @notice Curator approval for publishing one market. Signed off-chain (EIP-712) by an approved curator
    ///         and consumed on-chain by `createMarket`. Binds the exact rules and key parameters.
    struct MarketApproval {
        bytes32 metadataHash; // keccak256 of the exact metadata bytes that will be published
        address creator; // the approved creator allowed to publish it
        address resolver; // the resolver the review approved
        uint64 closeTime; // the trading close the review approved
        uint64 deadline; // approval expires after this timestamp
        bytes32 nonce; // single use; typically the backend proposal id
    }

    struct Market {
        address creator;
        address resolver;
        address arbitrator;
        address disputer;
        uint64 createdAt;
        uint64 closeTime;
        uint64 proposedAt;
        uint64 disputedAt;
        uint16 feeBps;
        uint16 protocolFeeShareBps;
        uint32 proposalWindow;
        uint32 challengeWindow;
        uint32 arbitrationWindow;
        Outcome proposedOutcome;
        Outcome finalOutcome;
        bool finalized;
        bool liquidityClaimed;
        uint128 proposerBond;
        uint128 disputeBond;
        uint256 poolYes;
        uint256 poolNo;
        uint256 collateral; // outstanding complete sets = collateral backing them
        uint256 creatorFees; // unclaimed creator fee accrual
        bytes32 metadataHash; // keccak256 of the metadata emitted at creation
    }

    // ───────────────────────────── Events ─────────────────────────────

    event MarketCreated(
        uint256 indexed marketId,
        address indexed creator,
        address indexed resolver,
        Market market,
        uint16 initialYesProbBps,
        uint256 creatorYes,
        uint256 creatorNo,
        string metadata
    );

    /// @param collateralAmount Gross collateral in (buy) or out before fee (sell).
    /// @param poolYes Pool YES balance after the trade.
    /// @param poolNo Pool NO balance after the trade.
    event Trade(
        uint256 indexed marketId,
        address indexed trader,
        bool isYes,
        bool isBuy,
        uint256 collateralAmount,
        uint256 fee,
        uint256 shares,
        uint256 poolYes,
        uint256 poolNo
    );

    event OutcomeProposed(
        uint256 indexed marketId,
        address indexed resolver,
        Outcome outcome,
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
        Outcome outcome,
        bytes32 rationaleHash,
        string rationaleURI
    );

    event MarketFinalized(uint256 indexed marketId, Outcome outcome, FinalizeReason reason);

    event Redeemed(
        uint256 indexed marketId, address indexed account, uint256 yesBurned, uint256 noBurned, uint256 payout
    );

    event LiquidityClaimed(uint256 indexed marketId, address indexed creator, uint256 payout);
    event CreatorFeesClaimed(uint256 indexed marketId, address indexed creator, uint256 amount);
    event BondCredited(uint256 indexed marketId, address indexed account, uint256 amount);
    event BondWithdrawn(address indexed account, uint256 amount);
    event ProtocolFeesWithdrawn(address indexed to, uint256 amount);
    event ConfigUpdated(Config config);
    event ResolverUpdated(address indexed resolver, bool approved);
    event CreatorUpdated(address indexed creator, bool approved);
    event CuratorUpdated(address indexed curator, bool approved);
    /// @notice Links a published market to the curator approval it consumed (audit trail).
    event MarketApprovalUsed(uint256 indexed marketId, address indexed curator, bytes32 indexed nonce);

    // ───────────────────────────── Errors ─────────────────────────────

    error InvalidConfig();
    error InvalidParams();
    error UnknownMarket();
    error NotTradable();
    error WrongStage(Stage stage);
    error NotResolver();
    error NotArbitrator();
    error WindowClosed();
    error WindowOpen();
    error InvalidOutcome();
    error Slippage();
    error Expired();
    error NothingToClaim();
    error NotCreator();
    error UnsupportedToken();
    error NotApprovedCreator();
    error NotCurator();
    error SelfApproval();
    error ApprovalExpired();
    error ApprovalUsed();
    error ApprovalMismatch();
    error BadApprovalSignature();
}
