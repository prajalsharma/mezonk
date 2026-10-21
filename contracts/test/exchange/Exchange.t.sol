// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ExchangeBase} from "./ExchangeBase.sol";
import {IMezonkExchange} from "../../src/interfaces/IMezonkExchange.sol";
import {MezonkResolution} from "../../src/MezonkResolution.sol";
import {MezonkIncentives} from "../../src/MezonkIncentives.sol";
import {MezonkMarketFactory} from "../../src/MezonkMarketFactory.sol";

contract ExchangeSharesTest is ExchangeBase {
    // 1. One unit of collateral creates one YES and one NO.
    function test_splitCreatesCompleteSet() public {
        uint256 id = _liveMarket();
        uint256 before = musd.balanceOf(carol);
        vm.prank(carol);
        ex.split(id, 10 * ONE);
        assertEq(ex.sharesOf(id, YES, carol), 10 * ONE);
        assertEq(ex.sharesOf(id, NO, carol), 10 * ONE);
        assertEq(ex.getMarket(id).collateral, 10 * ONE);
        assertEq(musd.balanceOf(carol), before - 10 * ONE);
        _assertBuckets();
    }

    // 2. A complete set merges back into exactly one unit.
    function test_mergeReturnsCollateral() public {
        uint256 id = _liveMarket();
        vm.startPrank(carol);
        ex.split(id, 10 * ONE);
        uint256 before = musd.balanceOf(carol);
        ex.merge(id, 4 * ONE);
        vm.stopPrank();
        assertEq(musd.balanceOf(carol), before + 4 * ONE);
        assertEq(ex.sharesOf(id, YES, carol), 6 * ONE);
        assertEq(ex.getMarket(id).collateral, 6 * ONE);
        _assertBuckets();
    }

    function test_mergeNeedsBothSides() public {
        uint256 id = _liveMarket();
        vm.startPrank(carol);
        ex.split(id, 10 * ONE);
        ex.transferShares(id, NO, dave, 10 * ONE);
        vm.expectRevert(IMezonkExchange.InsufficientShares.selector);
        ex.merge(id, 1 * ONE);
        vm.stopPrank();
    }

    function test_quantitiesMustBeWholeLots() public {
        uint256 id = _liveMarket();
        vm.prank(carol);
        vm.expectRevert(IMezonkExchange.BadLot.selector);
        ex.split(id, LOT + 1);
    }

    // 3 + 4. Winners redeem 1 per share, losers 0.
    function test_winnerRedeemsOneLoserZero() public {
        uint256 id = _liveMarket();
        vm.prank(carol);
        ex.split(id, 10 * ONE);
        vm.prank(carol);
        ex.transferShares(id, NO, dave, 10 * ONE);
        _resolve(id, IMezonkExchange.Outcome.Yes);

        uint256 c0 = musd.balanceOf(carol);
        vm.prank(carol);
        assertEq(ex.redeem(id), 10 * ONE);
        assertEq(musd.balanceOf(carol), c0 + 10 * ONE);

        uint256 d0 = musd.balanceOf(dave);
        vm.prank(dave);
        assertEq(ex.redeem(id), 0);
        assertEq(musd.balanceOf(dave), d0);
        assertEq(ex.sharesOf(id, NO, dave), 0, "losing shares burned");

        vm.prank(carol);
        vm.expectRevert(IMezonkExchange.NothingToClaim.selector);
        ex.redeem(id); // no double redemption
        _assertBuckets();
    }

    function test_invalidPaysHalfPerShare() public {
        uint256 id = _liveMarket();
        vm.prank(carol);
        ex.split(id, 10 * ONE);
        _close(id);
        vm.warp(block.timestamp + 3 days); // no proposal in time
        res.finalize(id);
        vm.prank(carol);
        assertEq(ex.redeem(id), 10 * ONE); // 10 YES * 0.5 + 10 NO * 0.5
    }

    function test_cannotRedeemBeforeFinal() public {
        uint256 id = _liveMarket();
        vm.prank(carol);
        ex.split(id, 1 * ONE);
        vm.prank(carol);
        vm.expectRevert();
        ex.redeem(id);
    }
}

