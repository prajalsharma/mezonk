// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Stand-in for Mezo's BTC price oracle (0x7b7c…0015) on local forks, which can't run the real one.
/// Always fresh, fixed at $82,000. Used by apps/web/tests/e2e/borrow.spec.ts via anvil_setCode; never deployed.
contract MockMezoOracle {
    function decimals() external pure returns (uint8) {
        return 18;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, 82_000e18, block.timestamp, block.timestamp, 1);
    }
}
