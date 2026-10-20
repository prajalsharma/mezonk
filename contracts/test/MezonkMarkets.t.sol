// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {BaseTest} from "./BaseTest.sol";
import {MezonkMarkets} from "../src/MezonkMarkets.sol";
import {IMezonkMarkets} from "../src/interfaces/IMezonkMarkets.sol";
import {FeeOnTransferToken, ReentrantToken} from "./mocks/MockERC20.sol";

contract MezonkMarketsTest is BaseTest {
    using {_eq} for IMezonkMarkets.Stage;

    // ───────────── creation ─────────────

    function test_create_seedsPoolAtEvenOdds() public {
        uint256 id = _create(100 * ONE, 5000);
        IMezonkMarkets.Market memory m = mk.getMarket(id);
        assertEq(m.poolYes, 100 * ONE);
        assertEq(m.poolNo, 100 * ONE);
        assertEq(m.collateral, 100 * ONE);
        assertEq(mk.priceYes(id), 0.5e18);
        assertEq(m.metadataHash, keccak256(bytes(_metadata())));
        assertEq(musd.balanceOf(address(mk)), 100 * ONE);
        assertEq(m.feeBps, 100);
        assertEq(m.arbitrator, arbitrator);
    }

    function test_create_skewedOddsGivesCreatorPosition() public {
        uint256 id = _create(100 * ONE, 7000);
        IMezonkMarkets.Market memory m = mk.getMarket(id);
        assertApproxEqAbs(mk.priceYes(id), 0.7e18, 1);
        // Pool + creator YES must equal the sets minted.
        assertEq(m.poolYes + mk.yesBalance(id, creator), m.collateral);
        assertEq(m.poolNo + mk.noBalance(id, creator), m.collateral);
        assertGt(mk.yesBalance(id, creator), 0);
        assertEq(mk.noBalance(id, creator), 0);
    }

    function test_create_reverts_onBadParams() public {
        IMezonkMarkets.CreateParams memory p = IMezonkMarkets.CreateParams({
            metadata: _metadata(),
            closeTime: closeTime,
            resolver: resolver,
            initialLiquidity: 100 * ONE,
            initialYesProbBps: 5000
        });

        p.closeTime = uint64(block.timestamp + 10 minutes);
        _publishExpectRevert(mk, creator, p, IMezonkMarkets.InvalidParams.selector);

        p.closeTime = uint64(block.timestamp + 400 days);
        _publishExpectRevert(mk, creator, p, IMezonkMarkets.InvalidParams.selector);

        p.closeTime = closeTime;
        p.initialLiquidity = 1 * ONE;
        _publishExpectRevert(mk, creator, p, IMezonkMarkets.InvalidParams.selector);

        p.initialLiquidity = 100 * ONE;
        p.initialYesProbBps = 9600;
        _publishExpectRevert(mk, creator, p, IMezonkMarkets.InvalidParams.selector);

        p.initialYesProbBps = 5000;
        p.resolver = alice;
        _publishExpectRevert(mk, creator, p, IMezonkMarkets.NotResolver.selector);

        p.resolver = resolver;
        p.metadata = "";
        _publishExpectRevert(mk, creator, p, IMezonkMarkets.InvalidParams.selector);

        p.metadata = string(new bytes(8193));
        _publishExpectRevert(mk, creator, p, IMezonkMarkets.InvalidParams.selector);
    }

    function test_configChange_doesNotAffectExistingMarket() public {
        uint256 id = _create(100 * ONE, 5000);
        IMezonkMarkets.Config memory c = _config();
        c.feeBps = 500;
        c.challengeWindow = 30 days;
        c.arbitrator = bob;
        vm.prank(owner);
        mk.setConfig(c);

        IMezonkMarkets.Market memory m = mk.getMarket(id);
        assertEq(m.feeBps, 100);
        assertEq(m.challengeWindow, 1 days);
        assertEq(m.arbitrator, arbitrator);
    }

    function test_setConfig_bounds() public {
        IMezonkMarkets.Config memory c = _config();
        c.feeBps = 501;
        vm.prank(owner);
        vm.expectRevert(IMezonkMarkets.InvalidConfig.selector);
        mk.setConfig(c);

        c = _config();
        c.challengeWindow = 10 minutes;
        vm.prank(owner);
        vm.expectRevert(IMezonkMarkets.InvalidConfig.selector);
        mk.setConfig(c);

        c = _config();
        c.disputeBond = 0;
        vm.prank(owner);
        vm.expectRevert(IMezonkMarkets.InvalidConfig.selector);
        mk.setConfig(c);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        mk.setConfig(_config());
    }

    // ───────────── trading ─────────────

    function test_buy_movesPriceAndAccruesFees() public {
        uint256 id = _create(100 * ONE, 5000);
        (uint256 quoted, uint256 quotedFee) = mk.quoteBuy(id, true, 10 * ONE);
        uint256 shares = _buy(alice, id, true, 10 * ONE);

        assertEq(shares, quoted);
        assertEq(quotedFee, 0.1e18);
        assertEq(mk.yesBalance(id, alice), shares);
        assertGt(shares, 10 * ONE * 99 / 100); // more shares than collateral at p<1
        assertGt(mk.priceYes(id), 0.5e18);

        IMezonkMarkets.Market memory m = mk.getMarket(id);
        assertEq(m.collateral, 100 * ONE + 9.9e18);
        assertEq(m.creatorFees, 0.05e18);
        assertEq(mk.protocolFees(), 0.05e18);
        assertEq(m.poolYes + shares, m.collateral);
        assertEq(m.poolNo, m.collateral);
    }

    function test_buy_reverts_onSlippageDeadlineAndClose() public {
        uint256 id = _create(100 * ONE, 5000);
        (uint256 quoted,) = mk.quoteBuy(id, true, 10 * ONE);

        vm.prank(alice);
        vm.expectRevert(IMezonkMarkets.Slippage.selector);
        mk.buy(id, true, 10 * ONE, quoted + 1, block.timestamp);

        vm.prank(alice);
        vm.expectRevert(IMezonkMarkets.Expired.selector);
        mk.buy(id, true, 10 * ONE, 0, block.timestamp - 1);

        vm.warp(closeTime);
        vm.prank(alice);
        vm.expectRevert(IMezonkMarkets.NotTradable.selector);
        mk.buy(id, true, 10 * ONE, 0, block.timestamp);
    }

    function test_buy_reverts_unknownMarket() public {
        vm.prank(alice);
        vm.expectRevert(IMezonkMarkets.UnknownMarket.selector);
        mk.buy(42, true, ONE, 0, block.timestamp);
    }

    function test_sell_roundTripLosesOnlyFeesAndRounding() public {
        uint256 id = _create(100 * ONE, 5000);
        uint256 before = musd.balanceOf(alice);
        uint256 shares = _buy(alice, id, false, 20 * ONE);
        (uint256 quotedOut,) = mk.quoteSell(id, false, shares);
        vm.prank(alice);
        uint256 out = mk.sell(id, false, shares, quotedOut, block.timestamp);
        assertEq(out, quotedOut);
        uint256 lost = before - musd.balanceOf(alice);
        // 1% in + ~1% out, never a profit.
        assertGt(lost, 0);
        assertLe(lost, 0.41e18);
        assertEq(mk.noBalance(id, alice), 0);
    }

    function test_sell_reverts_insufficientShares() public {
        uint256 id = _create(100 * ONE, 5000);
        _buy(alice, id, true, 5 * ONE);
        vm.prank(bob);
        vm.expectRevert(); // arithmetic underflow
        mk.sell(id, true, ONE, 0, block.timestamp);
    }

    function test_sell_reverts_afterClose() public {
        uint256 id = _create(100 * ONE, 5000);
        uint256 s = _buy(alice, id, true, 5 * ONE);
        vm.warp(closeTime + 1);
        vm.prank(alice);
        vm.expectRevert(IMezonkMarkets.NotTradable.selector);
        mk.sell(id, true, s, 0, block.timestamp);
    }

    // ───────────── resolution ─────────────

    function test_propose_access_and_windows() public {
        uint256 id = _create(100 * ONE, 5000);

        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(IMezonkMarkets.WrongStage.selector, IMezonkMarkets.Stage.Open));
        mk.proposeOutcome(id, IMezonkMarkets.Outcome.Yes, keccak256("e"), "");

        vm.warp(closeTime);
        vm.prank(alice);
        vm.expectRevert(IMezonkMarkets.NotResolver.selector);
        mk.proposeOutcome(id, IMezonkMarkets.Outcome.Yes, keccak256("e"), "");

        vm.prank(resolver);
        vm.expectRevert(IMezonkMarkets.InvalidOutcome.selector);
        mk.proposeOutcome(id, IMezonkMarkets.Outcome.None, keccak256("e"), "");

        vm.prank(resolver);
        vm.expectRevert(IMezonkMarkets.InvalidParams.selector);
        mk.proposeOutcome(id, IMezonkMarkets.Outcome.Yes, bytes32(0), "");

        vm.warp(closeTime + 3 days);
        vm.prank(resolver);
        vm.expectRevert(IMezonkMarkets.WindowClosed.selector);
        mk.proposeOutcome(id, IMezonkMarkets.Outcome.Yes, keccak256("e"), "");
    }

    function test_undisputedFlow_paysWinnersExactly() public {
        uint256 id = _create(100 * ONE, 5000);
        uint256 aliceYes = _buy(alice, id, true, 30 * ONE);
        uint256 bobNo = _buy(bob, id, false, 10 * ONE);
        assertGt(bobNo, 0);

        vm.warp(closeTime);
        _propose(id, IMezonkMarkets.Outcome.Yes);
        assertTrue(mk.stageOf(id)._eq(IMezonkMarkets.Stage.Proposed));

        vm.expectRevert(IMezonkMarkets.WindowOpen.selector);
        mk.finalize(id);

        vm.warp(block.timestamp + 1 days);
        mk.finalize(id);
        IMezonkMarkets.Market memory m = mk.getMarket(id);
        assertTrue(m.finalized);
        assertEq(uint8(m.finalOutcome), uint8(IMezonkMarkets.Outcome.Yes));
        assertEq(mk.bondCredits(resolver), 50 * ONE);

        uint256 balBefore = musd.balanceOf(alice);
        assertEq(mk.claimable(id, alice), aliceYes);
        vm.prank(alice);
        uint256 paid = mk.redeem(id);
        assertEq(paid, aliceYes);
        assertEq(musd.balanceOf(alice) - balBefore, aliceYes);

        // Second claim fails.
        vm.prank(alice);
        vm.expectRevert(IMezonkMarkets.NothingToClaim.selector);
        mk.redeem(id);

        // Loser redeems for zero and their shares are burned.
        vm.prank(bob);
        assertEq(mk.redeem(id), 0);
        assertEq(mk.noBalance(id, bob), 0);
    }

    function test_dispute_rulesForDisputer_bondsMoveToDisputer() public {
        uint256 id = _create(100 * ONE, 5000);
        _buy(alice, id, false, 10 * ONE);
        vm.warp(closeTime);
        _propose(id, IMezonkMarkets.Outcome.Yes);

        vm.prank(resolver);
        vm.expectRevert(IMezonkMarkets.InvalidParams.selector);
        mk.dispute(id, keccak256("d"), "");

        vm.prank(alice);
        mk.dispute(id, keccak256("counter"), "ipfs://counter");
        assertTrue(mk.stageOf(id)._eq(IMezonkMarkets.Stage.Disputed));

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(IMezonkMarkets.WrongStage.selector, IMezonkMarkets.Stage.Disputed)
        );
        mk.dispute(id, keccak256("x"), "");

        vm.prank(resolver);
        vm.expectRevert(IMezonkMarkets.NotArbitrator.selector);
        mk.arbitrate(id, IMezonkMarkets.Outcome.Yes, keccak256("rationale"), "ipfs://rationale");

        vm.prank(arbitrator);
        mk.arbitrate(id, IMezonkMarkets.Outcome.No, keccak256("rationale"), "ipfs://rationale");
        assertEq(mk.bondCredits(alice), 100 * ONE);
        assertEq(mk.bondCredits(resolver), 0);
        assertEq(uint8(mk.getMarket(id).finalOutcome), uint8(IMezonkMarkets.Outcome.No));

        vm.prank(alice);
        mk.withdrawBond();
        assertEq(mk.bondCredits(alice), 0);
    }

    function test_dispute_rulesForProposer_bondsMoveToResolver() public {
        uint256 id = _create(100 * ONE, 5000);
        vm.warp(closeTime);
        _propose(id, IMezonkMarkets.Outcome.Yes);
        vm.prank(bob);
        mk.dispute(id, keccak256("d"), "");
        vm.prank(arbitrator);
        mk.arbitrate(id, IMezonkMarkets.Outcome.Yes, keccak256("rationale"), "ipfs://rationale");
        assertEq(mk.bondCredits(resolver), 100 * ONE);
        assertEq(mk.bondCredits(bob), 0);
    }

    function test_dispute_afterChallengeWindow_reverts() public {
        uint256 id = _create(100 * ONE, 5000);
        vm.warp(closeTime);
        _propose(id, IMezonkMarkets.Outcome.Yes);
        vm.warp(block.timestamp + 1 days);
        vm.prank(bob);
        vm.expectRevert(IMezonkMarkets.WindowClosed.selector);
        mk.dispute(id, keccak256("d"), "");
    }

    function test_noProposal_settlesInvalid_halfPerShare() public {
        uint256 id = _create(100 * ONE, 5000);
        uint256 y = _buy(alice, id, true, 10 * ONE);
        vm.warp(closeTime + 1 days);
        vm.expectRevert(IMezonkMarkets.WindowOpen.selector);
        mk.finalize(id);

        vm.warp(closeTime + 3 days);
        mk.finalize(id);
        assertEq(uint8(mk.getMarket(id).finalOutcome), uint8(IMezonkMarkets.Outcome.Invalid));
        vm.prank(alice);
        assertEq(mk.redeem(id), y / 2);
    }

    function test_arbitrationTimeout_settlesInvalid_refundsBothBonds() public {
        uint256 id = _create(100 * ONE, 5000);
        vm.warp(closeTime);
        _propose(id, IMezonkMarkets.Outcome.Yes);
        vm.prank(bob);
        mk.dispute(id, keccak256("d"), "");

        vm.warp(block.timestamp + 7 days);
        vm.prank(arbitrator);
        vm.expectRevert(IMezonkMarkets.WindowClosed.selector);
        mk.arbitrate(id, IMezonkMarkets.Outcome.No, keccak256("rationale"), "ipfs://rationale");

        mk.finalize(id);
        assertEq(uint8(mk.getMarket(id).finalOutcome), uint8(IMezonkMarkets.Outcome.Invalid));
        assertEq(mk.bondCredits(resolver), 50 * ONE);
        assertEq(mk.bondCredits(bob), 50 * ONE);
    }

    function test_finalized_cannotBeResolvedAgain() public {
        uint256 id = _create(100 * ONE, 5000);
        vm.warp(closeTime);
        _propose(id, IMezonkMarkets.Outcome.No);
        vm.warp(block.timestamp + 1 days);
        mk.finalize(id);

        vm.expectRevert(
            abi.encodeWithSelector(IMezonkMarkets.WrongStage.selector, IMezonkMarkets.Stage.Finalized)
        );
        mk.finalize(id);
        vm.prank(resolver);
        vm.expectRevert(
            abi.encodeWithSelector(IMezonkMarkets.WrongStage.selector, IMezonkMarkets.Stage.Finalized)
        );
        mk.proposeOutcome(id, IMezonkMarkets.Outcome.Yes, keccak256("e"), "");
        vm.prank(arbitrator);
        vm.expectRevert(
            abi.encodeWithSelector(IMezonkMarkets.WrongStage.selector, IMezonkMarkets.Stage.Finalized)
        );
        mk.arbitrate(id, IMezonkMarkets.Outcome.Yes, keccak256("rationale"), "ipfs://rationale");
    }

    function test_redeem_beforeFinal_reverts() public {
        uint256 id = _create(100 * ONE, 5000);
        _buy(alice, id, true, ONE);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IMezonkMarkets.WrongStage.selector, IMezonkMarkets.Stage.Open));
        mk.redeem(id);
    }

    // ───────────── creator + protocol ─────────────

    function test_liquidityAndFees_claims() public {
        uint256 id = _create(100 * ONE, 5000);
        _buy(alice, id, true, 40 * ONE);
        _buy(bob, id, false, 10 * ONE);

        vm.prank(alice);
        vm.expectRevert(IMezonkMarkets.NotCreator.selector);
        mk.claimCreatorFees(id);

        vm.prank(creator);
        uint256 fees = mk.claimCreatorFees(id);
        assertEq(fees, 0.25e18);

        vm.warp(closeTime);
        _propose(id, IMezonkMarkets.Outcome.No);
        vm.warp(block.timestamp + 1 days);
        mk.finalize(id);

        IMezonkMarkets.Market memory m = mk.getMarket(id);
        vm.prank(creator);
        assertEq(mk.claimLiquidity(id), m.poolNo);
        vm.prank(creator);
        vm.expectRevert(IMezonkMarkets.NothingToClaim.selector);
        mk.claimLiquidity(id);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        mk.withdrawProtocolFees(alice);
        vm.prank(owner);
        mk.withdrawProtocolFees(owner);
        assertEq(musd.balanceOf(owner), 0.25e18);
    }

    function test_fullSettlement_leavesOnlyDust() public {
        uint256 id = _create(100 * ONE, 6000);
        _buy(alice, id, true, 33 * ONE);
        _buy(bob, id, false, 17 * ONE);
        _buy(carol, id, true, 7 * ONE);
        uint256 s = mk.yesBalance(id, carol) / 3;
        vm.prank(carol);
        mk.sell(id, true, s, 0, block.timestamp);

        vm.warp(closeTime);
        _propose(id, IMezonkMarkets.Outcome.Yes);
        vm.warp(block.timestamp + 1 days);
        mk.finalize(id);

        address[4] memory holders = [alice, bob, carol, creator];
        for (uint256 i; i < holders.length; i++) {
            if (mk.yesBalance(id, holders[i]) + mk.noBalance(id, holders[i]) > 0) {
                vm.prank(holders[i]);
                mk.redeem(id);
            }
        }
        vm.startPrank(creator);
        mk.claimLiquidity(id);
        mk.claimCreatorFees(id);
        vm.stopPrank();
        vm.prank(resolver);
        mk.withdrawBond();

        // YES won: every outstanding YES share paid out 1:1, nothing left in collateral.
        assertEq(mk.getMarket(id).collateral, 0);
        assertEq(musd.balanceOf(address(mk)), mk.protocolFees());
    }

    // ───────────── pause ─────────────

    function test_pause_blocksTradingButNotExit() public {
        uint256 id = _create(100 * ONE, 5000);
        _buy(alice, id, true, 10 * ONE);
        vm.prank(owner);
        mk.pause();

        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        mk.buy(id, true, ONE, 0, block.timestamp);

        vm.warp(closeTime);
        _propose(id, IMezonkMarkets.Outcome.Yes);
        vm.warp(block.timestamp + 1 days);
        mk.finalize(id);
        vm.prank(alice);
        assertGt(mk.redeem(id), 0);
    }

    // ───────────── adversarial tokens ─────────────

    function test_feeOnTransferToken_rejected() public {
        FeeOnTransferToken fot = new FeeOnTransferToken();
        MezonkMarkets m2 = new MezonkMarkets(IERC20(address(fot)), owner, _config());
        vm.prank(owner);
        m2.setResolver(resolver, true);
        _grantPublishing(m2, owner, creator);
        fot.mint(creator, 1000 * ONE);
        vm.prank(creator);
        fot.approve(address(m2), type(uint256).max);
        _publishExpectRevert(m2, creator, _params(100 * ONE, 5000), IMezonkMarkets.UnsupportedToken.selector);
    }

    function test_reentrancy_onRedeem_isBlocked() public {
        ReentrantToken rt = new ReentrantToken();
        MezonkMarkets m2 = new MezonkMarkets(IERC20(address(rt)), owner, _config());
        vm.prank(owner);
        m2.setResolver(resolver, true);
        _grantPublishing(m2, owner, creator);
        address[3] memory users = [creator, alice, resolver];
        for (uint256 i; i < 3; i++) {
            rt.mint(users[i], 1000 * ONE);
            vm.prank(users[i]);
            rt.approve(address(m2), type(uint256).max);
        }
        uint256 id = _publish(m2, creator, _params(100 * ONE, 5000));
        vm.prank(alice);
        uint256 y = m2.buy(id, true, 10 * ONE, 0, block.timestamp);
        vm.warp(closeTime);
        vm.prank(resolver);
        m2.proposeOutcome(id, IMezonkMarkets.Outcome.Yes, keccak256("e"), "");
        vm.warp(block.timestamp + 1 days);
        m2.finalize(id);

        rt.arm(address(m2), id);
        uint256 before = rt.balanceOf(alice);
        vm.prank(alice);
        m2.redeem(id);
        assertTrue(rt.reentered());
        // The nested call reverted with ReentrancyGuardReentrantCall; alice was paid once.
        assertEq(bytes4(rt.lastRevert()), bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        assertEq(rt.balanceOf(alice) - before, y);
    }
}

function _eq(IMezonkMarkets.Stage a, IMezonkMarkets.Stage b) pure returns (bool) {
    return a == b;
}