contract ExchangeOrdersTest is ExchangeBase {
    // 5. Direct match: buyer pays the seller's signed price; fee charged to the taker only.
    function test_signedSellFilledByBuyer() public {
        uint256 id = _liveMarket();
        vm.prank(carol);
        ex.split(id, 50 * ONE);
        IMezonkExchange.Order memory o = _order(carol, id, YES, SELL, 60, 50 * ONE);
        bytes memory sig = _sign(carolPk, o);

        uint256 c0 = musd.balanceOf(carol);
        uint256 d0 = musd.balanceOf(dave);
        uint128 got = _take(dave, id, YES, BUY, 60, 50 * ONE, 0, _one(_src(o, sig)));

        assertEq(got, 50 * ONE);
        assertEq(ex.sharesOf(id, YES, dave), 50 * ONE);
        assertEq(ex.sharesOf(id, YES, carol), 0);
        assertEq(musd.balanceOf(carol), c0 + 30 * ONE, "maker gets exactly 50 x 0.60");
        assertEq(musd.balanceOf(dave), d0 - 30 * ONE - 0.3e18, "taker pays price + 1% fee");
        // fee 0.30: 30% to seeder rebates (0.09), rest protocol (0.21)
        assertEq(inc.rebateReserve(), 0.09e18);
        assertEq(ex.protocolFees(), 0.21e18);
        assertEq(ex.getMarket(id).collateral, 50 * ONE, "no new collateral needed");
        _assertBuckets();
    }

    // Complementary mint: a NO buyer at 40 and a YES buyer at 60 fund one new set each.
    function test_complementBuyMintsSet() public {
        uint256 id = _liveMarket();
        IMezonkExchange.Order memory o = _order(carol, id, NO, BUY, 40, 10 * ONE);
        bytes memory sig = _sign(carolPk, o);
        uint256 c0 = musd.balanceOf(carol);
        uint256 d0 = musd.balanceOf(dave);

        _take(dave, id, YES, BUY, 60, 10 * ONE, 0, _one(_src(o, sig)));

        assertEq(ex.sharesOf(id, NO, carol), 10 * ONE);
        assertEq(ex.sharesOf(id, YES, dave), 10 * ONE);
        assertEq(musd.balanceOf(carol), c0 - 4 * ONE);
        assertEq(musd.balanceOf(dave), d0 - 6 * ONE - 0.06e18);
        assertEq(ex.getMarket(id).collateral, 10 * ONE, "4 + 6 = one unit per set");
        _assertBuckets();
    }

    // Complementary merge: a YES seller and a NO seller burn sets and split the collateral.
    function test_complementSellMergesSet() public {
        uint256 id = _liveMarket();
        vm.prank(carol);
        ex.split(id, 10 * ONE);
        vm.prank(carol);
        ex.transferShares(id, NO, dave, 10 * ONE); // carol: 10 YES, dave: 10 NO
        IMezonkExchange.Order memory o = _order(carol, id, YES, SELL, 70, 10 * ONE);
        bytes memory sig = _sign(carolPk, o);
        uint256 c0 = musd.balanceOf(carol);
        uint256 d0 = musd.balanceOf(dave);

        _take(dave, id, NO, SELL, 30, 10 * ONE, 0, _one(_src(o, sig)));

        assertEq(musd.balanceOf(carol), c0 + 7 * ONE);
        assertEq(musd.balanceOf(dave), d0 + 3 * ONE - 0.03e18);
        assertEq(ex.getMarket(id).collateral, 0);
        _assertBuckets();
    }

    // 6. Invalid signatures revert; replays fill nothing.
    function test_forgedSignatureRejected() public {
        uint256 id = _liveMarket();
        vm.prank(carol);
        ex.split(id, 10 * ONE);
        IMezonkExchange.Order memory o = _order(carol, id, YES, SELL, 60, 10 * ONE);
        bytes memory forged = _sign(davePk, o);
        vm.expectRevert(IMezonkExchange.BadOrderSignature.selector);
        _take(bob, id, YES, BUY, 60, 10 * ONE, 0, _one(_src(o, forged)));

        o.price = 10; // tampered price on a real signature
        bytes memory sig = _sign(carolPk, _order(carol, id, YES, SELL, 60, 10 * ONE));
        vm.expectRevert(IMezonkExchange.BadOrderSignature.selector);
        _take(bob, id, YES, BUY, 60, 10 * ONE, 0, _one(_src(o, sig)));
    }

    function test_replayFillsNothing() public {
        uint256 id = _liveMarket();
        vm.prank(carol);
        ex.split(id, 20 * ONE);
        IMezonkExchange.Order memory o = _order(carol, id, YES, SELL, 60, 10 * ONE);
        bytes memory sig = _sign(carolPk, o);
        _take(dave, id, YES, BUY, 60, 10 * ONE, 0, _one(_src(o, sig)));
        vm.expectRevert(abi.encodeWithSelector(IMezonkExchange.InsufficientLiquidity.selector, uint128(0)));
        _take(dave, id, YES, BUY, 60, 10 * ONE, 0, _one(_src(o, sig)));
        assertEq(ex.sharesOf(id, YES, carol), 10 * ONE, "second batch of shares untouched");
    }

    // 7. Partial fills never exceed the signed quantity.
    function test_partialFillsCapped() public {
        uint256 id = _liveMarket();
        vm.prank(carol);
        ex.split(id, 100 * ONE);
        IMezonkExchange.Order memory o = _order(carol, id, YES, SELL, 60, 50 * ONE);
        bytes memory sig = _sign(carolPk, o);
        assertEq(_take(dave, id, YES, BUY, 60, 20 * ONE, 0, _one(_src(o, sig))), 20 * ONE);
        assertEq(_take(dave, id, YES, BUY, 60, 20 * ONE, 0, _one(_src(o, sig))), 20 * ONE);
        assertEq(_take(dave, id, YES, BUY, 60, 20 * ONE, 0, _one(_src(o, sig))), 10 * ONE);
        assertEq(ex.filledOf(ex.orderHash(o)), 50 * ONE);
        assertEq(ex.sharesOf(id, YES, carol), 50 * ONE);
    }

    // 8. Cancellation, nonce invalidation and expiry.
    function test_cancelledNonceAndExpiredOrdersSkipped() public {
        uint256 id = _liveMarket();
        vm.prank(carol);
        ex.split(id, 30 * ONE);
        IMezonkExchange.Order memory a = _order(carol, id, YES, SELL, 60, 10 * ONE);
        IMezonkExchange.Order memory b = _order(carol, id, YES, SELL, 60, 10 * ONE);
        IMezonkExchange.Order memory c = _order(carol, id, YES, SELL, 60, 10 * ONE);
        c.expiry = uint64(block.timestamp + 10);
        bytes memory sa = _sign(carolPk, a);
        bytes memory sb = _sign(carolPk, b);
        bytes memory sc = _sign(carolPk, c);

        IMezonkExchange.Order[] memory cancel = new IMezonkExchange.Order[](1);
        cancel[0] = a;
        vm.prank(carol);
        ex.cancelSignedOrders(cancel);
        vm.expectRevert(abi.encodeWithSelector(IMezonkExchange.InsufficientLiquidity.selector, uint128(0)));
        _take(dave, id, YES, BUY, 60, 10 * ONE, 0, _one(_src(a, sa)));

        vm.prank(carol);
        ex.raiseMinNonce(1);
        vm.expectRevert(abi.encodeWithSelector(IMezonkExchange.InsufficientLiquidity.selector, uint128(0)));
        _take(dave, id, YES, BUY, 60, 10 * ONE, 0, _one(_src(b, sb)));

        vm.warp(block.timestamp + 11);
        c.nonce = 1;
        sc = _sign(carolPk, c);
        vm.expectRevert(abi.encodeWithSelector(IMezonkExchange.InsufficientLiquidity.selector, uint128(0)));
        _take(dave, id, YES, BUY, 60, 10 * ONE, 0, _one(_src(c, sc)));

        IMezonkExchange.Order[] memory notMine = new IMezonkExchange.Order[](1);
        notMine[0] = b;
        vm.prank(dave);
        vm.expectRevert(IMezonkExchange.NotMaker.selector);
        ex.cancelSignedOrders(notMine);
    }

    // Stale liquidity: a maker who spent the collateral is skipped, not forced.
    function test_unfundedMakerSkipped() public {
        uint256 id = _liveMarket();
        IMezonkExchange.Order memory o = _order(carol, id, NO, BUY, 40, 10 * ONE);
        bytes memory sig = _sign(carolPk, o);
        vm.prank(carol);
        musd.approve(address(ex), 0); // revoked allowance
        vm.expectRevert(abi.encodeWithSelector(IMezonkExchange.InsufficientLiquidity.selector, uint128(0)));
        _take(dave, id, YES, BUY, 60, 10 * ONE, 0, _one(_src(o, sig)));
        assertEq(ex.getMarket(id).collateral, 0);
    }

    function test_sellerWithoutSharesSkipped() public {
        uint256 id = _liveMarket();
        IMezonkExchange.Order memory o = _order(carol, id, YES, SELL, 60, 10 * ONE);
        bytes memory sig = _sign(carolPk, o);
        vm.expectRevert(abi.encodeWithSelector(IMezonkExchange.InsufficientLiquidity.selector, uint128(0)));
        _take(dave, id, YES, BUY, 60, 10 * ONE, 0, _one(_src(o, sig)));
    }

    function test_takerLimitPriceRespected() public {
        uint256 id = _liveMarket();
        vm.prank(carol);
        ex.split(id, 10 * ONE);
        IMezonkExchange.Order memory o = _order(carol, id, YES, SELL, 61, 10 * ONE);
        bytes memory sig = _sign(carolPk, o);
        vm.expectRevert(abi.encodeWithSelector(IMezonkExchange.InsufficientLiquidity.selector, uint128(0)));
        _take(dave, id, YES, BUY, 60, 10 * ONE, 0, _one(_src(o, sig)));
    }

    function test_selfTradeRejected() public {
        uint256 id = _liveMarket();
        vm.prank(carol);
        ex.split(id, 10 * ONE);
        IMezonkExchange.Order memory o = _order(carol, id, YES, SELL, 60, 10 * ONE);
        bytes memory sig = _sign(carolPk, o);
        vm.expectRevert(IMezonkExchange.SelfTrade.selector);
        _take(carol, id, YES, BUY, 60, 10 * ONE, 0, _one(_src(o, sig)));
    }

    function test_restrictedTakerOrder() public {
        uint256 id = _liveMarket();
        vm.prank(carol);
        ex.split(id, 10 * ONE);
        IMezonkExchange.Order memory o = _order(carol, id, YES, SELL, 60, 10 * ONE);
        o.taker = bob;
        bytes memory sig = _sign(carolPk, o);
        vm.expectRevert(abi.encodeWithSelector(IMezonkExchange.InsufficientLiquidity.selector, uint128(0)));
        _take(dave, id, YES, BUY, 60, 10 * ONE, 0, _one(_src(o, sig)));
        assertEq(_take(bob, id, YES, BUY, 60, 10 * ONE, 0, _one(_src(o, sig))), 10 * ONE);
    }

    function test_noTradingBeforeGraduation() public {
        uint256 id = _publish();
        vm.prank(carol);
        vm.expectRevert(IMezonkExchange.NotTradable.selector);
        ex.split(id, ONE);
        IMezonkExchange.Order memory o = _order(carol, id, YES, SELL, 60, ONE);
        IMezonkExchange.Source[] memory srcs = _one(_src(o, _sign(carolPk, o)));
        vm.expectRevert(IMezonkExchange.NotTradable.selector);
        _take(dave, id, YES, BUY, 60, ONE, 0, srcs);
    }

    function test_noTradingAfterClose() public {
        uint256 id = _liveMarket();
        _close(id);
        vm.prank(carol);
        vm.expectRevert(IMezonkExchange.NotTradable.selector);
        ex.split(id, ONE);
    }
}

