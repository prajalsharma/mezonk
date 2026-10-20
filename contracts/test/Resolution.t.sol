// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {BaseTest} from "./BaseTest.sol";
import {MezonkMarkets} from "../src/MezonkMarkets.sol";
import {IMezonkMarkets} from "../src/interfaces/IMezonkMarkets.sol";
import {ReentrantToken} from "./mocks/MockERC20.sol";

/// @notice Resolution lifecycle tests. Numbers match the required-coverage list in docs/RESOLUTION_DESIGN.md §9.
/// Accounting fuzz/invariants (#19, #22) live in test/invariant and test/FPMMMath.t.sol.
contract ResolutionTest is BaseTest {
    bytes32 constant EV = keccak256("evidence-doc");
    bytes32 constant RAT = keccak256("rationale-doc");

    uint256 id;
    uint256 aliceYes;
    uint256 bobNo;

    function setUp() public override {
        super.setUp();
        id = _create(100 * ONE, 5000);
        aliceYes = _buy(alice, id, true, 30 * ONE);
        bobNo = _buy(bob, id, false, 20 * ONE);
    }

    function _closeAndPropose(IMezonkMarkets.Outcome o) internal {
        vm.warp(closeTime);
        vm.prank(resolver);
        mk.proposeOutcome(id, o, EV, "https://example.org/evidence");
    }

    function _wrongStage(IMezonkMarkets.Stage s) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IMezonkMarkets.WrongStage.selector, s);
    }

    // 1
    function test_01_validProposalAfterClose() public {
        _closeAndPropose(IMezonkMarkets.Outcome.Yes);
        IMezonkMarkets.Market memory m = mk.getMarket(id);
        assertEq(uint8(m.proposedOutcome), uint8(IMezonkMarkets.Outcome.Yes));
        assertEq(m.proposedAt, block.timestamp);
        assertEq(uint8(mk.stageOf(id)), uint8(IMezonkMarkets.Stage.Proposed));
        assertFalse(m.finalized, "proposal must not finalize immediately");
    }

    // 2
    function test_02_proposalBeforeCloseRejected() public {
        vm.warp(closeTime - 1);
        vm.prank(resolver);
        vm.expectRevert(_wrongStage(IMezonkMarkets.Stage.Open));
        mk.proposeOutcome(id, IMezonkMarkets.Outcome.Yes, EV, "");
    }

    // 3
    function test_03_unauthorizedProposalRejected() public {
        vm.warp(closeTime);
        address[3] memory others = [alice, creator, arbitrator];
        for (uint256 i; i < 3; i++) {
            vm.prank(others[i]);
            vm.expectRevert(IMezonkMarkets.NotResolver.selector);
            mk.proposeOutcome(id, IMezonkMarkets.Outcome.Yes, EV, "");
        }
    }

    // 4
    function test_04_invalidOutcomeRejected() public {
        vm.warp(closeTime);
        vm.prank(resolver);
        vm.expectRevert(IMezonkMarkets.InvalidOutcome.selector);
        mk.proposeOutcome(id, IMezonkMarkets.Outcome.None, EV, "");
        // Out-of-range enum values are rejected by the ABI decoder.
        vm.prank(resolver);
        (bool ok,) = address(mk)
            .call(
                abi.encodeWithSignature("proposeOutcome(uint256,uint8,bytes32,string)", id, uint8(4), EV, "")
            );
        assertFalse(ok);
    }

    // 5
    function test_05_missingEvidenceRejected() public {
        vm.warp(closeTime);
        vm.prank(resolver);
        vm.expectRevert(IMezonkMarkets.InvalidParams.selector);
        mk.proposeOutcome(id, IMezonkMarkets.Outcome.Yes, bytes32(0), "https://x");
    }

    // 6
    function test_06_challengeWithinWindow() public {
        _closeAndPropose(IMezonkMarkets.Outcome.Yes);
        vm.warp(block.timestamp + 1 days - 1);
        uint256 before = musd.balanceOf(bob);
        vm.prank(bob);
        mk.dispute(id, EV, "https://example.org/counter");
        assertEq(before - musd.balanceOf(bob), 50 * ONE, "dispute bond pulled");
        assertEq(mk.getMarket(id).disputer, bob);
    }

    // 7
    function test_07_challengeAfterDeadlineRejected() public {
        _closeAndPropose(IMezonkMarkets.Outcome.Yes);
        vm.warp(block.timestamp + 1 days);
        vm.prank(bob);
        vm.expectRevert(IMezonkMarkets.WindowClosed.selector);
        mk.dispute(id, EV, "");
    }

    // 8 — the resolver cannot challenge its own proposal; nobody can challenge without a proposal;
    //     challenges without evidence are rejected.
    function test_08_unauthorizedChallengeRejected() public {
        vm.warp(closeTime);
        vm.prank(bob);
        vm.expectRevert(_wrongStage(IMezonkMarkets.Stage.Closed));
        mk.dispute(id, EV, "");

        vm.prank(resolver);
        mk.proposeOutcome(id, IMezonkMarkets.Outcome.Yes, EV, "");
        vm.prank(resolver);
        vm.expectRevert(IMezonkMarkets.InvalidParams.selector);
        mk.dispute(id, EV, "");
        vm.prank(bob);
        vm.expectRevert(IMezonkMarkets.InvalidParams.selector);
        mk.dispute(id, bytes32(0), "");
    }

    // 9 — and only one challenge per proposal
    function test_09_arbitrationOpensAfterChallenge() public {
        _closeAndPropose(IMezonkMarkets.Outcome.Yes);
        vm.prank(bob);
        mk.dispute(id, EV, "");
        assertEq(uint8(mk.stageOf(id)), uint8(IMezonkMarkets.Stage.Disputed));
        assertEq(mk.getMarket(id).disputedAt, block.timestamp);
        vm.prank(alice);
        vm.expectRevert(_wrongStage(IMezonkMarkets.Stage.Disputed));
        mk.dispute(id, EV, "");
    }

    // 10
    function test_10_unauthorizedArbitrationRejected() public {
        _closeAndPropose(IMezonkMarkets.Outcome.Yes);
        vm.prank(bob);
        mk.dispute(id, EV, "");
        address[4] memory others = [owner, resolver, bob, creator];
        for (uint256 i; i < 4; i++) {
            vm.prank(others[i]);
            vm.expectRevert(IMezonkMarkets.NotArbitrator.selector);
            mk.arbitrate(id, IMezonkMarkets.Outcome.No, RAT, "");
        }
        // Arbitrator cannot act before a dispute exists, nor without a rationale, nor with outcome None.
        closeTime = uint64(block.timestamp + 2 days);
        uint256 id2 = _create(100 * ONE, 5000);
        vm.warp(closeTime);
        vm.prank(arbitrator);
        vm.expectRevert(_wrongStage(IMezonkMarkets.Stage.Closed));
        mk.arbitrate(id2, IMezonkMarkets.Outcome.No, RAT, "");
        vm.prank(arbitrator);
        vm.expectRevert(IMezonkMarkets.InvalidParams.selector);
        mk.arbitrate(id, IMezonkMarkets.Outcome.No, bytes32(0), "");
        vm.prank(arbitrator);
        vm.expectRevert(IMezonkMarkets.InvalidOutcome.selector);
        mk.arbitrate(id, IMezonkMarkets.Outcome.None, RAT, "");
    }

    // 11
    function test_11_noFinalizationWhileUnresolved() public {
        _closeAndPropose(IMezonkMarkets.Outcome.Yes);
        vm.expectRevert(IMezonkMarkets.WindowOpen.selector);
        mk.finalize(id); // challenge window running

        vm.prank(bob);
        mk.dispute(id, EV, "");
        vm.warp(block.timestamp + 2 days); // challenge window over, arbitration still open
        vm.expectRevert(IMezonkMarkets.WindowOpen.selector);
        mk.finalize(id);
        assertFalse(mk.getMarket(id).finalized);
    }

    // 12
    function test_12_finalizeWhenRequirementsMet() public {
        _closeAndPropose(IMezonkMarkets.Outcome.No);
        vm.warp(block.timestamp + 1 days);
        vm.prank(carol); // permissionless
        mk.finalize(id);
        IMezonkMarkets.Market memory m = mk.getMarket(id);
        assertTrue(m.finalized);
        assertEq(uint8(m.finalOutcome), uint8(IMezonkMarkets.Outcome.No));
    }

    // 13
    function test_13_duplicateFinalizationRejected() public {
        test_12_finalizeWhenRequirementsMet();
        vm.expectRevert(_wrongStage(IMezonkMarkets.Stage.Finalized));
        mk.finalize(id);
    }

    // 14 — every bond path
    function test_14a_bond_undisputed_refundedToProposer() public {
        _closeAndPropose(IMezonkMarkets.Outcome.Yes);
        vm.warp(block.timestamp + 1 days);
        mk.finalize(id);
        assertEq(mk.bondCredits(resolver), 50 * ONE);
    }

    function test_14b_bond_arbitratorUpholds_proposerTakesBoth() public {
        _closeAndPropose(IMezonkMarkets.Outcome.Yes);
        vm.prank(bob);
        mk.dispute(id, EV, "");
        vm.prank(arbitrator);
        mk.arbitrate(id, IMezonkMarkets.Outcome.Yes, RAT, "");
        assertEq(mk.bondCredits(resolver), 100 * ONE);
        assertEq(mk.bondCredits(bob), 0);
    }

    function test_14c_bond_arbitratorOverturns_disputerTakesBoth() public {
        _closeAndPropose(IMezonkMarkets.Outcome.Yes);
        vm.prank(bob);
        mk.dispute(id, EV, "");
        vm.prank(arbitrator);
        mk.arbitrate(id, IMezonkMarkets.Outcome.No, RAT, "");
        assertEq(mk.bondCredits(bob), 100 * ONE);
        assertEq(mk.bondCredits(resolver), 0);
    }

    function test_14d_bond_arbitratorRulesInvalid_disputerTakesBoth() public {
        _closeAndPropose(IMezonkMarkets.Outcome.Yes);
        vm.prank(bob);
        mk.dispute(id, EV, "");
        vm.prank(arbitrator);
        mk.arbitrate(id, IMezonkMarkets.Outcome.Invalid, RAT, "");
        assertEq(mk.bondCredits(bob), 100 * ONE);
        assertEq(uint8(mk.getMarket(id).finalOutcome), uint8(IMezonkMarkets.Outcome.Invalid));
    }

    function test_14e_bond_arbitrationTimeout_bothRefunded() public {
        _closeAndPropose(IMezonkMarkets.Outcome.Yes);
        vm.prank(bob);
        mk.dispute(id, EV, "");
        vm.warp(block.timestamp + 7 days);
        mk.finalize(id);
        assertEq(mk.bondCredits(resolver), 50 * ONE);
        assertEq(mk.bondCredits(bob), 50 * ONE);
    }

    function test_14f_bond_withdrawOnce() public {
        test_14a_bond_undisputed_refundedToProposer();
        vm.prank(resolver);
        mk.withdrawBond();
        vm.prank(resolver);
        vm.expectRevert(IMezonkMarkets.NothingToClaim.selector);
        mk.withdrawBond();
    }

    // 15
    function test_15_winningPayoutExact() public {
        _closeAndPropose(IMezonkMarkets.Outcome.Yes);
        vm.warp(block.timestamp + 1 days);
        mk.finalize(id);
        assertEq(mk.claimable(id, alice), aliceYes);
        assertEq(mk.claimable(id, bob), 0, "losing side not claimable");
        uint256 before = musd.balanceOf(alice);
        vm.prank(alice);
        mk.redeem(id);
        assertEq(musd.balanceOf(alice) - before, aliceYes);
    }

    // 16 — both invalid paths: no proposal, and an INVALID proposal accepted
    function test_16a_invalidRefund_noProposal() public {
        vm.warp(closeTime + 3 days);
        mk.finalize(id);
        assertEq(mk.claimable(id, alice), aliceYes / 2);
        assertEq(mk.claimable(id, bob), bobNo / 2);
    }

    function test_16b_invalidRefund_proposedInvalid() public {
        _closeAndPropose(IMezonkMarkets.Outcome.Invalid);
        vm.warp(block.timestamp + 1 days);
        mk.finalize(id);
        vm.prank(bob);
        assertEq(mk.redeem(id), bobNo / 2);
    }

    // 17
    function test_17_claimBeforeEligibleRejected() public {
        _closeAndPropose(IMezonkMarkets.Outcome.Yes);
        assertEq(mk.claimable(id, alice), 0);
        vm.prank(alice);
        vm.expectRevert(_wrongStage(IMezonkMarkets.Stage.Proposed));
        mk.redeem(id);
    }

    // 18
    function test_18_duplicateClaimRejected() public {
        test_15_winningPayoutExact();
        assertEq(mk.claimable(id, alice), 0);
        vm.prank(alice);
        vm.expectRevert(IMezonkMarkets.NothingToClaim.selector);
        mk.redeem(id);
    }

    // 19 — payouts never exceed reserves (deterministic check; fuzzed in invariant suite)
    function test_19_payoutsWithinReserves() public {
        _closeAndPropose(IMezonkMarkets.Outcome.Yes);
        vm.warp(block.timestamp + 1 days);
        mk.finalize(id);
        uint256 reserve = mk.getMarket(id).collateral;
        uint256 owed = mk.claimable(id, alice) + mk.claimable(id, bob) + mk.claimable(id, creator)
            + mk.getMarket(id).poolYes;
        assertLe(owed, reserve);
    }

    // 20
    function test_20_pauseOnlyStopsNewRisk() public {
        vm.prank(owner);
        mk.pause();
        vm.prank(carol);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        mk.buy(id, true, ONE, 0, block.timestamp);
        // Exits stay open: proposal, dispute, arbitration, finalization, claims, bonds.
        _closeAndPropose(IMezonkMarkets.Outcome.Yes);
        vm.prank(bob);
        mk.dispute(id, EV, "");
        vm.prank(arbitrator);
        mk.arbitrate(id, IMezonkMarkets.Outcome.Yes, RAT, "");
        vm.prank(alice);
        assertEq(mk.redeem(id), aliceYes);
        vm.prank(resolver);
        mk.withdrawBond();
    }

    // 21 — reentrancy through a malicious token on claim (see also MezonkMarkets.t.sol)
    function test_21_reentrantBondWithdrawBlocked() public {
        ReentrantToken rt = new ReentrantToken();
        MezonkMarkets m2 = new MezonkMarkets(IERC20(address(rt)), owner, _config());
        vm.prank(owner);
        m2.setResolver(resolver, true);
        _grantPublishing(m2, owner, creator);
        rt.mint(creator, 1000 * ONE);
        rt.mint(resolver, 1000 * ONE);
        vm.prank(creator);
        rt.approve(address(m2), type(uint256).max);
        vm.prank(resolver);
        rt.approve(address(m2), type(uint256).max);
        uint256 mid = _publish(m2, creator, _params(100 * ONE, 5000));
        vm.warp(closeTime);
        vm.prank(resolver);
        m2.proposeOutcome(mid, IMezonkMarkets.Outcome.Yes, EV, "");
        vm.warp(block.timestamp + 1 days);
        m2.finalize(mid);
        rt.arm(address(m2), mid);
        uint256 before = rt.balanceOf(resolver);
        vm.prank(resolver);
        m2.withdrawBond();
        assertTrue(rt.reentered());
        assertEq(bytes4(rt.lastRevert()), bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        assertEq(rt.balanceOf(resolver) - before, 50 * ONE, "paid exactly once");
    }

    // Lifecycle never skips the challenge window, regardless of who calls.
    function testFuzz_cannotFinalizeEarly(uint256 dt, address caller) public {
        _closeAndPropose(IMezonkMarkets.Outcome.Yes);
        dt = bound(dt, 0, 1 days - 1);
        vm.warp(block.timestamp + dt);
        vm.prank(caller);
        vm.expectRevert(IMezonkMarkets.WindowOpen.selector);
        mk.finalize(id);
    }

    // Owner has no path to change an outcome after finalization.
    function test_ownerCannotRewriteFinalOutcome() public {
        test_12_finalizeWhenRequirementsMet();
        vm.startPrank(owner);
        vm.expectRevert(IMezonkMarkets.NotArbitrator.selector);
        mk.arbitrate(id, IMezonkMarkets.Outcome.Yes, RAT, "");
        vm.expectRevert(IMezonkMarkets.NotResolver.selector);
        mk.proposeOutcome(id, IMezonkMarkets.Outcome.Yes, EV, "");
        mk.setConfig(_config());
        vm.stopPrank();
        assertEq(uint8(mk.getMarket(id).finalOutcome), uint8(IMezonkMarkets.Outcome.No));
    }
}
