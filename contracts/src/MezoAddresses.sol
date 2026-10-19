// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Verified Mezo addresses (sources: mezo.org/docs/users/resources/contracts-reference,
///         mezo-org/musd deployments; checked on-chain 2026-10-19: decimals 18, symbol "MUSD").
library MezoAddresses {
    uint256 internal constant TESTNET_CHAIN_ID = 31611;
    uint256 internal constant MAINNET_CHAIN_ID = 31612;

    address internal constant MUSD_TESTNET = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;
    address internal constant MUSD_MAINNET = 0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186;

    function musd(uint256 chainId) internal pure returns (address) {
        if (chainId == TESTNET_CHAIN_ID) return MUSD_TESTNET;
        if (chainId == MAINNET_CHAIN_ID) return MUSD_MAINNET;
        return address(0);
    }
}