/// @notice Phase 4: everyone wants YES. Only real, funded counter-liquidity can fill; nothing is invented.
contract AllYesScenarioTest is ExchangeBase {
    function test_allYesFillsOnlyFundedDepthAndNoHousePosition() public {
        uint256 id = _liveMarket();
        // Book after seeding: YES bids 200 @45 (alice, bob BUY YES), YES asks 200 @55 (alice, bob BUY NO @45).
        uint256 orderNoAlice = 2;
        uint256 orderNoBob = 4;
        assertEq(ex.escrowedCollateral(), 180 * ONE);

        uint256 d0 = musd.balanceOf(dave);
        uint256 ownerBal0 = musd.balanceOf(owner);

        // Fill-or-kill for 1000 YES at up to 60: only 200 exist, so it reverts and nothing moves.
        vm.expectRevert(
            abi.encodeWithSelector(IMezonkExchange.InsufficientLiquidity.selector, uint128(200 * ONE))
        );
        _take(dave, id, YES, BUY, 60, 1000 * ONE, 1000 * ONE, _two(_rest(orderNoAlice), _rest(orderNoBob)));
        assertEq(musd.balanceOf(dave), d0);

        // Limit below the best ask: nothing fills.
        vm.expectRevert(abi.encodeWithSelector(IMezonkExchange.InsufficientLiquidity.selector, uint128(0)));
        _take(dave, id, YES, BUY, 50, 1000 * ONE, 0, _two(_rest(orderNoAlice), _rest(orderNoBob)));

        // Fill what exists, cancel the rest (minFill 0): exactly 200 YES at 55.
        uint128 got =
            _take(dave, id, YES, BUY, 60, 1000 * ONE, 0, _two(_rest(orderNoAlice), _rest(orderNoBob)));
        assertEq(got, 200 * ONE, "unfilled 800 is not executed");
        assertEq(ex.sharesOf(id, YES, dave), 200 * ONE);
        assertEq(ex.sharesOf(id, NO, alice), 100 * ONE, "seeders hold the other side");
        assertEq(ex.sharesOf(id, NO, bob), 100 * ONE);
        // Funding: dave 200 x 0.55 = 110 (+1.10 fee); seeders' escrow 200 x 0.45 = 90. 110 + 90 = 200 sets.
        assertEq(musd.balanceOf(dave), d0 - 110 * ONE - 1.1e18);
        assertEq(ex.getMarket(id).collateral, 200 * ONE);
        assertEq(ex.escrowedCollateral(), 90 * ONE, "only the untouched YES bids remain escrowed");
        // Nothing left to sell: the ask side is empty.
        (, uint8 ask) = ex.bestPrices(id);
        assertEq(ask, 0);
        vm.expectRevert(abi.encodeWithSelector(IMezonkExchange.InsufficientLiquidity.selector, uint128(0)));
        _take(carol, id, YES, BUY, 99, 10 * ONE, 0, _two(_rest(orderNoAlice), _rest(orderNoBob)));

        // YES wins. Every winning share is paid from collateral the trades locked; the owner pays nothing.
        _resolve(id, IMezonkExchange.Outcome.Yes);
        vm.prank(dave);
        assertEq(ex.redeem(id), 200 * ONE);
        vm.prank(alice);
        assertEq(ex.redeem(id), 0, "seeders lose their NO side: their risk, not the platform's");
        assertEq(ex.getMarket(id).collateral, 0);
        assertEq(musd.balanceOf(owner), ownerBal0, "operator never paid a winner");
        _assertBuckets();
    }
}

