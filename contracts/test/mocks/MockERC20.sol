// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Burns 1% on every transfer. Must be rejected as collateral.
contract FeeOnTransferToken is ERC20 {
    constructor() ERC20("Fee Token", "MUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 burnt = value / 100;
            super._update(from, address(0), burnt);
            super._update(from, to, value - burnt);
        } else {
            super._update(from, to, value);
        }
    }
}

interface IReenterTarget {
    function redeem(uint256 marketId) external returns (uint256);
}

/// @dev Calls back into the manager on outgoing transfers to test reentrancy guards.
contract ReentrantToken is ERC20 {
    address public target;
    uint256 public marketId;
    bool public armed;
    bool public reentered;
    bytes public lastRevert;

    constructor() ERC20("Reentrant", "MUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_, uint256 marketId_) external {
        target = target_;
        marketId = marketId_;
        armed = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed && from == target) {
            armed = false;
            reentered = true;
            try IReenterTarget(target).redeem(marketId) {}
            catch (bytes memory reason) {
                lastRevert = reason;
            }
        }
    }
}
