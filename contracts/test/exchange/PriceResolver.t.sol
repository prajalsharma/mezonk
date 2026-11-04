// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ExchangeBase} from "./ExchangeBase.sol";
import {IMezonkExchange} from "../../src/interfaces/IMezonkExchange.sol";
import {MezonkResolution} from "../../src/MezonkResolution.sol";
import {MezonkPriceResolver, IExchangeMarkets, IMezoPriceFeed} from "../../src/MezonkPriceResolver.sol";

/// @dev Mezo's PriceFeed and oracle in one: settable price and update time, stale after 60 s like the real feed.
contract MockPriceFeed {
    uint256 public price = 82_000e18;
    uint256 public updatedAt;
    uint80 public round = 7;

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

contract PriceResolverTest is ExchangeBase {
    MezonkPriceResolver internal pr;
    MockPriceFeed internal feed;
    uint256 internal id;
    uint128 internal constant STRIKE = 100_000e18;

    function setUp() public override {
        super.setUp();
        feed = new MockPriceFeed();
        pr = new MezonkPriceResolver(IExchangeMarkets(address(ex)), IMezoPriceFeed(address(feed)), 15 minutes, owner);
        vm.prank(owner);
        fac.setResolver(address(pr), true);
        musd.mint(address(pr), 1_000 * ONE); // bond money
        resolver = address(pr); // markets published below name the price resolver
        id = _liveMarket();
        vm.prank(owner);
        pr.setRule(id, STRIKE, MezonkPriceResolver.Direction.Above);
    }

    function _atClose(uint256 dt, uint256 price) internal {
        vm.warp(ex.getMarket(id).closeTime + dt);
        feed.set(price, block.timestamp);
    }

    function test_settlesYesAboveStrikeAndFinalizes() public {
        _atClose(30, 101_000e18);
        IMezonkExchange.Outcome o = pr.settle(id);
        assertEq(uint8(o), uint8(IMezonkExchange.Outcome.Yes));
        (uint128 price,, uint64 updatedAt,, uint64 blockNumber, IMezonkExchange.Outcome stored) = pr.readings(id);
        assertEq(price, 101_000e18);
        assertEq(updatedAt, block.timestamp);
        assertEq(blockNumber, block.number);
        assertEq(uint8(stored), uint8(IMezonkExchange.Outcome.Yes));
        assertEq(uint8(res.stageOf(id)), uint8(MezonkResolution.RStage.Proposed));
        // Undisputed: finalizes as Yes and the bond comes back to the resolver contract.
        vm.warp(block.timestamp + ex.getMarket(id).challengeWindow);
        res.finalize(id);
        assertEq(uint8(ex.getMarket(id).finalOutcome), uint8(IMezonkExchange.Outcome.Yes));
        uint256 before = musd.balanceOf(address(pr));
        pr.withdrawBonds();
        assertEq(musd.balanceOf(address(pr)) - before, ex.getMarket(id).proposerBond);
    }

    function test_settlesNoBelowStrikeAndAtStrikeIsAbove() public {
        _atClose(5, STRIKE - 1);
        assertEq(uint8(pr.settle(id)), uint8(IMezonkExchange.Outcome.No));
    }

    function test_exactlyAtStrikeCountsAsAbove() public {
        _atClose(5, STRIKE);
        assertEq(uint8(pr.settle(id)), uint8(IMezonkExchange.Outcome.Yes));
    }

    function test_cannotSettleBeforeClose() public {
        vm.warp(ex.getMarket(id).closeTime - 1);
        feed.set(101_000e18, block.timestamp);
        vm.expectRevert(MezonkPriceResolver.TooEarly.selector);
        pr.settle(id);
    }

    function test_rejectsAPriceFromBeforeClose() public {
        uint64 close = ex.getMarket(id).closeTime;
        vm.warp(close - 10);
        feed.set(101_000e18, block.timestamp); // last update 10 s before close, still "fresh" at close + 20
        vm.warp(close + 20);
        vm.expectRevert(MezonkPriceResolver.PriceBeforeClose.selector);
        pr.settle(id);
    }

    function test_staleOracleReverts() public {
        _atClose(0, 101_000e18);
        vm.warp(block.timestamp + 61);
        vm.expectRevert(bytes("PriceFeed: Oracle is stale."));
        pr.settle(id);
    }

    function test_windowClosesThenOwnerProposesByHand() public {
        _atClose(15 minutes + 1, 101_000e18);
        vm.expectRevert(MezonkPriceResolver.WindowClosed.selector);
        pr.settle(id);
        vm.prank(alice);
        vm.expectRevert();
        pr.proposeManual(id, IMezonkExchange.Outcome.Yes, keccak256("manual"), "ipfs://manual");
        vm.prank(owner);
        pr.proposeManual(id, IMezonkExchange.Outcome.Yes, keccak256("manual"), "ipfs://manual");
        assertEq(uint8(res.stageOf(id)), uint8(MezonkResolution.RStage.Proposed));
    }

    function test_manualIsBlockedWhileTheKeeperWindowIsOpen() public {
        _atClose(60, 101_000e18);
        vm.prank(owner);
        vm.expectRevert(MezonkPriceResolver.WindowOpen.selector);
        pr.proposeManual(id, IMezonkExchange.Outcome.No, keccak256("x"), "x");
    }

    function test_settleOnlyOnceAndStillDisputable() public {
        _atClose(30, 99_000e18);
        pr.settle(id);
        vm.expectRevert();
        pr.settle(id);
        vm.prank(alice);
        res.dispute(id, keccak256("wrong"), "ipfs://wrong");
        assertEq(uint8(res.stageOf(id)), uint8(MezonkResolution.RStage.Disputed));
    }

    function test_ruleIsSetOnceByOwnerBeforeCloseForItsOwnMarkets() public {
        vm.prank(owner);
        vm.expectRevert(MezonkPriceResolver.RuleAlreadySet.selector);
        pr.setRule(id, 1, MezonkPriceResolver.Direction.Below);

        vm.prank(alice);
        vm.expectRevert();
        pr.setRule(id, 1, MezonkPriceResolver.Direction.Below);

        resolver = makeAddr("otherResolver");
        vm.prank(owner);
        fac.setResolver(resolver, true);
        uint256 other = _publish();
        vm.prank(owner);
        vm.expectRevert(MezonkPriceResolver.NotThisResolver.selector);
        pr.setRule(other, STRIKE, MezonkPriceResolver.Direction.Above);
    }

    function test_belowDirection() public {
        resolver = address(pr);
        closeTime = uint64(block.timestamp + 10 days);
        uint256 m = _liveMarket();
        vm.prank(owner);
        pr.setRule(m, STRIKE, MezonkPriceResolver.Direction.Below);
        vm.warp(ex.getMarket(m).closeTime + 1);
        feed.set(90_000e18, block.timestamp);
        assertEq(uint8(pr.settle(m)), uint8(IMezonkExchange.Outcome.Yes));
    }

    function test_noRuleNoSettle() public {
        resolver = address(pr);
        closeTime = uint64(block.timestamp + 10 days);
        uint256 m = _liveMarket();
        vm.warp(ex.getMarket(m).closeTime + 1);
        feed.set(90_000e18, block.timestamp);
        vm.expectRevert(MezonkPriceResolver.NoRule.selector);
        pr.settle(m);
    }
}
