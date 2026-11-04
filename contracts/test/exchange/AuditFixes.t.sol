// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ExchangeBase} from "./ExchangeBase.sol";
import {IMezonkExchange} from "../../src/interfaces/IMezonkExchange.sol";
import {MezonkResolution} from "../../src/MezonkResolution.sol";

/// Fixes for the KupiaSec report (rebate dilution) and the two open items from the 2026-10-20 review that carried
/// over to MezonkResolution (self-dispute from a second wallet, silent resolver).
contract AuditFixesTest is ExchangeBase {
    // ── Rebates only for seed escrow inside the graduation band ──

    function test_farOffSeedEarnsNoRebateWeight() public {
        uint256 id = _publish();
        _seedBook(id); // alice and bob: YES bid 45, YES ask 55 (NO bid 45), band 5
        // carol escrows a large YES bid at 1 cent: never fills, far outside the band.
        _place(carol, id, YES, BUY, 1, 100_000 * ONE);
        ex.graduate(id);

        // In-band escrow per seeder: 100 YES @45 + 100 NO @45 = 90 MUSD.
        assertEq(ex.rebateWeight(id, alice), 90 * ONE);
        assertEq(ex.rebateWeight(id, bob), 90 * ONE);
        assertEq(ex.rebateWeight(id, carol), 0, "out-of-band seed gets no rebate weight");
        assertEq(ex.totalRebateWeight(id), 180 * ONE);
        // The old weight is unchanged and still counts toward graduation.
        assertEq(ex.seedWeight(id, carol), 1000 * ONE);
    }

    function test_cancelAfterLaunchKeepsInBandWeightOnly() public {
        uint256 id = _publish();
        _seedBook(id);
        uint256 far = _place(carol, id, YES, BUY, 1, 100_000 * ONE);
        _place(carol, id, YES, BUY, 44, 100 * ONE); // inside the band: 44 >= 45 - 5
        ex.graduate(id);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(carol);
        ex.cancelOrder(far);
        assertEq(ex.rebateWeight(id, carol), 44 * ONE, "only the in-band order counts");
        assertEq(ex.totalRebateWeight(id), 224 * ONE);
    }

    function test_noWeightBeforeGraduation() public {
        uint256 id = _publish();
        _seedBook(id);
        assertEq(ex.rebateWeight(id, alice), 0);
        assertEq(ex.totalRebateWeight(id), 0);
    }

    // ── Silent resolver: anyone may propose after half the proposal window ──

    function test_anyoneProposesAfterHalfTheWindow() public {
        uint256 id = _liveMarket();
        _close(id);
        vm.prank(alice);
        vm.expectRevert(MezonkResolution.NotResolver.selector);
        res.proposeOutcome(id, IMezonkExchange.Outcome.Yes, keccak256("e"), "e");

        vm.warp(block.timestamp + 3 days / 2);
        vm.prank(alice);
        res.proposeOutcome(id, IMezonkExchange.Outcome.Yes, keccak256("e"), "e");
        vm.warp(block.timestamp + 1 days);
        res.finalize(id);
        assertEq(uint8(ex.getMarket(id).finalOutcome), uint8(IMezonkExchange.Outcome.Yes));
        assertEq(res.bondCredits(alice), 50 * ONE, "the proposer, not the resolver, gets the bond back");
        assertEq(res.bondCredits(resolver), 0);
    }

    // ── Self-dispute: the proposer can't dispute itself; a second wallet still loses half the bond ──

    function test_proposerCannotDisputeItsOwnProposal() public {
        uint256 id = _liveMarket();
        _close(id);
        vm.warp(block.timestamp + 3 days / 2);
        vm.prank(alice);
        res.proposeOutcome(id, IMezonkExchange.Outcome.No, keccak256("e"), "e");
        vm.prank(alice);
        vm.expectRevert(MezonkResolution.InvalidParams.selector);
        res.dispute(id, keccak256("d"), "d");
    }

    function test_selfDisputeFromSecondWalletLosesMoney() public {
        uint256 id = _liveMarket();
        _close(id);
        // The resolver proposes a false outcome and disputes it from a second wallet (dave) it controls.
        uint256 before = musd.balanceOf(resolver) + musd.balanceOf(dave);
        vm.prank(resolver);
        res.proposeOutcome(id, IMezonkExchange.Outcome.No, keccak256("false"), "false");
        vm.prank(dave);
        res.dispute(id, keccak256("d"), "d");
        vm.prank(arbitrator);
        res.arbitrate(id, IMezonkExchange.Outcome.Yes, keccak256("r"), "r");
        vm.prank(dave);
        res.withdrawBond();
        uint256 afterBoth = musd.balanceOf(resolver) + musd.balanceOf(dave);
        assertEq(before - afterBoth, 25 * ONE, "the pair is down half the proposer bond");
        assertEq(res.slashedBonds(), 25 * ONE);

        vm.prank(alice);
        vm.expectRevert(MezonkResolution.InvalidParams.selector);
        res.sweepSlashed(alice);
        vm.prank(owner);
        res.sweepSlashed(owner);
        assertEq(musd.balanceOf(owner), 25 * ONE);
        assertEq(res.slashedBonds(), 0);
        assertEq(musd.balanceOf(address(res)), res.lockedBonds() + res.bondCreditsTotal() + res.slashedBonds(), "bond buckets");
    }
}
