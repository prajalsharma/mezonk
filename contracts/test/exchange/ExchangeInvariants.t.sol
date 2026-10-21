// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MezonkExchange} from "../../src/MezonkExchange.sol";
import {MezonkMarketFactory} from "../../src/MezonkMarketFactory.sol";
import {MezonkResolution} from "../../src/MezonkResolution.sol";
import {MezonkIncentives} from "../../src/MezonkIncentives.sol";
import {IMezonkExchange} from "../../src/interfaces/IMezonkExchange.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @dev Random sequences of seeding, graduation, splits, merges, resting and signed fills, cancels,
///      resolution, redemption and incentive claims across two markets.
contract ExchangeHandler is Test {
    uint256 internal constant ONE = 1e18;
    uint256 internal constant LOT = 1e16;
    MezonkExchange public ex;
    MezonkMarketFactory public fac;
    MezonkResolution public res;
    MezonkIncentives public inc;
    MockERC20 public musd;
    address public resolver;
    address public arbitrator;

    address[] public actors;
    uint256[] internal pks;
    uint256[] public ids;
    uint256[] public restingIds;
    uint256 internal salt;
    mapping(bytes32 => uint256) public hits;

    constructor(
        MezonkExchange ex_,
        MockERC20 musd_,
        address resolver_,
        address arbitrator_,
        uint256[] memory marketIds
    ) {
        ex = ex_;
        fac = ex_.factory();
        res = ex_.resolution();
        inc = ex_.incentives();
        musd = musd_;
        resolver = resolver_;
        arbitrator = arbitrator_;
        ids = marketIds;
        for (uint256 i; i < 4; i++) {
            (address a, uint256 pk) = makeAddrAndKey(string(abi.encodePacked("actor", i)));
            actors.push(a);
            pks.push(pk);
            musd.mint(a, 1e30);
            vm.startPrank(a);
            musd.approve(address(ex), type(uint256).max);
            musd.approve(address(res), type(uint256).max);
            vm.stopPrank();
        }
    }

    /// @dev Called once from setUp: a funded two-sided book, then graduation.
    function seedAndGraduate(uint256 id) external {
        vm.prank(actors[0]);
        restingIds.push(ex.placeOrder(id, 0, IMezonkExchange.Side.Buy, 40, uint128(100 * ONE)));
        vm.prank(actors[1]);
        restingIds.push(ex.placeOrder(id, 1, IMezonkExchange.Side.Buy, 40, uint128(100 * ONE)));
        ex.graduate(id);
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function restingCount() external view returns (uint256) {
        return restingIds.length;
    }

    function _id(uint256 s) internal view returns (uint256) {
        return ids[s % ids.length];
    }

    function _qty(uint256 s) internal pure returns (uint128) {
        return uint128((bound(s, 1, 50_000)) * LOT); // 0.01 .. 500 shares
    }

    function place(uint256 a, uint256 m, uint256 o, bool buy, uint256 p, uint256 q) external {
        address who = actors[a % actors.length];
        uint256 id = _id(m);
        vm.prank(who);
        try ex.placeOrder(
            id,
            uint8(o % 2),
            buy ? IMezonkExchange.Side.Buy : IMezonkExchange.Side.Sell,
            uint8(bound(p, 1, 99)),
            _qty(q)
        ) returns (
            uint256 oid
        ) {
            restingIds.push(oid);
            hits["place"]++;
        } catch {}
    }

    function graduate(uint256 m) external {
        try ex.graduate(_id(m)) {
            hits["graduate"]++;
        } catch {}
    }

    function split(uint256 a, uint256 m, uint256 q) external {
        vm.prank(actors[a % actors.length]);
        try ex.split(_id(m), _qty(q)) {
            hits["split"]++;
        } catch {}
    }

    function merge(uint256 a, uint256 m, uint256 q) external {
        vm.prank(actors[a % actors.length]);
        try ex.merge(_id(m), _qty(q)) {
            hits["merge"]++;
        } catch {}
    }

    function cancel(uint256 a, uint256 r) external {
        if (restingIds.length == 0) return;
        uint256 oid = restingIds[r % restingIds.length];
        IMezonkExchange.RestingOrder memory o = ex.getResting(oid);
        vm.prank(o.maker);
        try ex.cancelOrder(oid) {
            hits["cancel"]++;
        } catch {}
        a;
    }

    /// @dev Hits one resting order from a compatible direction: direct (opposite side, same outcome) or
    ///      complement (same side, other outcome). Limits are the loosest possible; prices come from the order.
    function takeResting(uint256 a, uint256 r, bool complement, uint256 q) external {
        if (restingIds.length == 0) return;
        address who = actors[a % actors.length];
        uint256 oid = restingIds[r % restingIds.length];
        IMezonkExchange.RestingOrder memory o = ex.getResting(oid);
        if (o.maker == who) who = actors[(a + 1) % actors.length];
        bool makerBuys = o.side == IMezonkExchange.Side.Buy;
        IMezonkExchange.Side tSide =
            complement == makerBuys ? IMezonkExchange.Side.Buy : IMezonkExchange.Side.Sell;
        IMezonkExchange.Source[] memory s = new IMezonkExchange.Source[](1);
        s[0].restingId = oid;
        vm.prank(who);
        try ex.take(
            IMezonkExchange.TakeParams({
                marketId: o.marketId,
                outcome: complement ? 1 - o.outcome : o.outcome,
                side: tSide,
                limitPrice: tSide == IMezonkExchange.Side.Buy ? 99 : 1,
                quantity: _qty(q),
                minFill: 0,
                deadline: uint64(block.timestamp + 1)
            }),
            s
        ) {
            hits["takeResting"]++;
        } catch {}
    }

    /// @dev Like takeResting but always as a buyer (funded with MUSD), so fills are reachable whatever the taker holds.
    function takeRestingBuy(uint256 a, uint256 r, uint256 q) external {
        if (restingIds.length == 0) return;
        uint256 oid = restingIds[r % restingIds.length];
        IMezonkExchange.RestingOrder memory o = ex.getResting(oid);
        this.takeResting(a, r, o.side == IMezonkExchange.Side.Buy, q);
    }

    function takeSigned(
        uint256 mk,
        uint256 tk,
        uint256 m,
        uint256 o,
        bool makerBuys,
        uint256 p,
        uint256 q,
        bool complement
    ) external {
        uint256 mi = mk % actors.length;
        uint256 ti = tk % actors.length;
        if (mi == ti) ti = (ti + 1) % actors.length;
        uint256 id = _id(m);
        uint8 outcome = uint8(o % 2);
        uint8 price = uint8(bound(p, 1, 99));
        IMezonkExchange.Order memory ord = IMezonkExchange.Order({
            maker: actors[mi],
            taker: address(0),
            marketId: id,
            outcome: outcome,
            side: makerBuys ? IMezonkExchange.Side.Buy : IMezonkExchange.Side.Sell,
            price: price,
            quantity: _qty(q),
            expiry: uint64(block.timestamp + 100),
            nonce: 0,
            salt: ++salt
        });
        (uint8 v, bytes32 r, bytes32 s_) = vm.sign(pks[mi], ex.orderHash(ord));
        IMezonkExchange.Source[] memory s = new IMezonkExchange.Source[](1);
        s[0].order = ord;
        s[0].signature = abi.encodePacked(r, s_, v);
        // Taker direction compatible with the maker: direct (same outcome, opposite side) or complement.
        uint8 tOut = complement ? 1 - outcome : outcome;
        IMezonkExchange.Side tSide =
            complement == makerBuys ? IMezonkExchange.Side.Buy : IMezonkExchange.Side.Sell;
        vm.prank(actors[ti]);
        try ex.take(
            IMezonkExchange.TakeParams({
                marketId: id,
                outcome: tOut,
                side: tSide,
                limitPrice: tSide == IMezonkExchange.Side.Buy ? 99 : 1,
                quantity: ord.quantity,
                minFill: 0,
                deadline: uint64(block.timestamp + 1)
            }),
            s
        ) {
            hits["takeSigned"]++;
        } catch {}
    }

    function transfer(uint256 a, uint256 b, uint256 m, uint256 o, uint256 q) external {
        vm.prank(actors[a % actors.length]);
        try ex.transferShares(_id(m), uint8(o % 2), actors[b % actors.length], _qty(q)) {} catch {}
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 hours));
    }

    /// @dev Close, propose and finalize in one step (rare by design: it ends trading on that market).
    function resolve(uint256 m, uint256 o, uint256 gate) external {
        if (gate % 40 != 0) return;
        uint256 id = _id(m);
        IMezonkExchange.Market memory mk = ex.getMarket(id);
        if (block.timestamp < mk.closeTime) vm.warp(mk.closeTime);
        IMezonkExchange.Outcome out = IMezonkExchange.Outcome(bound(o, 1, 3));
        vm.prank(resolver);
        try res.proposeOutcome(id, out, keccak256("e"), "") {} catch {}
        vm.warp(block.timestamp + 1 days);
        try res.finalize(id) {
            hits["finalize"]++;
        } catch {}
    }

    function redeem(uint256 a, uint256 m) external {
        vm.prank(actors[a % actors.length]);
        try ex.redeem(_id(m)) {
            hits["redeem"]++;
        } catch {}
    }

    function claimRebate(uint256 a, uint256 m) external {
        vm.prank(actors[a % actors.length]);
        try inc.claimRebate(_id(m)) {
            hits["rebate"]++;
        } catch {}
    }

    function setReferrer(uint256 a, uint256 b) external {
        vm.prank(actors[a % actors.length]);
        try inc.setReferrer(actors[b % actors.length]) {} catch {}
    }
}

