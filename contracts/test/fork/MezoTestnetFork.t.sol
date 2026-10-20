// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ApprovalSigner} from "../ApprovalSigner.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MezonkMarkets} from "../../src/MezonkMarkets.sol";
import {IMezonkMarkets} from "../../src/interfaces/IMezonkMarkets.sol";
import {MezoAddresses} from "../../src/MezoAddresses.sol";

/// @notice Full lifecycle against the real MUSD contract on a fork of Mezo testnet.
/// Run: MEZO_TESTNET_RPC_URL=https://rpc.test.mezo.org forge test --match-path test/fork/*
contract MezoTestnetForkTest is ApprovalSigner {
    IERC20 musd;
    MezonkMarkets mk;
    address owner = makeAddr("owner");
    address resolver = makeAddr("resolver");
    address arbitrator = makeAddr("arbitrator");
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        string memory rpc = vm.envOr("MEZO_TESTNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);
        assertEq(block.chainid, MezoAddresses.TESTNET_CHAIN_ID);
        musd = IERC20(MezoAddresses.MUSD_TESTNET);

        mk = new MezonkMarkets(
            musd,
            owner,
            IMezonkMarkets.Config({
                feeBps: 100,
                protocolFeeShareBps: 5000,
                minDuration: 1 hours,
                maxDuration: 365 days,
                proposalWindow: 3 days,
                challengeWindow: 1 days,
                arbitrationWindow: 7 days,
                minLiquidity: 50e18,
                proposerBond: 25e18,
                disputeBond: 25e18,
                arbitrator: arbitrator
            })
        );
        vm.prank(owner);
        mk.setResolver(resolver, true);
        _grantPublishing(mk, owner, creator);

        address[4] memory users = [creator, alice, bob, resolver];
        for (uint256 i; i < 4; i++) {
            deal(address(musd), users[i], 10_000e18);
            vm.prank(users[i]);
            musd.approve(address(mk), type(uint256).max);
        }
    }

    function test_fork_fullLifecycle_withRealMUSD() public {
        uint256 id = _publish(
            mk,
            creator,
            IMezonkMarkets.CreateParams({
                metadata: '{"v":1,"question":"Fork test market"}',
                closeTime: uint64(block.timestamp + 2 days),
                resolver: resolver,
                initialLiquidity: 500e18,
                initialYesProbBps: 4000
            })
        );
        vm.prank(alice);
        uint256 aliceYes = mk.buy(id, true, 200e18, 0, block.timestamp);
        vm.prank(bob);
        uint256 bobNo = mk.buy(id, false, 100e18, 0, block.timestamp);
        vm.prank(bob);
        mk.sell(id, false, bobNo / 2, 0, block.timestamp);

        vm.warp(block.timestamp + 2 days);
        vm.prank(resolver);
        mk.proposeOutcome(id, IMezonkMarkets.Outcome.Yes, keccak256("evidence"), "ipfs://x");
        vm.warp(block.timestamp + 1 days);
        mk.finalize(id);

        uint256 before = musd.balanceOf(alice);
        vm.prank(alice);
        mk.redeem(id);
        assertEq(musd.balanceOf(alice) - before, aliceYes);

        vm.prank(alice);
        vm.expectRevert(IMezonkMarkets.NothingToClaim.selector);
        mk.redeem(id);

        vm.prank(bob);
        mk.redeem(id);
        vm.startPrank(creator);
        mk.redeem(id);
        mk.claimLiquidity(id);
        mk.claimCreatorFees(id);
        vm.stopPrank();
        vm.prank(resolver);
        mk.withdrawBond();

        assertEq(mk.getMarket(id).collateral, 0);
        assertEq(musd.balanceOf(address(mk)), mk.protocolFees());
    }
}
