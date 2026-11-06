// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Like MockMezoOracle (always fresh), but the price can be changed with `set`, so a local fork can play
///         out BTC up/down rounds that aren't all ties. Installed with anvil_setCode; never deployed.
contract MockMezoOracleSettable {
    uint256 public price = 82_000e18;

    function set(uint256 p) external {
        price = p;
    }

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, int256(price), block.timestamp, block.timestamp, 1);
    }
}