contract SeedingTest is ExchangeBase {
    // 12. One-sided seeding never graduates.
    function test_oneSidedSeedingDoesNotGraduate() public {
        uint256 id = _publish();
        _place(alice, id, YES, BUY, 45, 500 * ONE);
        _place(bob, id, YES, BUY, 44, 500 * ONE);
        IMezonkExchange.GraduationCheck memory g = ex.graduationCheck(id);
        assertEq(g.bestAsk, 0);
        assertFalse(g.spreadOk);
        vm.expectRevert(IMezonkExchange.GraduationUnmet.selector);
        ex.graduate(id);
    }

    function test_wideSpreadOrThinDepthOrOneSeederDoesNotGraduate() public {
        uint256 id = _publish();
        _place(alice, id, YES, BUY, 40, 100 * ONE);
        _place(alice, id, NO, BUY, 45, 100 * ONE); // ask @55: spread 15 > 10
        vm.expectRevert(IMezonkExchange.GraduationUnmet.selector);
        ex.graduate(id);
        _place(alice, id, YES, BUY, 45, 100 * ONE); // spread 10, depth ok, but one seeder
        IMezonkExchange.GraduationCheck memory g = ex.graduationCheck(id);
        assertTrue(g.spreadOk && g.depthOk);
        assertFalse(g.seedersOk);
        vm.expectRevert(IMezonkExchange.GraduationUnmet.selector);
        ex.graduate(id);
        // A dust order from a second wallet does not count as a seeder (needs 10 MUSD escrowed).
        _place(bob, id, YES, BUY, 10, 1 * ONE);
        assertEq(ex.seederCount(id), 1);
        vm.expectRevert(IMezonkExchange.GraduationUnmet.selector);
        ex.graduate(id);
        _place(bob, id, NO, BUY, 40, 30 * ONE);
        ex.graduate(id);
        assertEq(uint8(ex.stageOf(id)), uint8(IMezonkExchange.Stage.Live));
    }

    function test_depthOutsideBandDoesNotCount() public {
        uint256 id = _publish();
        _place(alice, id, YES, BUY, 45, 10 * ONE);
        _place(alice, id, YES, BUY, 30, 500 * ONE); // 15c below best bid, outside the 5c band
        _place(bob, id, NO, BUY, 45, 200 * ONE);
        IMezonkExchange.GraduationCheck memory g = ex.graduationCheck(id);
        assertEq(g.bidDepth, 10 * ONE);
        assertFalse(g.depthOk);
    }

    // 13. Graduation when every criterion holds.
    function test_graduatesWhenAllCriteriaMet() public {
        uint256 id = _publish();
        _seedBook(id);
        IMezonkExchange.GraduationCheck memory g = ex.graduationCheck(id);
        assertEq(g.bestBid, 45);
        assertEq(g.bestAsk, 55);
        assertEq(g.bidDepth, 200 * ONE);
        assertEq(g.askDepth, 200 * ONE);
        assertEq(g.seeders, 2);
        ex.graduate(id);
        assertEq(ex.getMarket(id).graduatedAt, block.timestamp);
        vm.expectRevert(
            abi.encodeWithSelector(IMezonkExchange.WrongStage.selector, IMezonkExchange.Stage.Live)
        );
        ex.graduate(id); // one-time
    }

    // 14. Removing qualifying depth blocks graduation.
    function test_removingDepthBlocksGraduation() public {
        uint256 id = _publish();
        _seedBook(id);
        vm.warp(block.timestamp + 1 hours);
        vm.startPrank(bob);
        ex.cancelOrder(3);
        ex.cancelOrder(4);
        vm.stopPrank();
        assertEq(ex.seederCount(id), 1);
        vm.expectRevert(IMezonkExchange.GraduationUnmet.selector);
        ex.graduate(id);
    }

    function test_seedingAcceptsOnlyEscrowedBuysAndNoCrossing() public {
        uint256 id = _publish();
        vm.prank(alice);
        vm.expectRevert(IMezonkExchange.InvalidParams.selector);
        ex.placeOrder(id, YES, SELL, 50, uint128(ONE));
        _place(alice, id, YES, BUY, 45, 10 * ONE);
        vm.prank(bob);
        vm.expectRevert(IMezonkExchange.CrossesBook.selector);
        ex.placeOrder(id, NO, BUY, 60, uint128(ONE)); // YES ask @40 would cross the 45 bid
    }

    // 15. Failed seeding: every seeder recovers exactly what it escrowed, with no backend involved.
    function test_expiredSeedingRefundsEverything() public {
        uint256 id = _publish();
        uint256 a0 = musd.balanceOf(alice);
        uint256 b0 = musd.balanceOf(bob);
        _place(alice, id, YES, BUY, 45, 100 * ONE);
        _place(bob, id, YES, BUY, 44, 100 * ONE);
        vm.warp(ex.getMarket(id).seedingDeadline + 1);
        assertEq(uint8(ex.stageOf(id)), uint8(IMezonkExchange.Stage.Failed));

        vm.expectRevert(
            abi.encodeWithSelector(IMezonkExchange.WrongStage.selector, IMezonkExchange.Stage.Failed)
        );
        ex.graduate(id);
        vm.prank(carol);
        vm.expectRevert(IMezonkExchange.NotTradable.selector);
        ex.placeOrder(id, YES, BUY, 45, uint128(ONE));

        vm.prank(alice);
        ex.cancelOrder(1);
        vm.prank(bob);
        ex.cancelOrder(2);
        assertEq(musd.balanceOf(alice), a0);
        assertEq(musd.balanceOf(bob), b0);
        assertEq(ex.escrowedCollateral(), 0);
        vm.prank(alice);
        vm.expectRevert(IMezonkExchange.NothingToClaim.selector);
        ex.cancelOrder(1); // no double refund
        // A failed market can never be resolved or pay a winner.
        vm.warp(ex.getMarket(id).closeTime + 1);
        vm.prank(resolver);
        vm.expectRevert(
            abi.encodeWithSelector(MezonkResolution.WrongStage.selector, MezonkResolution.RStage.NotClosed)
        );
        res.proposeOutcome(id, IMezonkExchange.Outcome.Yes, keccak256("e"), "");
        _assertBuckets();
    }

    // 16. Cancellation vs graduation timing: counted orders stay put through launch.
    function test_seedLocksAroundGraduation() public {
        uint256 id = _publish();
        _seedBook(id);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IMezonkExchange.StillLocked.selector, uint64(block.timestamp + 1 hours))
        );
        ex.cancelOrder(1);

        vm.warp(block.timestamp + 2 hours);
        ex.graduate(id);
        uint64 g = uint64(block.timestamp);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IMezonkExchange.StillLocked.selector, g + 1 hours));
        ex.cancelOrder(1);

        vm.warp(block.timestamp + 1 hours);
        uint256 a0 = musd.balanceOf(alice);
        vm.prank(alice);
        ex.cancelOrder(1);
        assertEq(musd.balanceOf(alice), a0 + 45 * ONE);
        assertEq(ex.seedWeight(id, alice), 90 * ONE, "weight frozen at graduation");
    }

    function test_cancelOnlyByMaker() public {
        uint256 id = _publish();
        _place(alice, id, YES, BUY, 45, 10 * ONE);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(bob);
        vm.expectRevert(IMezonkExchange.NotMaker.selector);
        ex.cancelOrder(1);
    }

    // 17. Escrow is used once: a fully filled resting order has nothing left to refund.
    function test_filledEscrowCannotBeRefunded() public {
        uint256 id = _liveMarket();
        _take(dave, id, YES, BUY, 55, 100 * ONE, 0, _one(_rest(2))); // fills alice's NO bid fully
        vm.warp(block.timestamp + 2 hours);
        vm.prank(alice);
        vm.expectRevert(IMezonkExchange.NothingToClaim.selector);
        ex.cancelOrder(2);
        _take(dave, id, YES, BUY, 55, 100 * ONE, 0, _one(_rest(4)));
        vm.expectRevert(abi.encodeWithSelector(IMezonkExchange.InsufficientLiquidity.selector, uint128(0)));
        _take(carol, id, YES, BUY, 55, 100 * ONE, 0, _two(_rest(2), _rest(4)));
        _assertBuckets();
    }

    function test_restingSellAfterGraduationAndSettleAfterClose() public {
        uint256 id = _liveMarket();
        vm.startPrank(carol);
        ex.split(id, 10 * ONE);
        uint256 oid = ex.placeOrder(id, YES, SELL, 50, uint128(10 * ONE));
        vm.stopPrank();
        assertEq(ex.sharesOf(id, YES, carol), 0, "shares escrowed");
        _close(id);
        vm.prank(carol);
        ex.cancelOrder(oid); // always allowed after close
        assertEq(ex.sharesOf(id, YES, carol), 10 * ONE);
    }
}

