// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {MezonkMarkets} from "../src/MezonkMarkets.sol";
import {IMezonkMarkets} from "../src/interfaces/IMezonkMarkets.sol";
import {MezoAddresses} from "../src/MezoAddresses.sol";

/// @notice Deploys MezonkMarkets to Mezo testnet.
/// Env: OWNER, ARBITRATOR, RESOLVER (required). Mainnet requires ALLOW_MAINNET=true.
/// Usage: forge script script/Deploy.s.sol --rpc-url mezo_testnet --broadcast --account <keystore>
contract Deploy is Script {
    function run() external returns (MezonkMarkets mk) {
        address musd = MezoAddresses.musd(block.chainid);
        require(musd != address(0), "unsupported chain");
        if (block.chainid == MezoAddresses.MAINNET_CHAIN_ID) {
            require(vm.envOr("ALLOW_MAINNET", false), "mainnet deploy needs ALLOW_MAINNET=true");
        }
        require(musd.code.length > 0, "MUSD has no code on this chain");
        require(IERC20Metadata(musd).decimals() == 18, "unexpected MUSD decimals");
        require(keccak256(bytes(IERC20Metadata(musd).symbol())) == keccak256("MUSD"), "unexpected symbol");

        address owner = vm.envAddress("OWNER");
        address arbitrator = vm.envAddress("ARBITRATOR");
        address resolver = vm.envAddress("RESOLVER");
        require(arbitrator != resolver, "arbitrator must differ from resolver");

        IMezonkMarkets.Config memory c = IMezonkMarkets.Config({
            feeBps: uint16(vm.envOr("FEE_BPS", uint256(100))),
            protocolFeeShareBps: uint16(vm.envOr("PROTOCOL_FEE_SHARE_BPS", uint256(5000))),
            minDuration: uint32(vm.envOr("MIN_DURATION", uint256(1 hours))),
            maxDuration: uint32(vm.envOr("MAX_DURATION", uint256(365 days))),
            proposalWindow: uint32(vm.envOr("PROPOSAL_WINDOW", uint256(3 days))),
            challengeWindow: uint32(vm.envOr("CHALLENGE_WINDOW", uint256(1 days))),
            arbitrationWindow: uint32(vm.envOr("ARBITRATION_WINDOW", uint256(7 days))),
            minLiquidity: uint128(vm.envOr("MIN_LIQUIDITY", uint256(50e18))),
            proposerBond: uint128(vm.envOr("PROPOSER_BOND", uint256(25e18))),
            disputeBond: uint128(vm.envOr("DISPUTE_BOND", uint256(25e18))),
            arbitrator: arbitrator
        });

        vm.startBroadcast();
        mk = new MezonkMarkets(IERC20(musd), msg.sender, c);
        mk.setResolver(resolver, true);
        if (owner != msg.sender) mk.transferOwnership(owner); // owner must call acceptOwnership()
        vm.stopBroadcast();

        console2.log("MezonkMarkets", address(mk));
        console2.log("chainId", block.chainid);
        console2.log("deployBlock", block.number);
    }
}
