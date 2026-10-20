// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {BaseTest} from "./BaseTest.sol";
import {IMezonkMarkets} from "../src/interfaces/IMezonkMarkets.sol";

/// @dev Minimal ERC-1271 curator (stands in for a Safe multisig): approves digests signed by its single owner key.
contract ContractCurator is IERC1271 {
    address public immutable signer;

    constructor(address signer_) {
        signer = signer_;
    }

    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        (address rec,,) = ECDSA.tryRecover(hash, sig);
        return rec == signer ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }
}

/// @notice Market-creation governance: approved creators publish only curator-approved definitions.
contract GovernanceTest is BaseTest {
    IMezonkMarkets.CreateParams p;

    function setUp() public override {
        super.setUp();
        p = _params(100 * ONE, 5000);
    }

    function _signedBy(uint256 pk, address creatorAddr)
        internal
        returns (IMezonkMarkets.MarketApproval memory a, bytes memory sig)
    {
        (a,) = _approval(mk, p, creatorAddr);
        sig = _sign(mk, a, pk);
    }

    function test_approvedCreatorWithCuratorApproval_publishes() public {
        (IMezonkMarkets.MarketApproval memory a, bytes memory sig) = _approval(mk, p, creator);
        vm.expectEmit(true, true, true, true, address(mk));
        emit IMezonkMarkets.MarketApprovalUsed(1, curatorAddr(), a.nonce);
        vm.prank(creator);
        uint256 id = mk.createMarket(p, a, curatorAddr(), sig);
        assertEq(id, 1);
        assertTrue(mk.approvalUsed(a.nonce));
        assertEq(mk.getMarket(id).metadataHash, keccak256(bytes(p.metadata)));
    }

    function test_unauthorizedWallet_cannotPublish_evenWithValidApproval() public {
        (IMezonkMarkets.MarketApproval memory a, bytes memory sig) = _approval(mk, p, alice);
        vm.prank(alice);
        vm.expectRevert(IMezonkMarkets.NotApprovedCreator.selector);
        mk.createMarket(p, a, curatorAddr(), sig);
    }

    function test_suggestionCannotBypassReview_noOrForeignSignature() public {
        // Signed by a key that is not a curator, presented as coming from the curator.
        (IMezonkMarkets.MarketApproval memory a, bytes memory sig) = _signedBy(0xBAD, creator);
        vm.prank(creator);
        vm.expectRevert(IMezonkMarkets.BadApprovalSignature.selector);
        mk.createMarket(p, a, curatorAddr(), sig);
        // Signer named honestly but not a curator.
        vm.prank(creator);
        vm.expectRevert(IMezonkMarkets.NotCurator.selector);
        mk.createMarket(p, a, vm.addr(0xBAD), sig);
        // Empty signature.
        vm.prank(creator);
        vm.expectRevert(IMezonkMarkets.BadApprovalSignature.selector);
        mk.createMarket(p, a, curatorAddr(), "");
    }

    function test_creatorCannotApproveOwnMarket() public {
        uint256 pk = 0xA11CE5;
        address dual = vm.addr(pk);
        vm.startPrank(owner);
        mk.setCreator(dual, true);
        mk.setCurator(dual, true);
        vm.stopPrank();
        musd.mint(dual, 1000 * ONE);
        vm.prank(dual);
        musd.approve(address(mk), type(uint256).max);
        (IMezonkMarkets.MarketApproval memory a, bytes memory sig) = _signedBy(pk, dual);
        vm.prank(dual);
        vm.expectRevert(IMezonkMarkets.SelfApproval.selector);
        mk.createMarket(p, a, dual, sig);
    }

    function test_approvalIsSingleUse() public {
        (IMezonkMarkets.MarketApproval memory a, bytes memory sig) = _approval(mk, p, creator);
        vm.prank(creator);
        mk.createMarket(p, a, curatorAddr(), sig);
        vm.prank(creator);
        vm.expectRevert(IMezonkMarkets.ApprovalUsed.selector);
        mk.createMarket(p, a, curatorAddr(), sig);
    }

    function test_expiredApprovalRejected() public {
        (IMezonkMarkets.MarketApproval memory a, bytes memory sig) = _approval(mk, p, creator);
        vm.warp(uint256(a.deadline) + 1);
        p.closeTime = uint64(block.timestamp + 7 days);
        vm.prank(creator);
        vm.expectRevert(IMezonkMarkets.ApprovalExpired.selector);
        mk.createMarket(p, a, curatorAddr(), sig);
    }

    function test_approvalBindsRulesAndParameters() public {
        (IMezonkMarkets.MarketApproval memory a, bytes memory sig) = _approval(mk, p, creator);

        IMezonkMarkets.CreateParams memory changed = p;
        changed.metadata = '{"v":1,"question":"Different rules than the ones reviewed?"}';
        vm.prank(creator);
        vm.expectRevert(IMezonkMarkets.ApprovalMismatch.selector);
        mk.createMarket(changed, a, curatorAddr(), sig);

        changed = p;
        changed.closeTime = p.closeTime + 1 days;
        vm.prank(creator);
        vm.expectRevert(IMezonkMarkets.ApprovalMismatch.selector);
        mk.createMarket(changed, a, curatorAddr(), sig);

        address otherResolver = makeAddr("otherResolver");
        vm.prank(owner);
        mk.setResolver(otherResolver, true);
        changed = p;
        changed.resolver = otherResolver;
        vm.prank(creator);
        vm.expectRevert(IMezonkMarkets.ApprovalMismatch.selector);
        mk.createMarket(changed, a, curatorAddr(), sig);

        // Tampering with the signed struct itself breaks the signature.
        IMezonkMarkets.MarketApproval memory forged = a;
        forged.deadline = a.deadline + 30 days;
        vm.prank(creator);
        vm.expectRevert(IMezonkMarkets.BadApprovalSignature.selector);
        mk.createMarket(p, forged, curatorAddr(), sig);
    }

    function test_approvalForOneCreatorCannotBeUsedByAnother() public {
        vm.prank(owner);
        mk.setCreator(bob, true);
        (IMezonkMarkets.MarketApproval memory a, bytes memory sig) = _approval(mk, p, creator);
        vm.prank(bob);
        vm.expectRevert(IMezonkMarkets.ApprovalMismatch.selector);
        mk.createMarket(p, a, curatorAddr(), sig);
    }

    function test_revokedRolesStopPublication() public {
        (IMezonkMarkets.MarketApproval memory a, bytes memory sig) = _approval(mk, p, creator);
        vm.prank(owner);
        mk.setCurator(curatorAddr(), false);
        vm.prank(creator);
        vm.expectRevert(IMezonkMarkets.NotCurator.selector);
        mk.createMarket(p, a, curatorAddr(), sig);

        vm.startPrank(owner);
        mk.setCurator(curatorAddr(), true);
        mk.setCreator(creator, false);
        vm.stopPrank();
        vm.prank(creator);
        vm.expectRevert(IMezonkMarkets.NotApprovedCreator.selector);
        mk.createMarket(p, a, curatorAddr(), sig);
    }

    function test_contractWalletCurator_ERC1271() public {
        uint256 pk = 0x5AFE;
        ContractCurator safe = new ContractCurator(vm.addr(pk));
        vm.prank(owner);
        mk.setCurator(address(safe), true);
        (IMezonkMarkets.MarketApproval memory a, bytes memory sig) = _signedBy(pk, creator);
        vm.prank(creator);
        assertEq(mk.createMarket(p, a, address(safe), sig), 1);

        (a, sig) = _signedBy(0xBEEF, creator);
        vm.prank(creator);
        vm.expectRevert(IMezonkMarkets.BadApprovalSignature.selector);
        mk.createMarket(p, a, address(safe), sig);
    }

    function test_onlyOwnerManagesRoles_andEventsEmitted() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        mk.setCreator(alice, true);
        vm.prank(curatorAddr());
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, curatorAddr()));
        mk.setCurator(alice, true);

        vm.expectEmit(true, false, false, true, address(mk));
        emit IMezonkMarkets.CreatorUpdated(bob, true);
        vm.prank(owner);
        mk.setCreator(bob, true);
        vm.expectEmit(true, false, false, true, address(mk));
        emit IMezonkMarkets.CuratorUpdated(bob, true);
        vm.prank(owner);
        mk.setCurator(bob, true);

        vm.prank(owner);
        vm.expectRevert(IMezonkMarkets.InvalidParams.selector);
        mk.setCreator(address(0), true);
    }

    function test_pauseBlocksPublication() public {
        (IMezonkMarkets.MarketApproval memory a, bytes memory sig) = _approval(mk, p, creator);
        vm.prank(owner);
        mk.pause();
        vm.prank(creator);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        mk.createMarket(p, a, curatorAddr(), sig);
    }

    function test_rulesCannotChangeAfterPublication() public {
        uint256 id = _create(100 * ONE, 5000);
        bytes32 h = mk.getMarket(id).metadataHash;
        _buy(alice, id, true, 10 * ONE);
        vm.warp(closeTime);
        vm.prank(resolver);
        mk.proposeOutcome(id, IMezonkMarkets.Outcome.Yes, keccak256("e"), "");
        vm.warp(block.timestamp + 1 days);
        mk.finalize(id);
        // No function writes metadataHash after creation; it is identical across the whole lifecycle.
        assertEq(mk.getMarket(id).metadataHash, h);
    }

    function testFuzz_nonCuratorKeysAlwaysRejected(uint256 pk) public {
        pk = bound(pk, 1, 2 ** 200);
        vm.assume(pk != CURATOR_PK);
        (IMezonkMarkets.MarketApproval memory a, bytes memory sig) = _signedBy(pk, creator);
        vm.prank(creator);
        vm.expectRevert(IMezonkMarkets.BadApprovalSignature.selector);
        mk.createMarket(p, a, curatorAddr(), sig);
    }
}