contract IncentivesTest is ExchangeBase {
    function _trade(uint256 id) internal {
        // dave buys 200 YES @55 against the seed asks: notional 110, fee 1.10, rebate 0.33.
        _take(dave, id, YES, BUY, 55, 200 * ONE, 0, _two(_rest(2), _rest(4)));
    }

    // 19 + 20. Rebates come only from fees and only to seeders, pro rata, isolated from collateral.
    function test_rebatesFundedOnlyByFees() public {
        uint256 id = _liveMarket();
        vm.prank(alice);
        vm.expectRevert(MezonkIncentives.NothingToClaim.selector);
        inc.claimRebate(id); // no fees yet, nothing payable

        _trade(id);
        assertEq(inc.rebateAccrued(id), 0.33e18);
        assertEq(inc.rebateClaimable(id, alice), 0.165e18);
        assertEq(inc.rebateClaimable(id, carol), 0, "non-seeders get nothing");

        uint256 collateralBefore = ex.totalCollateral();
        uint256 a0 = musd.balanceOf(alice);
        vm.prank(alice);
        inc.claimRebate(id);
        assertEq(musd.balanceOf(alice), a0 + 0.165e18);
        assertEq(ex.totalCollateral(), collateralBefore, "collateral untouched");
        vm.prank(alice);
        vm.expectRevert(MezonkIncentives.NothingToClaim.selector);
        inc.claimRebate(id); // no duplicate claim
        _assertBuckets();
    }

    function test_rebatePerWalletCapAndSweep() public {
        IMezonkExchange.Policy memory p = _policy();
        p.rebateCapPerWallet = uint128(0.1e18);
        vm.prank(owner);
        policyId = ex.addPolicy(p);
        uint256 id = _liveMarket();
        _trade(id);
        assertEq(inc.rebateClaimable(id, alice), 0.1e18, "capped");
        vm.prank(alice);
        inc.claimRebate(id);
        vm.prank(bob);
        inc.claimRebate(id);

        vm.expectRevert(MezonkIncentives.WindowOpen.selector);
        inc.sweepRebates(id);
        vm.warp(block.timestamp + 61 days);
        uint256 fees0 = ex.protocolFees();
        inc.sweepRebates(id);
        assertEq(ex.protocolFees(), fees0 + 0.13e18, "0.33 accrued - 0.20 claimed");
        assertEq(inc.rebateReserve(), 0);
        _assertBuckets();
    }

    function test_rebatesStopAfterPeriodAndCapPerMarket() public {
        IMezonkExchange.Policy memory p = _policy();
        p.rebateCapPerMarket = uint128(0.2e18);
        vm.prank(owner);
        policyId = ex.addPolicy(p);
        uint256 id = _liveMarket();
        _trade(id);
        assertEq(inc.rebateAccrued(id), 0.2e18, "per-market cap");
        assertEq(ex.protocolFees(), 1.1e18 - 0.2e18, "the excess stays protocol revenue");
    }

    // 21. Referrals: no self, no two-way, set once before trading, never from your own maker fills.
    function test_referralRules() public {
        uint256 id = _liveMarket();
        vm.prank(dave);
        vm.expectRevert(MezonkIncentives.BadReferrer.selector);
        inc.setReferrer(dave);
        vm.prank(dave);
        inc.setReferrer(carol);
        vm.prank(dave);
        vm.expectRevert(MezonkIncentives.ReferrerLocked.selector);
        inc.setReferrer(bob);
        vm.prank(carol);
        vm.expectRevert(MezonkIncentives.BadReferrer.selector);
        inc.setReferrer(dave); // two-way pair

        _trade(id); // dave takes from alice and bob: carol earns 10% of 1.10
        assertEq(inc.referralCredits(carol), 0.11e18);
        assertEq(ex.protocolFees(), 1.1e18 - 0.33e18 - 0.11e18);

        uint256 c0 = musd.balanceOf(carol);
        vm.prank(carol);
        inc.claimReferral();
        assertEq(musd.balanceOf(carol), c0 + 0.11e18);
        vm.prank(carol);
        vm.expectRevert(MezonkIncentives.NothingToClaim.selector);
        inc.claimReferral();
        _assertBuckets();
    }

    function test_referrerEarnsNothingTradingAgainstOwnReferral() public {
        uint256 id = _liveMarket();
        vm.prank(dave);
        inc.setReferrer(carol);
        vm.prank(carol);
        ex.split(id, 10 * ONE);
        IMezonkExchange.Order memory o = _order(carol, id, YES, SELL, 50, 10 * ONE);
        IMezonkExchange.Source[] memory srcs = _one(_src(o, _sign(carolPk, o)));
        _take(dave, id, YES, BUY, 50, 10 * ONE, 0, srcs);
        assertEq(inc.referralCredits(carol), 0, "wash pair earns no referral");
    }

    function test_cannotSetReferrerAfterTrading() public {
        uint256 id = _liveMarket();
        _trade(id);
        vm.prank(dave);
        vm.expectRevert(MezonkIncentives.ReferrerLocked.selector);
        inc.setReferrer(carol);
    }

    function test_onlyExchangeAccrues() public {
        vm.expectRevert(MezonkIncentives.NotExchange.selector);
        inc.accrue(1, carol, 1e18, 1e18);
    }
}

