// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title FPMMMath
/// @notice Pure math for a binary fixed-product market maker over complete sets.
/// @dev Pool holds `y` YES and `n` NO shares; the invariant is y * n = k.
///      One complete set (1 YES + 1 NO) is always backed by exactly one unit of collateral.
///      Every rounding decision below favours the pool, so k never decreases.
library FPMMMath {
    error ZeroAmount();
    error InsufficientPool();

    /// @notice Shares of the chosen outcome received for `netIn` collateral (after fees).
    /// @dev The net collateral mints `netIn` complete sets into the pool. The pool keeps all
    ///      opposite-side shares and releases enough chosen-side shares to restore k.
    /// @param poolOut Pool balance of the side being bought.
    /// @param poolOther Pool balance of the opposite side.
    /// @return sharesOut Shares transferred to the buyer.
    /// @return newPoolOut New pool balance of the bought side.
    /// @return newPoolOther New pool balance of the opposite side.
    function buy(uint256 poolOut, uint256 poolOther, uint256 netIn)
        internal
        pure
        returns (uint256 sharesOut, uint256 newPoolOut, uint256 newPoolOther)
    {
        if (netIn == 0) revert ZeroAmount();
        if (poolOut == 0 || poolOther == 0) revert InsufficientPool();
        newPoolOther = poolOther + netIn;
        // Ceil so the pool keeps at least k; the buyer absorbs the rounding.
        newPoolOut = Math.mulDiv(poolOut, poolOther, newPoolOther, Math.Rounding.Ceil);
        sharesOut = poolOut + netIn - newPoolOut;
    }

    /// @notice Gross collateral released when selling `sharesIn` of one side back to the pool.
    /// @dev Seller adds `sharesIn` to the pool, then the pool burns `c` complete sets so that
    ///      (poolIn + sharesIn - c) * (poolOther - c) >= poolIn * poolOther.
    ///      c is the smaller root of c^2 - c(poolIn + sharesIn + poolOther) + sharesIn * poolOther = 0.
    /// @param poolIn Pool balance of the side being sold.
    /// @param poolOther Pool balance of the opposite side.
    /// @return grossOut Complete sets burned, i.e. collateral released before fees.
    /// @return newPoolIn New pool balance of the sold side.
    /// @return newPoolOther New pool balance of the opposite side.
    function sell(uint256 poolIn, uint256 poolOther, uint256 sharesIn)
        internal
        pure
        returns (uint256 grossOut, uint256 newPoolIn, uint256 newPoolOther)
    {
        if (sharesIn == 0) revert ZeroAmount();
        if (poolIn == 0 || poolOther == 0) revert InsufficientPool();
        uint256 b = poolIn + sharesIn + poolOther;
        uint256 disc = b * b - 4 * sharesIn * poolOther;
        // Ceil the root so the smaller root (and the payout) rounds down.
        grossOut = (b - Math.sqrt(disc, Math.Rounding.Ceil)) / 2;
        uint256 k = poolIn * poolOther;
        // Defensive: step down until the invariant holds. Converges in at most a couple of steps.
        while (grossOut > 0 && (poolIn + sharesIn - grossOut) * (poolOther - grossOut) < k) {
            unchecked {
                --grossOut;
            }
        }
        if (grossOut == 0 || grossOut >= poolOther) revert InsufficientPool();
        newPoolIn = poolIn + sharesIn - grossOut;
        newPoolOther = poolOther - grossOut;
    }

    /// @notice Initial pool balances for `liquidity` complete sets at a target YES probability.
    /// @dev Price of YES = poolNo / (poolYes + poolNo). The side that is not fully pooled is
    ///      returned to the liquidity provider as an outright position.
    /// @param liquidity Collateral deposited (= complete sets minted).
    /// @param yesProbBps Target YES probability in basis points.
    function initialPool(uint256 liquidity, uint256 yesProbBps)
        internal
        pure
        returns (uint256 poolYes, uint256 poolNo, uint256 lpYes, uint256 lpNo)
    {
        if (yesProbBps >= 5000) {
            poolNo = liquidity;
            poolYes = Math.mulDiv(liquidity, 10_000 - yesProbBps, yesProbBps);
            lpYes = liquidity - poolYes;
        } else {
            poolYes = liquidity;
            poolNo = Math.mulDiv(liquidity, yesProbBps, 10_000 - yesProbBps);
            lpNo = liquidity - poolNo;
        }
    }
}
