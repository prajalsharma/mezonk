// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MezonkMarkets} from "../../src/MezonkMarkets.sol";
import {IMezonkMarkets} from "../../src/interfaces/IMezonkMarkets.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @dev Drives random sequences of trades, resolution steps and claims across several markets.
contract Handler is Test {
    MezonkMarkets public mk;
    MockERC20 public musd;
    address public resolver;
    address public arbitrator;
    address public creator;
    address[] public actors;
    uint256[] public ids;

    uint256 public totalRedeemed;
    mapping(uint256 => bool) public everFinalized;

    constructor(
        MezonkMarkets mk_,
        MockERC20 musd_,
        address resolver_,
        address arbitrator_,
        address creator_
    ) {
        mk = mk_;
        musd = musd_;
        resolver = resolver_;
        arbitrator = arbitrator_;
        creator = creator_;
        for (uint256 i; i < 4; i++) {
            address a = address(uint160(0xA11CE + i));
            actors.push(a);
            musd.mint(a, 1e30);
            vm.prank(a);
            musd.approve(address(mk), type(uint256).max);
        }
    }

    function allAccounts() external view returns (address[] memory out) {
        out = new address[](actors.length + 3);
        for (uint256 i; i < actors.length; i++) {
            out[i] = actors[i];
        }
        out[actors.length] = resolver;
        out[actors.length + 1] = creator;
        out[actors.length + 2] = arbitrator;
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function idCount() external view returns (uint256) {
        return ids.length;
    }

    function create(uint256 liq, uint256 prob, uint256 dur) external {
        liq = bound(liq, 10e18, 1e24);
        prob = bound(prob, 500, 9500);
        dur = bound(dur, 1 hours, 30 days);
        musd.mint(creator, liq);
        vm.prank(creator);
        uint256 id = mk.createMarket(
            IMezonkMarkets.CreateParams({
                metadata: "{\"v\":1}",
                closeTime: uint64(block.timestamp + dur),
                resolver: resolver,
                initialLiquidity: liq,
                initialYesProbBps: uint16(prob)
            })
        );
        ids.push(id);
    }

    function buy(uint256 actorSeed, uint256 idSeed, bool yes, uint256 amount) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        if (mk.stageOf(id) != IMezonkMarkets.Stage.Open) return;
        amount = bound(amount, 1e12, 1e24);
        vm.prank(actors[actorSeed % actors.length]);
        mk.buy(id, yes, amount, 0, block.timestamp);
    }

    function sell(uint256 actorSeed, uint256 idSeed, bool yes, uint256 frac) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        if (mk.stageOf(id) != IMezonkMarkets.Stage.Open) return;
        address a = actors[actorSeed % actors.length];
        uint256 bal = yes ? mk.yesBalance(id, a) : mk.noBalance(id, a);
        uint256 s = (bal * bound(frac, 1, 100)) / 100;
        if (s < 1e9) return;
        vm.prank(a);
        try mk.sell(id, yes, s, 0, block.timestamp) {} catch {}
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 5 days));
    }

    function propose(uint256 idSeed, uint8 o) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        IMezonkMarkets.Market memory m = mk.getMarket(id);
        if (mk.stageOf(id) != IMezonkMarkets.Stage.Closed) return;
        if (block.timestamp >= m.closeTime + m.proposalWindow) return;
        musd.mint(resolver, m.proposerBond);
        vm.startPrank(resolver);
        musd.approve(address(mk), type(uint256).max);
        mk.proposeOutcome(id, IMezonkMarkets.Outcome(1 + (o % 3)), keccak256("e"), "");
        vm.stopPrank();
    }

    function disputeIt(uint256 actorSeed, uint256 idSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        IMezonkMarkets.Market memory m = mk.getMarket(id);
        if (mk.stageOf(id) != IMezonkMarkets.Stage.Proposed) return;
        if (block.timestamp >= m.proposedAt + m.challengeWindow) return;
        vm.prank(actors[actorSeed % actors.length]);
        mk.dispute(id, keccak256("d"), "");
    }

    function arbitrate(uint256 idSeed, uint8 o) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        IMezonkMarkets.Market memory m = mk.getMarket(id);
        if (mk.stageOf(id) != IMezonkMarkets.Stage.Disputed) return;
        if (block.timestamp >= m.disputedAt + m.arbitrationWindow) return;
        vm.prank(arbitrator);
        mk.arbitrate(id, IMezonkMarkets.Outcome(1 + (o % 3)), keccak256("rationale"), "ipfs://rationale");
        everFinalized[id] = true;
    }

    function finalize(uint256 idSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        try mk.finalize(id) {
            everFinalized[id] = true;
        } catch {}
    }

    function redeem(uint256 actorSeed, uint256 idSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        address a = actors[actorSeed % actors.length];
        if (!mk.getMarket(id).finalized) return;
        if (mk.yesBalance(id, a) + mk.noBalance(id, a) == 0) return;
        uint256 expected = mk.claimable(id, a);
        vm.prank(a);
        uint256 paid = mk.redeem(id);
        assertEq(paid, expected);
        totalRedeemed += paid;
    }

    function claimLiquidity(uint256 idSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        IMezonkMarkets.Market memory m = mk.getMarket(id);
        if (!m.finalized || m.liquidityClaimed) return;
        vm.prank(creator);
        mk.claimLiquidity(id);
    }

    function withdrawBonds(uint256 who) external {
        address[3] memory c = [resolver, actors[who % actors.length], creator];
        address a = c[who % 3];
        if (mk.bondCredits(a) == 0) return;
        vm.prank(a);
        mk.withdrawBond();
    }
}
