// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IMezoPriceFeed, IRoundOracle} from "./MezonkPriceResolver.sol";

/// @title MezonkBtcRounds
/// @notice Bet on BTC going up or down, with BTC. Rounds run back to back on a fixed interval. During a round's
///         betting window you stake native BTC on Up or Down; the stake must be worth between `minStakeUsd` and
///         `maxStakeUsd` at Mezo's PriceFeed price at that moment. At the lock time the price is captured, and one
///         interval later it is captured again. Up wins if the close price is above the lock price, Down if below.
///         Winners split the whole pool in proportion to their stake, less a fee; a tie, a missed price capture, or
///         a round where nobody backed the winning side refunds every stake in full.
///
/// Why a separate contract: the MEZONK exchange settles in MUSD with 1-MUSD shares. This keeps BTC as BTC, with no
/// conversion and no counterparty: the only money in the contract is the stakes, and the only money out is the
/// stakes back (winners' share or refunds) plus the fee the owner sweeps.
///
/// Prices: `priceFeed.fetchPrice()` is the BTC/USD price Mezo itself uses for loans and liquidations. The oracle has
/// no history, so a keeper (anyone) must call `roll` inside `captureWindow` seconds of each lock time. One call
/// captures one price that both closes the previous round and locks the current one, so there is exactly one price
/// per boundary. If nobody rolls in time, the rounds that needed that price are void and refund.
///
/// Round r (0-based): betting from `genesis + r * interval` until `lockTime(r) = genesis + (r + 1) * interval`;
/// price window until `closeTime(r) = lockTime(r) + interval`. Round r+1's betting window is round r's price window,
/// so there is always exactly one round open for bets.
contract MezonkBtcRounds is Ownable2Step, ReentrancyGuard {
    enum Side {
        Up,
        Down
    }

    /// @dev What a round pays. Pending until the price capture that decides it has happened, or its window has passed.
    enum Result {
        Pending,
        Up,
        Down,
        Void
    }

    struct Round {
        uint128 upPool; // BTC staked on Up
        uint128 downPool; // BTC staked on Down
        uint128 lockPrice; // USD per BTC, 18 decimals, 0 until locked
        uint128 closePrice; // 0 until settled
        bool locked;
        bool settled;
        uint128 fee; // taken from the pool at settlement, 0 on refunds
    }

    struct Bet {
        uint128 amount; // BTC staked, 18 decimals
        uint128 usd; // what that was worth when staked, 18 decimals (for display)
        Side side;
        bool claimed;
    }

    uint256 public constant BPS = 10_000;
    uint16 public constant MAX_FEE_BPS = 500; // 5%

    IMezoPriceFeed public immutable priceFeed;
    uint64 public immutable genesis;
    uint32 public immutable interval;
    uint32 public immutable captureWindow;

    uint128 public minStakeUsd;
    uint128 public maxStakeUsd;
    uint16 public feeBps;
    bool public paused;
    uint256 public fees; // accrued, not yet swept

    mapping(uint256 => Round) private _rounds;
    mapping(uint256 => mapping(address => Bet)) private _bets;

    event BetPlaced(uint256 indexed round, address indexed account, Side side, uint256 amount, uint256 usd, uint256 price);
    event Rolled(uint256 indexed round, uint256 price, uint64 updatedAt, uint256 settledRound, Result settledResult);
    event Claimed(address indexed account, uint256 indexed round, uint256 amount);
    event StakeLimitsSet(uint128 minUsd, uint128 maxUsd);
    event FeeSet(uint16 bps);
    event PausedSet(bool paused);
    event FeesSwept(address indexed to, uint256 amount);

    error BettingClosed();
    error InvalidParams();
    error NotYet();
    error WindowClosed();
    error AlreadyRolled();
    error StakeOutsideRange(uint256 usd);
    error OtherSide();
    error NothingToClaim();
    error IsPaused();

    constructor(
        IMezoPriceFeed priceFeed_,
        uint64 genesis_,
        uint32 interval_,
        uint32 captureWindow_,
        uint128 minStakeUsd_,
        uint128 maxStakeUsd_,
        uint16 feeBps_,
        address owner_
    ) Ownable(owner_) {
        if (address(priceFeed_) == address(0)) revert InvalidParams();
        // The capture window must end before the next boundary, or two captures could describe the same round.
        if (interval_ < 5 minutes || captureWindow_ < 60 || captureWindow_ >= interval_) revert InvalidParams();
        if (genesis_ < block.timestamp) revert InvalidParams();
        priceFeed = priceFeed_;
        genesis = genesis_;
        interval = interval_;
        captureWindow = captureWindow_;
        _setStakeLimits(minStakeUsd_, maxStakeUsd_);
        _setFee(feeBps_);
    }

    // ───────────────────────────── Betting ─────────────────────────────

    /// @notice Stake `msg.value` BTC on `side` in `round`. Only the round whose betting window is open accepts bets.
    ///         The stake must be worth `minStakeUsd`..`maxStakeUsd` at the PriceFeed price right now. A wallet
    ///         keeps one side per round; staking again on the same side adds to it.
    function bet(uint256 round, Side side) external payable {
        if (paused) revert IsPaused();
        if (round != currentRound() || block.timestamp >= lockTime(round)) revert BettingClosed();
        uint256 price = priceFeed.fetchPrice(); // reverts if the oracle is stale
        uint256 usd = (msg.value * price) / 1e18;
        if (usd < minStakeUsd || usd > maxStakeUsd) revert StakeOutsideRange(usd);

        Bet storage b = _bets[round][msg.sender];
        if (b.amount != 0 && b.side != side) revert OtherSide();
        b.side = side;
        b.amount += uint128(msg.value);
        b.usd += uint128(usd);

        Round storage r = _rounds[round];
        if (side == Side.Up) r.upPool += uint128(msg.value);
        else r.downPool += uint128(msg.value);
        emit BetPlaced(round, msg.sender, side, msg.value, usd, price);
    }

    // ───────────────────────────── Keeper ─────────────────────────────

    /// @notice Capture the price at `round`'s lock time: it locks `round` and settles `round - 1`. Anyone may call
    ///         it from `lockTime(round)` until `captureWindow` seconds later. The oracle's last update must be at or
    ///         after the lock time, so the price always describes that moment and never one from before it.
    function roll(uint256 round) external {
        uint64 lockAt = lockTime(round);
        if (block.timestamp < lockAt) revert NotYet();
        if (block.timestamp > lockAt + captureWindow) revert WindowClosed();
        Round storage r = _rounds[round];
        if (r.locked) revert AlreadyRolled();

        uint256 price = priceFeed.fetchPrice();
        (, int256 answer,, uint256 updatedAt,) = IRoundOracle(priceFeed.oracle()).latestRoundData();
        if (answer <= 0 || updatedAt < lockAt) revert NotYet();

        r.locked = true;
        r.lockPrice = uint128(price);

        Result settledResult = Result.Pending;
        uint256 prev = round;
        if (round > 0) {
            prev = round - 1;
            Round storage p = _rounds[prev];
            if (p.locked && !p.settled) {
                p.settled = true;
                p.closePrice = uint128(price);
                settledResult = _result(p);
                if (settledResult != Result.Void) {
                    // The fee comes from the losing side only when there is a losing side; refunds pay no fee.
                    uint256 pool = uint256(p.upPool) + p.downPool;
                    uint256 fee = (pool * feeBps) / BPS;
                    p.fee = uint128(fee);
                    fees += fee;
                }
            }
        }
        emit Rolled(round, price, uint64(updatedAt), prev, settledResult);
    }

    // ───────────────────────────── Claims ─────────────────────────────

    /// @notice Collect winnings or refunds for `roundIds`. Pays native BTC. Never expires.
    function claim(uint256[] calldata roundIds) external nonReentrant returns (uint256 total) {
        for (uint256 i = 0; i < roundIds.length; i++) {
            uint256 id = roundIds[i];
            Bet storage b = _bets[id][msg.sender];
            if (b.amount == 0 || b.claimed) continue;
            uint256 amount = _payout(id, b);
            if (amount == 0 && result(id) == Result.Pending) continue; // not decided yet, leave it
            b.claimed = true;
            total += amount;
            emit Claimed(msg.sender, id, amount);
        }
        if (total == 0) revert NothingToClaim();
        (bool ok,) = msg.sender.call{value: total}("");
        require(ok, "transfer failed");
    }

    // ───────────────────────────── Views ─────────────────────────────

    function currentRound() public view returns (uint256) {
        if (block.timestamp < genesis) return 0;
        return (block.timestamp - genesis) / interval;
    }

    function betStart(uint256 round) public view returns (uint64) {
        return uint64(genesis + round * interval);
    }

    function lockTime(uint256 round) public view returns (uint64) {
        return uint64(genesis + (round + 1) * interval);
    }

    function closeTime(uint256 round) public view returns (uint64) {
        return uint64(genesis + (round + 2) * interval);
    }

    function getRound(uint256 round) external view returns (Round memory) {
        return _rounds[round];
    }

    function getBet(uint256 round, address account) external view returns (Bet memory) {
        return _bets[round][account];
    }

    /// @notice What `round` pays, or Pending while it can still be decided.
    function result(uint256 round) public view returns (Result) {
        Round storage r = _rounds[round];
        if (r.settled) return _result(r);
        if (!r.locked) {
            // Never locked: void once the lock capture window has passed.
            return block.timestamp > lockTime(round) + captureWindow ? Result.Void : Result.Pending;
        }
        // Locked, waiting for the close capture: void once that window has passed.
        return block.timestamp > closeTime(round) + captureWindow ? Result.Void : Result.Pending;
    }

    /// @notice What `account` can claim from `round` right now (0 while pending or already claimed).
    function claimable(uint256 round, address account) external view returns (uint256) {
        Bet storage b = _bets[round][account];
        if (b.amount == 0 || b.claimed) return 0;
        return _payout(round, b);
    }

    /// @notice The BTC that `usd` (18 decimals) buys at the PriceFeed price now. The UI uses it to size the chips.
    function btcForUsd(uint256 usd) external view returns (uint256 amount, uint256 price) {
        price = priceFeed.fetchPrice();
        amount = (usd * 1e18) / price;
    }

    // ───────────────────────────── Owner ─────────────────────────────

    function setStakeLimits(uint128 minUsd, uint128 maxUsd) external onlyOwner {
        _setStakeLimits(minUsd, maxUsd);
    }

    function setFee(uint16 bps) external onlyOwner {
        _setFee(bps);
    }

    /// @notice Stops new bets. Rolling and claiming always work, so money never gets stuck.
    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    /// @notice Move accrued fees out. Stakes can't be swept: only `fees` is ever paid here.
    function sweep(address to) external onlyOwner nonReentrant {
        uint256 amount = fees;
        if (amount == 0 || to == address(0)) revert InvalidParams();
        fees = 0;
        (bool ok,) = to.call{value: amount}("");
        require(ok, "transfer failed");
        emit FeesSwept(to, amount);
    }

    // ───────────────────────────── Internal ─────────────────────────────

    function _result(Round storage r) private view returns (Result) {
        if (r.closePrice == r.lockPrice) return Result.Void;
        Result won = r.closePrice > r.lockPrice ? Result.Up : Result.Down;
        // Nobody on the winning side, or nobody on the losing side: there is nothing to win, so everyone is refunded.
        uint128 winners = won == Result.Up ? r.upPool : r.downPool;
        uint128 losers = won == Result.Up ? r.downPool : r.upPool;
        if (winners == 0 || losers == 0) return Result.Void;
        return won;
    }

    function _payout(uint256 round, Bet storage b) private view returns (uint256) {
        Result res = result(round);
        if (res == Result.Pending) return 0;
        if (res == Result.Void) return b.amount;
        if ((res == Result.Up) != (b.side == Side.Up)) return 0;
        Round storage r = _rounds[round];
        uint256 pool = uint256(r.upPool) + r.downPool - r.fee;
        uint256 winners = res == Result.Up ? r.upPool : r.downPool;
        return (uint256(b.amount) * pool) / winners;
    }

    function _setStakeLimits(uint128 minUsd, uint128 maxUsd) private {
        if (minUsd == 0 || maxUsd < minUsd) revert InvalidParams();
        minStakeUsd = minUsd;
        maxStakeUsd = maxUsd;
        emit StakeLimitsSet(minUsd, maxUsd);
    }

    function _setFee(uint16 bps) private {
        if (bps > MAX_FEE_BPS) revert InvalidParams();
        feeBps = bps;
        emit FeeSet(bps);
    }
}
