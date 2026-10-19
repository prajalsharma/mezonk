// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseTest} from "../BaseTest.sol";
import {IMezonkMarkets} from "../../src/interfaces/IMezonkMarkets.sol";
import {Handler} from "./Handler.sol";

contract InvariantsTest is BaseTest {
    Handler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new Handler(mk, musd, resolver, arbitrator, creator);
        targetContract(address(handler));
    }

    /// Solvency: the manager holds exactly the sum of everything it owes.
    function invariant_balanceEqualsLiabilities() public view {
        assertEq(musd.balanceOf(address(mk)), _bucketsTotal(handler.allAccounts()));
    }

    /// Complete-set accounting: before settlement, YES supply == NO supply == collateral, per market.
    /// After settlement, the collateral left covers every remaining claim.
    function invariant_sharesBackedByCollateral() public view {
        address[] memory accts = handler.allAccounts();
        uint256 n = mk.marketCount();
        for (uint256 id = 1; id <= n; id++) {
            IMezonkMarkets.Market memory m = mk.getMarket(id);
            uint256 ySupply = m.poolYes;
            uint256 nSupply = m.poolNo;
            uint256 owed;
            for (uint256 i; i < accts.length; i++) {
                uint256 y = mk.yesBalance(id, accts[i]);
                uint256 no = mk.noBalance(id, accts[i]);
                ySupply += y;
                nSupply += no;
                if (m.finalized) owed += mk.claimable(id, accts[i]);
            }
            if (!m.finalized) {
                assertEq(ySupply, m.collateral, "YES supply != collateral");
                assertEq(nSupply, m.collateral, "NO supply != collateral");
            } else {
                if (!m.liquidityClaimed) {
                    if (m.finalOutcome == IMezonkMarkets.Outcome.Yes) owed += m.poolYes;
                    else if (m.finalOutcome == IMezonkMarkets.Outcome.No) owed += m.poolNo;
                    else owed += (m.poolYes + m.poolNo) / 2;
                }
                assertGe(m.collateral, owed, "insolvent market");
            }
        }
    }

    /// A finalized market never un-finalizes or changes outcome.
    function invariant_finalityIsSticky() public view {
        uint256 n = handler.idCount();
        for (uint256 i; i < n; i++) {
            uint256 id = handler.ids(i);
            if (handler.everFinalized(id)) assertTrue(mk.getMarket(id).finalized);
        }
    }
}