contract RolesAndResolutionTest is ExchangeBase {
    // 23. On-chain curator authorization and revocation.
    function test_revokedCuratorCannotApprove() public {
        IMezonkExchange.CreateParams memory p = _params();
        (IMezonkExchange.MarketApproval memory a, bytes memory sig) = _approval(p);
        vm.prank(owner);
        fac.setCurator(curator, false);
        vm.prank(creator);
        vm.expectRevert(MezonkMarketFactory.NotCurator.selector);
        fac.createMarket(p, a, curator, sig);
    }

    function test_approvalBindsPolicyAndIsSingleUse() public {
        IMezonkExchange.CreateParams memory p = _params();
        (IMezonkExchange.MarketApproval memory a, bytes memory sig) = _approval(p);
        vm.prank(owner);
        uint32 other = ex.addPolicy(_policy());
        p.policyId = other;
        vm.prank(creator);
        vm.expectRevert(MezonkMarketFactory.ApprovalMismatch.selector);
        fac.createMarket(p, a, curator, sig);
        p.policyId = policyId;
        vm.prank(creator);
        fac.createMarket(p, a, curator, sig);
        vm.prank(creator);
        vm.expectRevert(MezonkMarketFactory.ApprovalUsed.selector);
        fac.createMarket(p, a, curator, sig);
    }

    function test_onlyApprovedCreatorPublishes() public {
        IMezonkExchange.CreateParams memory p = _params();
        (IMezonkExchange.MarketApproval memory a, bytes memory sig) = _approval(p);
        vm.prank(carol);
        vm.expectRevert(MezonkMarketFactory.NotApprovedCreator.selector);
        fac.createMarket(p, a, curator, sig);
    }

    function test_onlyFactoryOpensAndOnlyResolutionSettles() public {
        vm.expectRevert(IMezonkExchange.NotFactory.selector);
        ex.openMarket(creator, resolver, policyId, closeTime, _metadata(), _config());
        uint256 id = _liveMarket();
        _close(id);
        vm.expectRevert(IMezonkExchange.NotResolution.selector);
        ex.settle(id, IMezonkExchange.Outcome.Yes);
    }

    function test_onlyOwnerAdministers() public {
        vm.startPrank(carol);
        vm.expectRevert();
        ex.addPolicy(_policy());
        vm.expectRevert();
        fac.setCurator(carol, true);
        vm.expectRevert();
        ex.withdrawProtocolFees(carol);
        vm.stopPrank();
    }

    function test_policyBoundsEnforced() public {
        IMezonkExchange.Policy memory p = _policy();
        p.rebateShareBps = 7000;
        p.referralShareBps = 2000; // 90% of fees: incentives could exceed what wash trading costs
        vm.prank(owner);
        vm.expectRevert(IMezonkExchange.InvalidConfig.selector);
        ex.addPolicy(p);
    }

    function test_deactivatedPolicyBlocksNewMarketsOnly() public {
        uint256 id = _liveMarket();
        vm.prank(owner);
        ex.setPolicyActive(policyId, false);
        IMezonkExchange.CreateParams memory p = _params();
        (IMezonkExchange.MarketApproval memory a, bytes memory sig) = _approval(p);
        vm.prank(creator);
        vm.expectRevert(IMezonkExchange.PolicyInactive.selector);
        fac.createMarket(p, a, curator, sig);
        vm.prank(carol);
        ex.split(id, ONE); // existing market unaffected
    }

    function test_ownerWithdrawsOnlyFees() public {
        uint256 id = _liveMarket();
        _take(dave, id, YES, BUY, 55, 200 * ONE, 0, _two(_rest(2), _rest(4)));
        uint256 fees = ex.protocolFees();
        uint256 collat = ex.totalCollateral();
        uint256 escrow = ex.escrowedCollateral();
        vm.prank(owner);
        ex.withdrawProtocolFees(owner);
        assertEq(musd.balanceOf(owner), fees);
        assertEq(ex.totalCollateral(), collat);
        assertEq(ex.escrowedCollateral(), escrow);
        _assertBuckets();
    }

    function test_pauseNeverBlocksExits() public {
        uint256 id = _liveMarket();
        vm.prank(carol);
        ex.split(id, 10 * ONE);
        vm.prank(owner);
        ex.pause();
        vm.prank(carol);
        ex.merge(id, 5 * ONE);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(alice);
        ex.cancelOrder(1);
        vm.prank(carol);
        vm.expectRevert();
        ex.split(id, ONE);
    }

    // 25. Resolution, finalization and claim eligibility.
    function test_disputedResolutionAndOneTimeFinality() public {
        uint256 id = _liveMarket();
        vm.prank(carol);
        ex.split(id, 10 * ONE);
        _close(id);
        vm.prank(resolver);
        res.proposeOutcome(id, IMezonkExchange.Outcome.No, keccak256("e"), "ipfs://e");
        vm.prank(dave);
        res.dispute(id, keccak256("d"), "ipfs://d");
        vm.prank(arbitrator);
        res.arbitrate(id, IMezonkExchange.Outcome.Yes, keccak256("r"), "ipfs://r");
        assertTrue(ex.getMarket(id).finalized);
        assertEq(uint8(ex.getMarket(id).finalOutcome), uint8(IMezonkExchange.Outcome.Yes));
        assertEq(res.bondCredits(dave), 100 * ONE, "disputer wins both bonds");

        vm.expectRevert();
        res.finalize(id);
        vm.prank(arbitrator);
        vm.expectRevert();
        res.arbitrate(id, IMezonkExchange.Outcome.No, keccak256("r2"), "");
        vm.prank(carol);
        assertEq(ex.redeem(id), 10 * ONE);
        _assertBuckets();
    }

    function test_resolverCannotProposeBeforeClose() public {
        uint256 id = _liveMarket();
        vm.prank(resolver);
        vm.expectRevert(
            abi.encodeWithSelector(MezonkResolution.WrongStage.selector, MezonkResolution.RStage.NotClosed)
        );
        res.proposeOutcome(id, IMezonkExchange.Outcome.Yes, keccak256("e"), "");
    }
}

contract DerivedAddressesTest is ExchangeBase {
    /// The web app derives these from the exchange address (CREATE nonces 1, 2, 3); keep the order stable.
    function test_childAddressesAreCreateNonces123() public view {
        assertEq(address(res), vm.computeCreateAddress(address(ex), 1));
        assertEq(address(fac), vm.computeCreateAddress(address(ex), 2));
        assertEq(address(inc), vm.computeCreateAddress(address(ex), 3));
    }
}
