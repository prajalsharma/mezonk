// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MezonkMarkets} from "../src/MezonkMarkets.sol";
import {IMezonkMarkets} from "../src/interfaces/IMezonkMarkets.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

abstract contract BaseTest is Test {
    MezonkMarkets internal mk;
    MockERC20 internal musd;

    address internal owner = makeAddr("owner");
    address internal resolver = makeAddr("resolver");
    address internal arbitrator = makeAddr("arbitrator");
    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    uint256 internal constant ONE = 1e18;
    uint64 internal closeTime;

    function _config() internal view returns (IMezonkMarkets.Config memory) {
        return IMezonkMarkets.Config({
            feeBps: 100,
            protocolFeeShareBps: 5000,
            minDuration: 1 hours,
            maxDuration: 365 days,
            proposalWindow: 3 days,
            challengeWindow: 1 days,
            arbitrationWindow: 7 days,
            minLiquidity: uint128(10 * ONE),
            proposerBond: uint128(50 * ONE),
            disputeBond: uint128(50 * ONE),
            arbitrator: arbitrator
        });
    }

    function setUp() public virtual {
        musd = new MockERC20("Mezo USD", "MUSD");
        mk = new MezonkMarkets(IERC20(address(musd)), owner, _config());
        vm.prank(owner);
        mk.setResolver(resolver, true);

        address[5] memory users = [resolver, creator, alice, bob, carol];
        for (uint256 i; i < users.length; i++) {
            musd.mint(users[i], 1_000_000 * ONE);
            vm.prank(users[i]);
            musd.approve(address(mk), type(uint256).max);
        }
        closeTime = uint64(block.timestamp + 7 days);
    }

    function _metadata() internal pure returns (string memory) {
        return '{"v":1,"question":"Will BTC close above $150,000 on Coinbase on 31 Dec 2026 UTC?","category":"crypto"}';
    }

    function _create(uint256 liquidity, uint16 yesProbBps) internal returns (uint256 id) {
        vm.prank(creator);
        id = mk.createMarket(
            IMezonkMarkets.CreateParams({
                metadata: _metadata(),
                closeTime: closeTime,
                resolver: resolver,
                initialLiquidity: liquidity,
                initialYesProbBps: yesProbBps
            })
        );
    }

    function _buy(address who, uint256 id, bool yes, uint256 amount) internal returns (uint256 shares) {
        vm.prank(who);
        shares = mk.buy(id, yes, amount, 0, block.timestamp);
    }

    function _propose(uint256 id, IMezonkMarkets.Outcome o) internal {
        vm.prank(resolver);
        mk.proposeOutcome(id, o, keccak256("evidence"), "ipfs://evidence");
    }

    /// @dev Every token the manager holds is accounted to exactly one bucket.
    function _bucketsTotal(address[] memory accounts) internal view returns (uint256 total) {
        uint256 n = mk.marketCount();
        for (uint256 i = 1; i <= n; i++) {
            IMezonkMarkets.Market memory m = mk.getMarket(i);
            total += m.collateral + m.creatorFees;
            if (m.proposedAt != 0 && !m.finalized) total += m.proposerBond;
            if (m.disputedAt != 0 && !m.finalized) total += m.disputeBond;
        }
        total += mk.protocolFees();
        for (uint256 i; i < accounts.length; i++) {
            total += mk.bondCredits(accounts[i]);
        }
    }
}
