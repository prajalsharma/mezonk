// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MezonkExchange} from "../../src/MezonkExchange.sol";
import {MezonkMarketFactory} from "../../src/MezonkMarketFactory.sol";
import {MezonkResolution} from "../../src/MezonkResolution.sol";
import {IMezonkExchange} from "../../src/interfaces/IMezonkExchange.sol";
import {MezoAddresses} from "../../src/MezoAddresses.sol";

/// @notice Seeding → graduation → fills → resolution → redemption against the REAL MUSD contract on a fork of
///         Mezo testnet (no mock token). Exact balances asserted.
/// Run: MEZO_TESTNET_RPC_URL=https://rpc.test.mezo.org forge test --match-path 'test/fork/*'
contract ExchangeTestnetForkTest is Test {
    IERC20 musd;
    MezonkExchange ex;
    MezonkMarketFactory fac;
    MezonkResolution res;
    uint256 constant CURATOR_PK = 0xC0FFEE;
    address owner = makeAddr("owner");
    address resolver = makeAddr("resolver");
    address arbitrator = makeAddr("arbitrator");
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    uint32 policyId;

    function setUp() public {
        string memory rpc = vm.envOr("MEZO_TESTNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);
        assertEq(block.chainid, MezoAddresses.TESTNET_CHAIN_ID);
        musd = IERC20(MezoAddresses.MUSD_TESTNET);
        ex = new MezonkExchange(
            musd,
            owner,
            IMezonkExchange.Config({
                minLiveDuration: 1 hours,
                maxDuration: 365 days,
                proposalWindow: 3 days,
                challengeWindow: 1 days,
                arbitrationWindow: 7 days,
                proposerBond: 25e18,
                disputeBond: 25e18,
                arbitrator: arbitrator
            })
        );
        fac = ex.factory();
        res = ex.resolution();
        vm.startPrank(owner);
        fac.setResolver(resolver, true);
        fac.setCreator(creator, true);
        fac.setCurator(vm.addr(CURATOR_PK), true);
        policyId = ex.addPolicy(
            IMezonkExchange.Policy({
                minBidDepth: 50e18,
                minAskDepth: 50e18,
                minSeederNotional: 10e18,
                minSeeders: 2,
                maxSpread: 10,
                band: 5,
                seedingPeriod: 1 days,
                minRest: 1 hours,
                takerFeeBps: 100,
                rebateShareBps: 2000,
                referralShareBps: 1000,
                rebatePeriod: 30 days,
                claimWindow: 30 days,
                rebateCapPerMarket: 1000e18,
                rebateCapPerWallet: 200e18,
                rebateBudget: 10_000e18,
                referralCapPerMarket: 50e18
            })
        );
        vm.stopPrank();
        address[4] memory users = [alice, bob, carol, resolver];
        for (uint256 i; i < 4; i++) {
            deal(address(musd), users[i], 10_000e18);
            vm.startPrank(users[i]);
            musd.approve(address(ex), type(uint256).max);
            musd.approve(address(res), type(uint256).max);
            vm.stopPrank();
        }
    }

    function test_fork_orderBookLifecycle_withRealMUSD() public {
        string memory meta = '{"v":1,"question":"Fork test: real MUSD order book"}';
        IMezonkExchange.CreateParams memory p = IMezonkExchange.CreateParams({
            metadata: meta,
            closeTime: uint64(block.timestamp + 3 days),
            resolver: resolver,
            policyId: policyId
        });
        IMezonkExchange.MarketApproval memory a = IMezonkExchange.MarketApproval({
            metadataHash: keccak256(bytes(meta)),
            creator: creator,
            resolver: resolver,
            closeTime: p.closeTime,
            policyId: policyId,
            deadline: uint64(block.timestamp + 1 days),
            nonce: keccak256("fork")
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CURATOR_PK, fac.approvalDigest(a));
        vm.prank(creator);
        uint256 id = fac.createMarket(p, a, vm.addr(CURATOR_PK), abi.encodePacked(r, s, v));

        vm.prank(alice);
        ex.placeOrder(id, 0, IMezonkExchange.Side.Buy, 45, 60e18); // Yes bid 45
        vm.prank(bob);
        uint256 noBid = ex.placeOrder(id, 1, IMezonkExchange.Side.Buy, 45, 60e18); // Yes ask 55
        ex.graduate(id);

        uint256 c0 = musd.balanceOf(carol);
        IMezonkExchange.Source[] memory src = new IMezonkExchange.Source[](1);
        src[0].restingId = noBid;
        vm.prank(carol);
        uint128 got = ex.take(
            IMezonkExchange.TakeParams({
                marketId: id,
                outcome: 0,
                side: IMezonkExchange.Side.Buy,
                limitPrice: 60,
                quantity: 100e18,
                minFill: 0,
                deadline: uint64(block.timestamp + 60)
            }),
            src
        );
        assertEq(got, 60e18, "only the 60 funded shares exist");
        assertEq(musd.balanceOf(carol), c0 - 33e18 - 0.33e18, "60 x 0.55 + 1% fee");
        assertEq(ex.getMarket(id).collateral, 60e18);

        vm.warp(p.closeTime);
        vm.prank(resolver);
        res.proposeOutcome(id, IMezonkExchange.Outcome.Yes, keccak256("evidence"), "ipfs://e");
        vm.warp(block.timestamp + 1 days);
        res.finalize(id);
        vm.prank(carol);
        assertEq(ex.redeem(id), 60e18);
        assertEq(
            musd.balanceOf(address(ex)), ex.totalCollateral() + ex.escrowedCollateral() + ex.protocolFees()
        );
    }
}
