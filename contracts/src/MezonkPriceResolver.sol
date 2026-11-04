// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IMezonkExchange} from "./interfaces/IMezonkExchange.sol";

/// @dev Mezo's MUSD PriceFeed (github.com/mezo-org/musd). fetchPrice() is the BTC/USD price with 18 decimals and
///      reverts "PriceFeed: Oracle is stale." when the oracle's last update is more than 60 seconds old.
interface IMezoPriceFeed {
    function fetchPrice() external view returns (uint256);
    function oracle() external view returns (address);
}

/// @dev The Chainlink-style oracle behind it. Mezo's only answers the latest round (getRoundData is not supported),
///      so a past price can never be read: the reading has to happen at the time it is meant to describe.
interface IRoundOracle {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

interface IResolutionPropose {
    function proposeOutcome(uint256 marketId, IMezonkExchange.Outcome outcome, bytes32 evidenceHash, string calldata evidenceURI)
        external;
    function withdrawBond() external returns (uint256 amount);
}

interface IExchangeMarkets {
    function getMarket(uint256 marketId) external view returns (IMezonkExchange.Market memory);
    function resolution() external view returns (address);
    function collateralToken() external view returns (IERC20);
}

/// @title MezonkPriceResolver
/// @notice A market resolver that settles "BTC above/below $X" markets from Mezo's own PriceFeed, the same price
///         Mezo uses for loans and liquidations.
///
/// How it works:
///  - It is an ordinary resolver: the factory owner allowlists it, and a BTC-price market names it as its resolver
///    when the curator approves the market. It goes through MezonkResolution like any resolver: it posts the
///    proposer bond, the proposal can be disputed during the challenge window, and the arbitrator has the last word.
///  - Before the market closes, the owner records its rule once: strike price and direction. The rule can't change.
///  - After close, anyone (a keeper) calls `settle` within `captureWindow` seconds. It reads PriceFeed.fetchPrice(),
///    requires the oracle's last update to be at or after the close time, compares it with the strike and proposes.
///    The price, oracle round, update time and block are stored and emitted, and hashed into the evidence.
///  - Mezo's oracle has no history, so if nobody settles inside the window the owner proposes by hand
///    (`proposeManual`), with evidence, still subject to dispute.
/// Bonds come from MUSD held by this contract; returned bonds are pulled back with `withdrawBonds`.
contract MezonkPriceResolver is Ownable2Step {
    using SafeERC20 for IERC20;

    enum Direction {
        Above, // YES if price >= strike
        Below // YES if price < strike
    }

    struct Rule {
        uint128 strike; // USD per BTC, 18 decimals
        Direction direction;
        bool set;
    }

    struct Reading {
        uint128 price; // USD per BTC, 18 decimals, from PriceFeed.fetchPrice()
        uint80 roundId; // oracle round the price came from
        uint64 updatedAt; // oracle update time of that round
        uint64 readAt; // block timestamp of the reading
        uint64 blockNumber;
        IMezonkExchange.Outcome outcome;
    }

    string public constant EVIDENCE_URI = "mezo:PriceFeed.fetchPrice";

    IExchangeMarkets public immutable exchange;
    IResolutionPropose public immutable resolution;
    IMezoPriceFeed public immutable priceFeed;
    IERC20 public immutable collateral;
    /// @notice Seconds after a market's close during which `settle` may read the price.
    uint32 public immutable captureWindow;

    mapping(uint256 => Rule) public rules;
    mapping(uint256 => Reading) public readings;

    event RuleSet(uint256 indexed marketId, uint128 strike, Direction direction);
    event PriceCaptured(
        uint256 indexed marketId,
        uint128 price,
        uint80 roundId,
        uint64 updatedAt,
        uint64 readAt,
        uint64 blockNumber,
        IMezonkExchange.Outcome outcome
    );
    event ManualProposal(uint256 indexed marketId, IMezonkExchange.Outcome outcome, bytes32 evidenceHash, string evidenceURI);
    event Swept(address indexed to, uint256 amount);

    error InvalidParams();
    error NotThisResolver();
    error RuleAlreadySet();
    error NoRule();
    error TooEarly();
    error WindowClosed();
    error WindowOpen();
    error PriceBeforeClose();

    constructor(IExchangeMarkets exchange_, IMezoPriceFeed priceFeed_, uint32 captureWindow_, address owner_)
        Ownable(owner_)
    {
        if (address(exchange_) == address(0) || address(priceFeed_) == address(0)) revert InvalidParams();
        if (captureWindow_ < 60 || captureWindow_ > 1 days) revert InvalidParams();
        exchange = exchange_;
        resolution = IResolutionPropose(exchange_.resolution());
        collateral = exchange_.collateralToken();
        priceFeed = priceFeed_;
        captureWindow = captureWindow_;
    }

    /// @notice Record a market's rule. Once, before close, and only for markets that name this contract as resolver.
    function setRule(uint256 marketId, uint128 strike, Direction direction) external onlyOwner {
        IMezonkExchange.Market memory m = exchange.getMarket(marketId);
        if (m.resolver != address(this)) revert NotThisResolver();
        if (rules[marketId].set) revert RuleAlreadySet();
        if (strike == 0) revert InvalidParams();
        if (block.timestamp >= m.closeTime) revert WindowClosed();
        rules[marketId] = Rule({strike: strike, direction: direction, set: true});
        emit RuleSet(marketId, strike, direction);
    }

    /// @notice Permissionless keeper call: read Mezo's BTC price just after close and propose the outcome.
    function settle(uint256 marketId) external returns (IMezonkExchange.Outcome outcome) {
        Rule memory r = rules[marketId];
        if (!r.set) revert NoRule();
        IMezonkExchange.Market memory m = exchange.getMarket(marketId);
        if (block.timestamp < m.closeTime) revert TooEarly();
        if (block.timestamp > uint256(m.closeTime) + captureWindow) revert WindowClosed();

        uint256 price = priceFeed.fetchPrice(); // reverts if the oracle is stale (> 60 s)
        (uint80 roundId,,, uint256 updatedAt,) = IRoundOracle(priceFeed.oracle()).latestRoundData();
        // The price must describe the market after it closed, not an update from before.
        if (updatedAt < m.closeTime) revert PriceBeforeClose();

        bool above = price >= r.strike;
        bool yes = r.direction == Direction.Above ? above : !above;
        outcome = yes ? IMezonkExchange.Outcome.Yes : IMezonkExchange.Outcome.No;

        Reading memory rd = Reading({
            price: uint128(price),
            roundId: roundId,
            updatedAt: uint64(updatedAt),
            readAt: uint64(block.timestamp),
            blockNumber: uint64(block.number),
            outcome: outcome
        });
        readings[marketId] = rd;
        emit PriceCaptured(marketId, rd.price, roundId, rd.updatedAt, rd.readAt, rd.blockNumber, outcome);

        bytes32 evidence = keccak256(
            abi.encode(block.chainid, address(priceFeed), marketId, r.strike, r.direction, price, roundId, updatedAt, block.number)
        );
        _propose(marketId, m.proposerBond, outcome, evidence, EVIDENCE_URI);
    }

    /// @notice Fallback when the capture window passed without a reading (keeper down, oracle stale). The proposal
    ///         goes through the same challenge window and arbitration as any other.
    function proposeManual(uint256 marketId, IMezonkExchange.Outcome outcome, bytes32 evidenceHash, string calldata evidenceURI)
        external
        onlyOwner
    {
        IMezonkExchange.Market memory m = exchange.getMarket(marketId);
        if (block.timestamp <= uint256(m.closeTime) + captureWindow) revert WindowOpen();
        emit ManualProposal(marketId, outcome, evidenceHash, evidenceURI);
        _propose(marketId, m.proposerBond, outcome, evidenceHash, evidenceURI);
    }

    /// @notice Pull bonds the resolution contract has credited back to this resolver. Anyone may call.
    function withdrawBonds() external returns (uint256) {
        return resolution.withdrawBond();
    }

    /// @notice Move MUSD the resolver doesn't need for bonds.
    function sweep(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert InvalidParams();
        collateral.safeTransfer(to, amount);
        emit Swept(to, amount);
    }

    function _propose(uint256 marketId, uint256 bond, IMezonkExchange.Outcome outcome, bytes32 evidence, string memory uri)
        internal
    {
        collateral.forceApprove(address(resolution), bond);
        resolution.proposeOutcome(marketId, outcome, evidence, uri);
    }
}