abstract contract ExchangeInvariantSetup is Test {
    uint256 internal constant ONE = 1e18;
    MezonkExchange internal ex;
    MockERC20 internal musd;
    ExchangeHandler internal h;
    uint256[] internal ids;

    function setUp() public {
        address owner = makeAddr("owner");
        address resolver = makeAddr("resolver");
        address arbitrator = makeAddr("arbitrator");
        address creator = makeAddr("creator");
        uint256 curatorPk = 0xC0FFEE;
        address curator = vm.addr(curatorPk);
        musd = new MockERC20("Mezo USD", "MUSD");
        ex = new MezonkExchange(
            IERC20(address(musd)),
            owner,
            IMezonkExchange.Config({
                minLiveDuration: 1 days,
                maxDuration: 365 days,
                proposalWindow: 3 days,
                challengeWindow: 1 days,
                arbitrationWindow: 7 days,
                proposerBond: uint128(1 * ONE),
                disputeBond: uint128(1 * ONE),
                arbitrator: arbitrator
            })
        );
        MezonkMarketFactory fac = ex.factory();
        vm.startPrank(owner);
        fac.setResolver(resolver, true);
        fac.setCreator(creator, true);
        fac.setCurator(curator, true);
        uint32 pid = ex.addPolicy(
            IMezonkExchange.Policy({
                minBidDepth: uint128(1 * ONE),
                minAskDepth: uint128(1 * ONE),
                minSeederNotional: uint128(ONE / 10),
                minSeeders: 1,
                maxSpread: 98,
                band: 98,
                seedingPeriod: 5 days,
                minRest: 1 hours,
                takerFeeBps: 200,
                rebateShareBps: 4000,
                referralShareBps: 2000,
                rebatePeriod: 10 days,
                claimWindow: 7 days,
                rebateCapPerMarket: uint128(1e30),
                rebateCapPerWallet: uint128(1e30),
                rebateBudget: uint128(1e30),
                referralCapPerMarket: uint128(1e30)
            })
        );
        vm.stopPrank();
        musd.mint(resolver, 1e30);
        address resAddr = address(ex.resolution());
        vm.prank(resolver);
        musd.approve(resAddr, type(uint256).max);

        for (uint256 i; i < 2; i++) {
            string memory meta = string(abi.encodePacked('{"q":"market ', vm.toString(i), '"}'));
            IMezonkExchange.CreateParams memory p = IMezonkExchange.CreateParams({
                metadata: meta,
                closeTime: uint64(block.timestamp + 20 days),
                resolver: resolver,
                policyId: pid
            });
            IMezonkExchange.MarketApproval memory a = IMezonkExchange.MarketApproval({
                metadataHash: keccak256(bytes(meta)),
                creator: creator,
                resolver: resolver,
                closeTime: p.closeTime,
                policyId: pid,
                deadline: uint64(block.timestamp + 1 days),
                nonce: bytes32(i + 1)
            });
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(curatorPk, fac.approvalDigest(a));
            vm.prank(creator);
            ids.push(fac.createMarket(p, a, curator, abi.encodePacked(r, s, v)));
        }
        h = new ExchangeHandler(ex, musd, resolver, arbitrator, ids);
        h.seedAndGraduate(ids[0]); // market 0 live, market 1 still seeding
        targetContract(address(h));
        bytes4[] memory sel = new bytes4[](14);
        sel[0] = ExchangeHandler.place.selector;
        sel[1] = ExchangeHandler.graduate.selector;
        sel[2] = ExchangeHandler.split.selector;
        sel[3] = ExchangeHandler.merge.selector;
        sel[4] = ExchangeHandler.cancel.selector;
        sel[5] = ExchangeHandler.takeResting.selector;
        sel[6] = ExchangeHandler.takeSigned.selector;
        sel[7] = ExchangeHandler.transfer.selector;
        sel[8] = ExchangeHandler.warp.selector;
        sel[9] = ExchangeHandler.resolve.selector;
        sel[10] = ExchangeHandler.redeem.selector;
        sel[11] = ExchangeHandler.claimRebate.selector;
        sel[12] = ExchangeHandler.setReferrer.selector;
        sel[13] = ExchangeHandler.takeRestingBuy.selector; // weighted: fills are the core path
        targetSelector(FuzzSelector({addr: address(h), selectors: sel}));
    }

    // 13. Liabilities never exceed assets: balance equals the buckets exactly.
    function check_bucketsEqualBalance() public view {
        assertEq(
            musd.balanceOf(address(ex)), ex.totalCollateral() + ex.escrowedCollateral() + ex.protocolFees()
        );
        MezonkIncentives inc = ex.incentives();
        assertEq(musd.balanceOf(address(inc)), inc.rebateReserve() + inc.referralReserve());
        MezonkResolution res = ex.resolution();
        assertEq(musd.balanceOf(address(res)), res.lockedBonds() + res.bondCreditsTotal());
    }

    // 1, 2, 7, 18. Every share is backed: YES supply == NO supply == collateral before finality, and after it
    //              collateral equals what the remaining shares can still redeem for.
    function check_sharesFullyBacked() public view {
        uint256 total;
        for (uint256 k; k < ids.length; k++) {
            uint256 id = ids[k];
            (uint256 y, uint256 n) = _supply(id);
            IMezonkExchange.Market memory m = ex.getMarket(id);
            if (!m.finalized) {
                assertEq(y, m.collateral, "YES supply == collateral");
                assertEq(n, m.collateral, "NO supply == collateral");
            } else {
                uint256 owed = m.finalOutcome == IMezonkExchange.Outcome.Yes
                    ? y
                    : m.finalOutcome == IMezonkExchange.Outcome.No ? n : (y + n) / 2;
                assertEq(owed, m.collateral, "collateral == outstanding payouts");
            }
            total += m.collateral;
        }
        assertEq(total, ex.totalCollateral());
    }

    // 6, 17. Escrow equals the open resting buy orders, exactly.
    function check_escrowMatchesOpenOrders() public view {
        uint256 esc;
        uint256 n = ex.restingCount();
        for (uint256 i = 1; i <= n; i++) {
            IMezonkExchange.RestingOrder memory o = ex.getResting(i);
            if (o.side == IMezonkExchange.Side.Buy) esc += (uint256(o.remaining) * o.price) / 100;
            assertLe(o.remaining, o.quantity);
        }
        assertEq(esc, ex.escrowedCollateral());
    }

    // 10. Rebates never exceed what fees funded.
    function check_rebatesWithinAccrued() public view {
        MezonkIncentives inc = ex.incentives();
        for (uint256 k; k < ids.length; k++) {
            assertLe(inc.rebateClaimedTotal(ids[k]), inc.rebateAccrued(ids[k]));
            uint256 w;
            for (uint256 a; a < h.actorCount(); a++) {
                w += ex.seedWeight(ids[k], h.actors(a));
            }
            assertEq(w, ex.totalSeedWeight(ids[k]), "seed weights sum");
        }
    }

    function _supply(uint256 id) internal view returns (uint256 y, uint256 n) {
        for (uint256 a; a < h.actorCount(); a++) {
            y += ex.sharesOf(id, 0, h.actors(a));
            n += ex.sharesOf(id, 1, h.actors(a));
        }
        uint256 c = ex.restingCount();
        for (uint256 i = 1; i <= c; i++) {
            IMezonkExchange.RestingOrder memory o = ex.getResting(i);
            if (o.marketId == id && o.side == IMezonkExchange.Side.Sell) {
                if (o.outcome == 0) y += o.remaining;
                else n += o.remaining;
            }
        }
    }
}

