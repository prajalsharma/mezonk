// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {MezonkExchange} from "../src/MezonkExchange.sol";
import {MezonkMarketFactory} from "../src/MezonkMarketFactory.sol";
import {IMezonkExchange} from "../src/interfaces/IMezonkExchange.sol";
import {MezoAddresses} from "../src/MezoAddresses.sol";

/// @notice Deploys the order-book exchange (and, from its constructor, the factory, resolution and incentives
///         contracts), grants roles, adds the first graduation/fee policy and starts ownership transfer.
/// Env (required): OWNER, ARBITRATOR, RESOLVER, CURATOR. Optional: CREATOR and the POLICY_* / config overrides.
/// Mainnet requires ALLOW_MAINNET=true. Local forks may pass COLLATERAL to skip the Mezo address book.
/// Usage: forge script script/DeployExchange.s.sol --rpc-url mezo_testnet --broadcast --gas-estimate-multiplier 105 --account <keystore>
/// Gas: the exchange deployment uses ~9.05M gas against a 10M Mezo block gas limit (measured on a testnet fork);
/// the default 130% estimate exceeds the block limit, hence the 105 multiplier.
contract DeployExchange is Script {
    function run() external returns (MezonkExchange ex) {
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
        address curator = vm.envAddress("CURATOR");
        address creator = vm.envOr("CREATOR", address(0));
        require(arbitrator != resolver, "arbitrator must differ from resolver");
        require(
            curator != resolver && curator != arbitrator, "curator must be independent of resolution roles"
        );
        require(creator != curator, "creator must differ from curator");

        IMezonkExchange.Config memory c = IMezonkExchange.Config({
            minLiveDuration: uint32(vm.envOr("MIN_LIVE_DURATION", uint256(1 days))),
            maxDuration: uint32(vm.envOr("MAX_DURATION", uint256(365 days))),
            proposalWindow: uint32(vm.envOr("PROPOSAL_WINDOW", uint256(3 days))),
            challengeWindow: uint32(vm.envOr("CHALLENGE_WINDOW", uint256(1 days))),
            arbitrationWindow: uint32(vm.envOr("ARBITRATION_WINDOW", uint256(7 days))),
            proposerBond: uint128(vm.envOr("PROPOSER_BOND", uint256(25e18))),
            disputeBond: uint128(vm.envOr("DISPUTE_BOND", uint256(25e18))),
            arbitrator: arbitrator
        });

        vm.startBroadcast();
        ex = new MezonkExchange(IERC20(musd), msg.sender, c);
        MezonkMarketFactory fac = ex.factory();
        fac.setResolver(resolver, true);
        fac.setCurator(curator, true);
        if (creator != address(0)) fac.setCreator(creator, true);
        uint32 policyId = ex.addPolicy(_policy());
        if (owner != msg.sender) {
            ex.transferOwnership(owner); // owner must call acceptOwnership() on both
            fac.transferOwnership(owner);
        }
        vm.stopBroadcast();

        console2.log("MezonkExchange", address(ex));
        console2.log("MezonkMarketFactory", address(fac));
        console2.log("MezonkResolution", address(ex.resolution()));
        console2.log("MezonkIncentives", address(ex.incentives()));
        console2.log("policyId", policyId);
        console2.log("chainId", block.chainid);
        console2.log("deployBlock", block.number);
    }

    /// @dev Testnet defaults; every value can be overridden. Graduation depth is in shares, notional in MUSD.
    function _policy() internal view returns (IMezonkExchange.Policy memory) {
        return IMezonkExchange.Policy({
            minBidDepth: uint128(vm.envOr("POLICY_MIN_BID_DEPTH", uint256(100e18))),
            minAskDepth: uint128(vm.envOr("POLICY_MIN_ASK_DEPTH", uint256(100e18))),
            minSeederNotional: uint128(vm.envOr("POLICY_MIN_SEEDER_NOTIONAL", uint256(10e18))),
            minSeeders: uint16(vm.envOr("POLICY_MIN_SEEDERS", uint256(2))),
            maxSpread: uint8(vm.envOr("POLICY_MAX_SPREAD", uint256(10))),
            band: uint8(vm.envOr("POLICY_BAND", uint256(5))),
            seedingPeriod: uint32(vm.envOr("POLICY_SEEDING_PERIOD", uint256(7 days))),
            minRest: uint32(vm.envOr("POLICY_MIN_REST", uint256(1 hours))),
            takerFeeBps: uint16(vm.envOr("POLICY_TAKER_FEE_BPS", uint256(100))),
            rebateShareBps: uint16(vm.envOr("POLICY_REBATE_SHARE_BPS", uint256(2000))),
            referralShareBps: uint16(vm.envOr("POLICY_REFERRAL_SHARE_BPS", uint256(1000))),
            rebatePeriod: uint32(vm.envOr("POLICY_REBATE_PERIOD", uint256(30 days))),
            claimWindow: uint32(vm.envOr("POLICY_CLAIM_WINDOW", uint256(90 days))),
            rebateCapPerMarket: uint128(vm.envOr("POLICY_REBATE_CAP_MARKET", uint256(5_000e18))),
            rebateCapPerWallet: uint128(vm.envOr("POLICY_REBATE_CAP_WALLET", uint256(1_000e18))),
            rebateBudget: uint128(vm.envOr("POLICY_REBATE_BUDGET", uint256(50_000e18))),
            referralCapPerMarket: uint128(vm.envOr("POLICY_REFERRAL_CAP_MARKET", uint256(500e18)))
        });
    }
}
