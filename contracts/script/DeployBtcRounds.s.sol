// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MezonkBtcRounds} from "../src/MezonkBtcRounds.sol";
import {IMezoPriceFeed} from "../src/MezonkPriceResolver.sol";
import {MezoAddresses} from "../src/MezoAddresses.sol";

/// @notice Deploys MezonkBtcRounds (bet on BTC up or down, with BTC) against Mezo's PriceFeed. Standalone: it needs
///         nothing from the exchange.
/// Env: PRICE_FEED (default: Mezo's MUSD PriceFeed for the chain), INTERVAL seconds (default 3600), CAPTURE_WINDOW
///      seconds (default 600), MIN_STAKE_USD / MAX_STAKE_USD whole dollars (default 8 / 125, so the $10–$100 chips fit
///      with room for the price moving between quote and confirmation), FEE_BPS (default 100 = 1%), GENESIS unix time
///      (default: the next whole hour after now), ROUNDS_OWNER (default: the broadcaster).
/// Then: set NEXT_PUBLIC_BTC_ROUNDS in the web app and MM_BTC_ROUNDS in the bot, which rolls each round on time.
/// Usage: forge script script/DeployBtcRounds.s.sol --rpc-url mezo_testnet --broadcast --account deployer
contract DeployBtcRounds is Script {
    address constant TESTNET_PRICE_FEED = 0x86bCF0841622a5dAC14A313a15f96A95421b9366;
    address constant MAINNET_PRICE_FEED = 0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88;

    function run() external returns (MezonkBtcRounds r) {
        if (block.chainid == MezoAddresses.MAINNET_CHAIN_ID) {
            require(vm.envOr("ALLOW_MAINNET", false), "mainnet deploy needs ALLOW_MAINNET=true");
        }
        address feed = vm.envOr(
            "PRICE_FEED", block.chainid == MezoAddresses.MAINNET_CHAIN_ID ? MAINNET_PRICE_FEED : TESTNET_PRICE_FEED
        );
        uint32 interval = uint32(vm.envOr("INTERVAL", uint256(1 hours)));
        uint32 window = uint32(vm.envOr("CAPTURE_WINDOW", uint256(10 minutes)));
        uint128 minUsd = uint128(vm.envOr("MIN_STAKE_USD", uint256(8)) * 1e18);
        uint128 maxUsd = uint128(vm.envOr("MAX_STAKE_USD", uint256(125)) * 1e18);
        uint16 feeBps = uint16(vm.envOr("FEE_BPS", uint256(100)));
        uint64 genesis = uint64(vm.envOr("GENESIS", ((block.timestamp / 1 hours) + 1) * 1 hours));
        require(feed.code.length > 0, "price feed has no code");
        // No fetchPrice() check here: Mezo's oracle is a chain precompile that Foundry's simulation can't run.

        vm.startBroadcast();
        address owner = vm.envOr("ROUNDS_OWNER", msg.sender);
        r = new MezonkBtcRounds(IMezoPriceFeed(feed), genesis, interval, window, minUsd, maxUsd, feeBps, owner);
        vm.stopBroadcast();

        console2.log("MezonkBtcRounds", address(r));
        console2.log("  price feed", feed);
        console2.log("  genesis", genesis);
        console2.log("  interval (s)", interval);
        console2.log("  capture window (s)", window);
        console2.log("  stake USD", minUsd / 1e18, maxUsd / 1e18);
        console2.log("  fee bps", feeBps);
        console2.log("  owner", owner);
    }
}