/// @dev Stateless fuzz: any single fill conserves collateral exactly and pays makers their signed price.
contract ExchangeFillFuzzTest is Test {
    function testFuzz_fillConservesValue(uint8 p, uint32 lots, bool complement, bool makerBuys, uint8 o)
        public
    {
        p = uint8(bound(p, 1, 99));
        uint256 q = uint256(bound(lots, 1, 1_000_000)) * 1e16;
        uint256 makerCash = (q * p) / 100;
        uint256 otherCash = (q * (100 - p)) / 100;
        assertEq(makerCash * 100, q * p, "no rounding at lot granularity");
        assertEq(makerCash + otherCash, q, "complementary prices fund exactly one set per share");
        uint256 fee = (((complement ? otherCash : makerCash)) * 500) / 10_000;
        assertEq(fee * 10_000, (complement ? otherCash : makerCash) * 500, "fees are exact too");
        makerBuys;
        o;
    }
}

/// @dev Seeded random walks through the handler with the invariants checked as it goes, plus proof that the
///      walk actually reached fills, graduation, resolution and redemption (try/catch can't hide dead paths).
/// forge-config: default.invariant.depth = 200
/// forge-config: default.invariant.runs = 64
contract ExchangeInvariantTest is ExchangeInvariantSetup {
    function invariant_bucketsEqualBalance() public view {
        check_bucketsEqualBalance();
    }

    function invariant_sharesFullyBacked() public view {
        check_sharesFullyBacked();
    }

    function invariant_escrowMatchesOpenOrders() public view {
        check_escrowMatchesOpenOrders();
    }

    function invariant_rebatesWithinAccrued() public view {
        check_rebatesWithinAccrued();
    }
}

