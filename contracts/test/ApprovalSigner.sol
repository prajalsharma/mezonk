// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MezonkMarkets} from "../src/MezonkMarkets.sol";
import {IMezonkMarkets} from "../src/interfaces/IMezonkMarkets.sol";

/// @dev Test helper: a curator key that signs real EIP-712 market approvals.
abstract contract ApprovalSigner is Test {
    uint256 internal constant CURATOR_PK = 0xC0FFEE;
    uint256 private _nonceCounter;

    function curatorAddr() internal pure returns (address) {
        return vm.addr(CURATOR_PK);
    }

    function _approval(MezonkMarkets target, IMezonkMarkets.CreateParams memory p, address creatorAddr)
        internal
        returns (IMezonkMarkets.MarketApproval memory a, bytes memory sig)
    {
        a = IMezonkMarkets.MarketApproval({
            metadataHash: keccak256(bytes(p.metadata)),
            creator: creatorAddr,
            resolver: p.resolver,
            closeTime: p.closeTime,
            deadline: uint64(block.timestamp + 1 days),
            nonce: keccak256(abi.encode("approval", ++_nonceCounter))
        });
        sig = _sign(target, a, CURATOR_PK);
    }

    function _sign(MezonkMarkets target, IMezonkMarkets.MarketApproval memory a, uint256 pk)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, target.approvalDigest(a));
        return abi.encodePacked(r, s, v);
    }

    /// @dev Approve with the test curator, then publish as `creatorAddr`.
    function _publish(MezonkMarkets target, address creatorAddr, IMezonkMarkets.CreateParams memory p)
        internal
        returns (uint256)
    {
        (IMezonkMarkets.MarketApproval memory a, bytes memory sig) = _approval(target, p, creatorAddr);
        vm.prank(creatorAddr);
        return target.createMarket(p, a, curatorAddr(), sig);
    }

    /// @dev Expect `createMarket` to revert with `selector` (approval prepared before arming the expectation).
    function _publishExpectRevert(
        MezonkMarkets target,
        address creatorAddr,
        IMezonkMarkets.CreateParams memory p,
        bytes4 selector
    ) internal {
        (IMezonkMarkets.MarketApproval memory a, bytes memory sig) = _approval(target, p, creatorAddr);
        vm.prank(creatorAddr);
        vm.expectRevert(selector);
        target.createMarket(p, a, curatorAddr(), sig);
    }

    /// @dev Grant the roles a fresh deployment needs for publication.
    function _grantPublishing(MezonkMarkets target, address ownerAddr, address creatorAddr) internal {
        vm.startPrank(ownerAddr);
        target.setCreator(creatorAddr, true);
        target.setCurator(curatorAddr(), true);
        vm.stopPrank();
    }
}
