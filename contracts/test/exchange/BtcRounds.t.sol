// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MezonkBtcRounds} from "../../src/MezonkBtcRounds.sol";
import {IMezoPriceFeed} from "../../src/MezonkPriceResolver.sol";

/// @dev Mezo's PriceFeed and oracle in one: settable price and update time, stale after 60 s like the real feed.
contract MockBtcFeed {
    uint256 public price = 80_000e18;
    uint256 public updatedAt;
    uint80 public round = 1;

    function set(uint256 p, uint256 t) external {
        price = p;
        updatedAt = t;
        round++;
    }

    function oracle() external view returns (address) {
        return address(this);
    }

    function fetchPrice() external view returns (uint256) {
        require(block.timestamp - updatedAt <= 60, "PriceFeed: Oracle is stale.");
        return price;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (round, int256(price), updatedAt, updatedAt, round);
    }
}

contract BtcRoundsTest is Test {
    MezonkBtcRounds internal br;
    MockBtcFeed internal feed;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    uint32 internal constant INTERVAL = 1 hours;
    uint32 internal constant WINDOW = 10 minutes;
    uint128 internal constant MIN_USD = 8e18;
    uint128 internal constant MAX_USD = 125e18;
    uint16 internal constant FEE = 100; // 1%
    uint64 internal genesis;

    function setUp() public {
        vm.warp(1_700_000_000);
        feed = new MockBtcFeed();
        feed.set(80_000e18, block.timestamp);
        genesis = uint64(block.timestamp + 10);
        br = new MezonkBtcRounds(IMezoPriceFeed(address(feed)), genesis, INTERVAL, WINDOW, MIN_USD, MAX_USD, FEE, owner);
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.deal(carol, 10 ether);
        vm.warp(genesis);
    }

    /// BTC worth `usd` at the mock's current price.
    function _btc(uint256 usd) internal view returns (uint256) {
        return (usd * 1e18) / feed.price();
    }

    function _bet(address who, uint256 round, MezonkBtcRounds.Side side, uint256 usd) internal {
        feed.set(feed.price(), block.timestamp);
        uint256 amount = _btc(usd); // computed before the prank: an external call in the arguments would consume it
        vm.prank(who);
        br.bet{value: amount}(round, side);
    }

    /// Move to round `r`'s lock time, set the price, and roll.
    function _rollAt(uint256 r, uint256 price) internal {
        vm.warp(br.lockTime(r) + 5);
        feed.set(price, block.timestamp);
        br.roll(r);
    }

    function _ids(uint256 a) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = a;
    }

    // ── Betting ──

    function test_betSizesInUsdAtThePriceNow() public {
        _bet(alice, 0, MezonkBtcRounds.Side.Up, 25e18);
        MezonkBtcRounds.Bet memory b = br.getBet(0, alice);
        assertEq(b.amount, _btc(25e18));
        assertEq(b.usd, 25e18);
        assertEq(br.getRound(0).upPool, _btc(25e18));
        assertEq(address(br).balance, _btc(25e18));
    }

    function test_stakeOutsideRangeReverts() public {
        feed.set(feed.price(), block.timestamp);
        uint256 v = _btc(5e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MezonkBtcRounds.StakeOutsideRange.selector, 5e18));
        br.bet{value: v}(0, MezonkBtcRounds.Side.Up);
        uint256 v2 = _btc(200e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MezonkBtcRounds.StakeOutsideRange.selector, 200e18));
        br.bet{value: v2}(0, MezonkBtcRounds.Side.Up);
    }

    function test_onlyTheOpenRoundAcceptsBets() public {
        feed.set(feed.price(), block.timestamp);
        uint256 v = _btc(10e18);
        vm.prank(alice);
        vm.expectRevert(MezonkBtcRounds.BettingClosed.selector);
        br.bet{value: v}(1, MezonkBtcRounds.Side.Up);
        vm.warp(br.lockTime(0));
        feed.set(feed.price(), block.timestamp);
        uint256 v2 = _btc(10e18);
        vm.prank(alice);
        vm.expectRevert(MezonkBtcRounds.BettingClosed.selector);
        br.bet{value: v2}(0, MezonkBtcRounds.Side.Up);
        assertEq(br.currentRound(), 1);
    }

    function test_oneSidePerRound() public {
        _bet(alice, 0, MezonkBtcRounds.Side.Up, 10e18);
        _bet(alice, 0, MezonkBtcRounds.Side.Up, 10e18); // adds
        assertEq(br.getBet(0, alice).usd, 20e18);
        feed.set(feed.price(), block.timestamp);
        uint256 v = _btc(10e18);
        vm.prank(alice);
        vm.expectRevert(MezonkBtcRounds.OtherSide.selector);
        br.bet{value: v}(0, MezonkBtcRounds.Side.Down);
    }

    function test_staleOracleBlocksBets() public {
        vm.warp(block.timestamp + 61);
        vm.prank(alice);
        vm.expectRevert(bytes("PriceFeed: Oracle is stale."));
        br.bet{value: 0.001 ether}(0, MezonkBtcRounds.Side.Up);
    }

    // ── Rolling and settling ──

    function test_upWinsAndSplitsPoolLessFee() public {
        _bet(alice, 0, MezonkBtcRounds.Side.Up, 100e18); // 0.00125 BTC
        _bet(bob, 0, MezonkBtcRounds.Side.Up, 50e18); // 0.000625
        _bet(carol, 0, MezonkBtcRounds.Side.Down, 100e18); // 0.00125
        uint256 pool = address(br).balance;

        _rollAt(0, 80_000e18); // lock
        assertEq(uint8(br.result(0)), uint8(MezonkBtcRounds.Result.Pending));
        _rollAt(1, 81_000e18); // close round 0, lock round 1
        assertEq(uint8(br.result(0)), uint8(MezonkBtcRounds.Result.Up));

        uint256 fee = (pool * FEE) / 10_000;
        assertEq(br.fees(), fee);
        uint256 winners = br.getRound(0).upPool;
        uint256 aliceWin = (uint256(br.getBet(0, alice).amount) * (pool - fee)) / winners;
        assertEq(br.claimable(0, alice), aliceWin);
        assertEq(br.claimable(0, carol), 0);

        uint256 before = alice.balance;
        vm.prank(alice);
        br.claim(_ids(0));
        assertEq(alice.balance - before, aliceWin);
        assertEq(br.claimable(0, alice), 0, "claimed once");

        vm.prank(bob);
        br.claim(_ids(0));
        // Everything paid out plus the fee is what came in (dust stays).
        assertLe(address(br).balance - fee, 2);

        vm.prank(carol);
        vm.expectRevert(MezonkBtcRounds.NothingToClaim.selector);
        br.claim(_ids(0));
    }

    function test_downWins() public {
        _bet(alice, 0, MezonkBtcRounds.Side.Up, 10e18);
        _bet(bob, 0, MezonkBtcRounds.Side.Down, 10e18);
        _rollAt(0, 80_000e18);
        _rollAt(1, 79_999e18);
        assertEq(uint8(br.result(0)), uint8(MezonkBtcRounds.Result.Down));
        assertGt(br.claimable(0, bob), br.getBet(0, bob).amount);
        assertEq(br.claimable(0, alice), 0);
    }

    function test_tieRefundsEveryoneNoFee() public {
        _bet(alice, 0, MezonkBtcRounds.Side.Up, 10e18);
        _bet(bob, 0, MezonkBtcRounds.Side.Down, 10e18);
        _rollAt(0, 80_000e18);
        _rollAt(1, 80_000e18);
        assertEq(uint8(br.result(0)), uint8(MezonkBtcRounds.Result.Void));
        assertEq(br.fees(), 0);
        assertEq(br.claimable(0, alice), br.getBet(0, alice).amount);
        assertEq(br.claimable(0, bob), br.getBet(0, bob).amount);
    }

    function test_oneSidedRoundRefunds() public {
        _bet(alice, 0, MezonkBtcRounds.Side.Up, 10e18);
        _rollAt(0, 80_000e18);
        _rollAt(1, 90_000e18); // Up "won" but nobody was on Down: nothing to win
        assertEq(uint8(br.result(0)), uint8(MezonkBtcRounds.Result.Void));
        assertEq(br.claimable(0, alice), br.getBet(0, alice).amount);
        assertEq(br.fees(), 0);
    }

    function test_missedLockVoidsTheRound() public {
        _bet(alice, 0, MezonkBtcRounds.Side.Up, 10e18);
        _bet(bob, 0, MezonkBtcRounds.Side.Down, 10e18);
        vm.warp(br.lockTime(0) + WINDOW + 1);
        feed.set(80_000e18, block.timestamp);
        vm.expectRevert(MezonkBtcRounds.WindowClosed.selector);
        br.roll(0);
        assertEq(uint8(br.result(0)), uint8(MezonkBtcRounds.Result.Void));
        assertEq(br.claimable(0, alice), br.getBet(0, alice).amount);
        // Round 1 can still be locked and go on normally.
        _rollAt(1, 80_000e18);
        assertTrue(br.getRound(1).locked);
    }

    function test_missedCloseVoidsTheRound() public {
        _bet(alice, 0, MezonkBtcRounds.Side.Up, 10e18);
        _bet(bob, 0, MezonkBtcRounds.Side.Down, 10e18);
        _rollAt(0, 80_000e18);
        vm.warp(br.closeTime(0) + WINDOW + 1); // nobody rolled round 1 in time
        assertEq(uint8(br.result(0)), uint8(MezonkBtcRounds.Result.Void));
        assertEq(br.claimable(0, bob), br.getBet(0, bob).amount);
        // Rolling round 2 later must not touch round 0.
        _rollAt(2, 90_000e18);
        assertEq(uint8(br.result(0)), uint8(MezonkBtcRounds.Result.Void));
        assertFalse(br.getRound(0).settled);
    }

    function test_rollRejectsEarlyLateDuplicateAndPreLockPrices() public {
        vm.warp(br.lockTime(0) - 1);
        feed.set(80_000e18, block.timestamp);
        vm.expectRevert(MezonkBtcRounds.NotYet.selector);
        br.roll(0);

        vm.warp(br.lockTime(0) + 5); // oracle last updated before the lock time: not a price for this moment
        vm.expectRevert(MezonkBtcRounds.NotYet.selector);
        br.roll(0);

        feed.set(80_000e18, block.timestamp);
        br.roll(0);
        vm.expectRevert(MezonkBtcRounds.AlreadyRolled.selector);
        br.roll(0);
    }

    function test_claimManyRoundsAtOnceSkipsPending() public {
        _bet(alice, 0, MezonkBtcRounds.Side.Up, 10e18);
        _bet(bob, 0, MezonkBtcRounds.Side.Down, 10e18);
        _rollAt(0, 80_000e18);
        _bet(alice, 1, MezonkBtcRounds.Side.Up, 10e18);
        _bet(bob, 1, MezonkBtcRounds.Side.Down, 10e18);
        _rollAt(1, 81_000e18); // settles 0 (Up), locks 1
        uint256[] memory ids = new uint256[](2);
        ids[0] = 0;
        ids[1] = 1;
        uint256 before = alice.balance;
        vm.prank(alice);
        uint256 paid = br.claim(ids);
        assertEq(alice.balance - before, paid);
        assertEq(paid, br.getBet(0, alice).amount * 2 * 9_900 / 10_000);
        assertTrue(br.getBet(0, alice).claimed);
        assertFalse(br.getBet(1, alice).claimed, "round 1 still pending");
    }

    // ── Owner ──

    function test_ownerSweepsOnlyFeesAndPauseOnlyStopsBets() public {
        _bet(alice, 0, MezonkBtcRounds.Side.Up, 10e18);
        _bet(bob, 0, MezonkBtcRounds.Side.Down, 10e18);
        _rollAt(0, 80_000e18);
        _rollAt(1, 81_000e18);
        uint256 fee = br.fees();
        assertGt(fee, 0);
        vm.prank(alice);
        vm.expectRevert();
        br.sweep(alice);
        vm.prank(owner);
        br.sweep(owner);
        assertEq(owner.balance, fee);
        assertEq(br.fees(), 0);
        vm.prank(owner);
        vm.expectRevert(MezonkBtcRounds.InvalidParams.selector);
        br.sweep(owner);

        vm.prank(owner);
        br.setPaused(true);
        feed.set(feed.price(), block.timestamp);
        uint256 v = _btc(10e18);
        vm.prank(carol);
        vm.expectRevert(MezonkBtcRounds.IsPaused.selector);
        br.bet{value: v}(1, MezonkBtcRounds.Side.Up);
        vm.prank(alice);
        br.claim(_ids(0)); // claims still work
        _rollAt(2, 82_000e18); // rolling still works
    }

    function test_feeCapAndStakeLimits() public {
        vm.prank(owner);
        vm.expectRevert(MezonkBtcRounds.InvalidParams.selector);
        br.setFee(501);
        vm.prank(owner);
        br.setFee(0);
        vm.prank(owner);
        br.setStakeLimits(10e18, 100e18);
        assertEq(br.minStakeUsd(), 10e18);
        (uint256 amount, uint256 price) = br.btcForUsd(100e18);
        assertEq(price, feed.price());
        assertEq(amount, (100e18 * 1e18) / feed.price());
    }

    function testFuzz_poolIsConserved(uint96 a, uint96 b, uint96 c, uint128 closePrice) public {
        // Three stakes within range, two on Up, one on Down; whatever the close price, payouts + fee == pool (minus dust).
        a = uint96(bound(a, _btc(MIN_USD), _btc(MAX_USD)));
        b = uint96(bound(b, _btc(MIN_USD), _btc(MAX_USD)));
        c = uint96(bound(c, _btc(MIN_USD), _btc(MAX_USD)));
        closePrice = uint128(bound(closePrice, 1_000e18, 1_000_000e18));
        feed.set(feed.price(), block.timestamp);
        vm.prank(alice);
        br.bet{value: a}(0, MezonkBtcRounds.Side.Up);
        vm.prank(bob);
        br.bet{value: b}(0, MezonkBtcRounds.Side.Up);
        vm.prank(carol);
        br.bet{value: c}(0, MezonkBtcRounds.Side.Down);
        uint256 pool = address(br).balance;
        _rollAt(0, 80_000e18);
        _rollAt(1, closePrice);
        uint256 paid = br.claimable(0, alice) + br.claimable(0, bob) + br.claimable(0, carol);
        assertLe(paid + br.fees(), pool);
        assertGe(paid + br.fees() + 3, pool, "at most 1 wei of dust per winner");
    }
}