contract ExchangeRandomWalkTest is ExchangeInvariantSetup {
    /// forge-config: default.fuzz.runs = 40
    /// forge-config: ci.fuzz.runs = 200
    function testFuzz_randomWalk(uint256 seed) public {
        for (uint256 i; i < 300; i++) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            uint256 a = r >> 8;
            uint256 b = r >> 40;
            uint256 c = r >> 72;
            uint256 d = r >> 104;
            uint256 k = r % 14;
            if (k == 0) {
                h.place(a, b, c, d % 2 == 0, 30 + (c % 40), d);
            } else if (k == 1) {
                h.graduate(b);
            } else if (k == 2) {
                h.split(a, b, c);
            } else if (k == 3) {
                h.merge(a, b, c);
            } else if (k == 4) {
                h.cancel(a, b);
            } else if (k == 5) {
                h.takeResting(a, b, c % 2 == 0, d);
            } else if (k == 6) {
                h.takeRestingBuy(a, b, d);
            } else if (k == 7 || k == 8) {
                h.takeSigned(a, b, c, d, r % 3 == 0, 20 + (c % 60), d >> 3, (d >> 5) % 2 == 0);
            } else if (k == 9) {
                h.transfer(a, b, c, d, r);
            } else if (k == 10) {
                h.warp(a % 2 hours);
            } else if (k == 11) {
                h.resolve(b, c, i > 250 ? 0 : 1);
            } else if (k == 12) {
                h.redeem(a, b);
            } else {
                h.claimRebate(a, b);
            }
            if (i % 25 == 0) _checkAll();
        }
        _checkAll();
        assertGt(h.hits("takeResting"), 0, "resting fills");
        assertGt(h.hits("takeSigned"), 0, "signed fills");
        assertGt(h.hits("place"), 0, "orders placed");
        assertGt(h.hits("split") + h.hits("merge"), 0, "split/merge");
    }

    function _checkAll() internal view {
        check_bucketsEqualBalance();
        check_sharesFullyBacked();
        check_escrowMatchesOpenOrders();
        check_rebatesWithinAccrued();
    }
}

contract HandlerSmokeTest is ExchangeInvariantSetup {
    function test_handlerPathsWork() public {
        h.split(2, 0, 1000);
        h.takeResting(2, 0, true, 500);
        h.takeResting(3, 1, false, 500);
        h.place(2, 0, 0, false, 60, 100);
        h.merge(2, 0, 10);
        h.takeSigned(0, 1, 0, 0, true, 50, 100, true);
        h.resolve(0, 1, 0);
        h.redeem(2, 0);
        emit log_named_uint("split", h.hits("split"));
        emit log_named_uint("takeResting", h.hits("takeResting"));
        emit log_named_uint("place", h.hits("place"));
        emit log_named_uint("merge", h.hits("merge"));
        emit log_named_uint("takeSigned", h.hits("takeSigned"));
        emit log_named_uint("finalize", h.hits("finalize"));
        emit log_named_uint("redeem", h.hits("redeem"));
    }
}
