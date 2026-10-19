// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {FPMMMath} from "../src/libraries/FPMMMath.sol";

contract FPMMMathHarness {
    function buy(uint256 a, uint256 b, uint256 x) external pure returns (uint256, uint256, uint256) {
        return FPMMMath.buy(a, b, x);
    }

    function sell(uint256 a, uint256 b, uint256 x) external pure returns (uint256, uint256, uint256) {
        return FPMMMath.sell(a, b, x);
    }
}

contract FPMMMathTest is Test {
    FPMMMathHarness h = new FPMMMathHarness();

    uint256 constant MIN = 1e15;
    uint256 constant MAX = 1e30; // 1 trillion MUSD

    function testFuzz_buy_neverDecreasesK(uint256 y, uint256 n, uint256 x) public view {
        y = bound(y, MIN, MAX);
        n = bound(n, MIN, MAX);
        x = bound(x, 1, MAX);
        (uint256 out, uint256 y2, uint256 n2) = h.buy(y, n, x);
        assertGe(y2 * n2, y * n);
        assertGe(y2, 1);
        // Conservation: shares out + pool delta = sets minted on the bought side.
        assertEq(out + y2, y + x);
        assertEq(n2, n + x);
    }

    function testFuzz_sell_neverDecreasesK(uint256 y, uint256 n, uint256 s) public view {
        y = bound(y, MIN, MAX);
        n = bound(n, MIN, MAX);
        s = bound(s, 1e6, MAX);
        try h.sell(y, n, s) returns (uint256 c, uint256 y2, uint256 n2) {
            assertGe(y2 * n2, y * n);
            assertLt(c, n);
            assertEq(y2, y + s - c);
            assertEq(n2, n - c);
        } catch {}
    }

    /// Buying then immediately selling everything never returns more collateral than paid.
    function testFuzz_roundTrip_noProfit(uint256 y, uint256 n, uint256 x) public view {
        y = bound(y, 1e18, MAX);
        n = bound(n, 1e18, MAX);
        x = bound(x, 1e12, MAX);
        (uint256 out, uint256 y2, uint256 n2) = h.buy(y, n, x);
        try h.sell(y2, n2, out) returns (uint256 c, uint256, uint256) {
            assertLe(c, x);
        } catch {}
    }

    function test_initialPool_priceMatchesTarget() public pure {
        for (uint256 p = 500; p <= 9500; p += 500) {
            (uint256 y, uint256 n, uint256 lpY, uint256 lpN) = FPMMMath.initialPool(1000e18, p);
            uint256 price = (n * 1e18) / (y + n);
            assertApproxEqAbs(price, p * 1e14, 1e6);
            assertEq(y + lpY, 1000e18);
            assertEq(n + lpN, 1000e18);
        }
    }
}
