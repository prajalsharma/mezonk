// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MezonkPriceResolver, IExchangeMarkets, IMezoPriceFeed} from "../src/MezonkPriceResolver.sol";
import {MezoAddresses} from "../src/MezoAddresses.sol";

/// @notice Deploys MezonkPriceResolver against an existing exchange. It only needs getMarket, resolution and
///         collateralToken from the exchange, so it works with the exchange already deployed; no redeploy.
/// Env: EXCHANGE (required), PRICE_FEED (default: Mezo's MUSD PriceFeed for the chain), CAPTURE_WINDOW seconds
///      (default 900), RESOLVER_OWNER (default: the broadcaster).
/// Then, from the exchange owner: factory.setResolver(<resolver>, true); fund it with MUSD for proposer bonds;
/// set NEXT_PUBLIC_PRICE_RESOLVER in the web app and MM_PRICE_RESOLVER in the bot.
/// Usage: forge script script/DeployPriceResolver.s.sol --rpc-url mezo_testnet --broadcast --account deployer
contract DeployPriceResolver is Script {
    // Verified with mezo-org/musd solidity/artifacts/deployments/{matsnet,mainnet}/PriceFeed.json and on-chain reads.
    address constant TESTNET_PRICE_FEED = 0x86bCF0841622a5dAC14A313a15f96A95421b9366;
    address constant MAINNET_PRICE_FEED = 0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88;

    function run() external returns (MezonkPriceResolver r) {
        if (block.chainid == MezoAddresses.MAINNET_CHAIN_ID) {
            require(vm.envOr("ALLOW_MAINNET", false), "mainnet deploy needs ALLOW_MAINNET=true");
        }
        address exchange = vm.envAddress("EXCHANGE");
        address feed = vm.envOr(
            "PRICE_FEED", block.chainid == MezoAddresses.MAINNET_CHAIN_ID ? MAINNET_PRICE_FEED : TESTNET_PRICE_FEED
        );
        uint32 window = uint32(vm.envOr("CAPTURE_WINDOW", uint256(15 minutes)));
        require(exchange.code.length > 0 && feed.code.length > 0, "exchange or price feed has no code");
        // No fetchPrice() check here: Mezo's oracle is a chain precompile (0x7b7c…0015) that Foundry's local
        // simulation can't execute. Check it on the real chain instead: cast call <feed> "fetchPrice()(uint256)".

        vm.startBroadcast();
        address owner = vm.envOr("RESOLVER_OWNER", msg.sender);
        r = new MezonkPriceResolver(IExchangeMarkets(exchange), IMezoPriceFeed(feed), window, owner);
        vm.stopBroadcast();

        console2.log("MezonkPriceResolver", address(r));
        console2.log("  exchange", exchange);
        console2.log("  price feed", feed);
        console2.log("  capture window (s)", window);
        console2.log("  owner", owner);
    }
}
