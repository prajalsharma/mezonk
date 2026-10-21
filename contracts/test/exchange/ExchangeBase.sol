// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MezonkExchange} from "../../src/MezonkExchange.sol";
import {MezonkMarketFactory} from "../../src/MezonkMarketFactory.sol";
import {MezonkResolution} from "../../src/MezonkResolution.sol";
import {MezonkIncentives} from "../../src/MezonkIncentives.sol";
import {IMezonkExchange} from "../../src/interfaces/IMezonkExchange.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

abstract contract ExchangeBase is Test {
    MezonkExchange internal ex;
    MezonkMarketFactory internal fac;
    MezonkResolution internal res;
    MezonkIncentives internal inc;
    MockERC20 internal musd;

    uint256 internal constant ONE = 1e18;
    uint256 internal constant LOT = 1e16;
    uint8 internal constant YES = 0;
    uint8 internal constant NO = 1;
    IMezonkExchange.Side internal constant BUY = IMezonkExchange.Side.Buy;
    IMezonkExchange.Side internal constant SELL = IMezonkExchange.Side.Sell;

    uint256 internal constant CURATOR_PK = 0xC0FFEE;
    address internal owner = makeAddr("owner");
    address internal resolver = makeAddr("resolver");
    address internal arbitrator = makeAddr("arbitrator");
    address internal creator = makeAddr("creator");
    address internal curator;

    address internal alice;
    uint256 internal alicePk;
    address internal bob;
    uint256 internal bobPk;
    address internal carol;
    uint256 internal carolPk;
    address internal dave;
    uint256 internal davePk;

    uint32 internal policyId;
    uint64 internal closeTime;
    uint256 private _nonce;
    uint256 private _salt;

    function _config() internal view returns (IMezonkExchange.Config memory) {
        return IMezonkExchange.Config({
            minLiveDuration: 1 days,
            maxDuration: 365 days,
            proposalWindow: 3 days,
            challengeWindow: 1 days,
            arbitrationWindow: 7 days,
            proposerBond: uint128(50 * ONE),
            disputeBond: uint128(50 * ONE),
            arbitrator: arbitrator
        });
    }

    function _policy() internal pure returns (IMezonkExchange.Policy memory) {
        return IMezonkExchange.Policy({
            minBidDepth: uint128(100 * ONE),
            minAskDepth: uint128(100 * ONE),
            minSeederNotional: uint128(10 * ONE),
            minSeeders: 2,
            maxSpread: 10,
            band: 5,
            seedingPeriod: 3 days,
            minRest: 1 hours,
            takerFeeBps: 100,
            rebateShareBps: 3000,
            referralShareBps: 1000,
            rebatePeriod: 30 days,
            claimWindow: 30 days,
            rebateCapPerMarket: uint128(1000 * ONE),
            rebateCapPerWallet: uint128(200 * ONE),
            rebateBudget: uint128(10_000 * ONE),
            referralCapPerMarket: uint128(50 * ONE)
        });
    }

    function setUp() public virtual {
        musd = new MockERC20("Mezo USD", "MUSD");
        ex = new MezonkExchange(IERC20(address(musd)), owner, _config());
        fac = ex.factory();
        res = ex.resolution();
        inc = ex.incentives();
        curator = vm.addr(CURATOR_PK);
        (alice, alicePk) = makeAddrAndKey("alice");
        (bob, bobPk) = makeAddrAndKey("bob");
        (carol, carolPk) = makeAddrAndKey("carol");
        (dave, davePk) = makeAddrAndKey("dave");
        _boot();
    }

    function _boot() internal {
        vm.startPrank(owner);
        fac.setResolver(resolver, true);
        fac.setCreator(creator, true);
        fac.setCurator(curator, true);
        policyId = ex.addPolicy(_policy());
        vm.stopPrank();

        address[7] memory users = [resolver, creator, alice, bob, carol, dave, arbitrator];
        for (uint256 i; i < users.length; i++) {
            musd.mint(users[i], 1_000_000 * ONE);
            vm.startPrank(users[i]);
            musd.approve(address(ex), type(uint256).max);
            musd.approve(address(res), type(uint256).max);
            vm.stopPrank();
        }
        closeTime = uint64(block.timestamp + 30 days);
    }

    function _metadata() internal pure returns (string memory) {
        return '{"v":1,"question":"Will BTC close above $150,000 on Coinbase on 31 Dec 2026 UTC?","category":"crypto"}';
    }

    function _params() internal view returns (IMezonkExchange.CreateParams memory) {
        return IMezonkExchange.CreateParams({
            metadata: _metadata(), closeTime: closeTime, resolver: resolver, policyId: policyId
        });
    }

    function _approval(IMezonkExchange.CreateParams memory p)
        internal
        returns (IMezonkExchange.MarketApproval memory a, bytes memory sig)
    {
        a = IMezonkExchange.MarketApproval({
            metadataHash: keccak256(bytes(p.metadata)),
            creator: creator,
            resolver: p.resolver,
            closeTime: p.closeTime,
            policyId: p.policyId,
            deadline: uint64(block.timestamp + 1 days),
            nonce: keccak256(abi.encode("approval", ++_nonce))
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CURATOR_PK, fac.approvalDigest(a));
        sig = abi.encodePacked(r, s, v);
    }

    function _publish() internal returns (uint256 id) {
        IMezonkExchange.CreateParams memory p = _params();
        (IMezonkExchange.MarketApproval memory a, bytes memory sig) = _approval(p);
        vm.prank(creator);
        id = fac.createMarket(p, a, curator, sig);
    }

    function _place(
        address who,
        uint256 id,
        uint8 outcome,
        IMezonkExchange.Side side,
        uint8 price,
        uint256 shares
    ) internal returns (uint256 orderId) {
        vm.prank(who);
        orderId = ex.placeOrder(id, outcome, side, price, uint128(shares));
    }

    /// @dev Two seeders, each bidding 100 YES @45 and 100 NO @45 (= YES ask @55): spread 10, depth 200 each side.
    function _seedBook(uint256 id) internal {
        _place(alice, id, YES, BUY, 45, 100 * ONE);
        _place(alice, id, NO, BUY, 45, 100 * ONE);
        _place(bob, id, YES, BUY, 45, 100 * ONE);
        _place(bob, id, NO, BUY, 45, 100 * ONE);
    }

    function _liveMarket() internal returns (uint256 id) {
        id = _publish();
        _seedBook(id);
        ex.graduate(id);
    }

    function _order(
        address maker,
        uint256 id,
        uint8 outcome,
        IMezonkExchange.Side side,
        uint8 price,
        uint256 qty
    ) internal returns (IMezonkExchange.Order memory o) {
        o = IMezonkExchange.Order({
            maker: maker,
            taker: address(0),
            marketId: id,
            outcome: outcome,
            side: side,
            price: price,
            quantity: uint128(qty),
            expiry: uint64(block.timestamp + 1 days),
            nonce: 0,
            salt: ++_salt
        });
    }

    function _sign(uint256 pk, IMezonkExchange.Order memory o) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, ex.orderHash(o));
        return abi.encodePacked(r, s, v);
    }

    function _src(IMezonkExchange.Order memory o, bytes memory sig)
        internal
        pure
        returns (IMezonkExchange.Source memory)
    {
        return IMezonkExchange.Source({restingId: 0, order: o, signature: sig});
    }

    function _rest(uint256 restingId) internal pure returns (IMezonkExchange.Source memory s) {
        s.restingId = restingId;
    }

    function _take(
        address taker,
        uint256 id,
        uint8 outcome,
        IMezonkExchange.Side side,
        uint8 limit,
        uint256 qty,
        uint256 minFill,
        IMezonkExchange.Source[] memory sources
    ) internal returns (uint128) {
        vm.prank(taker);
        return ex.take(
            IMezonkExchange.TakeParams({
                marketId: id,
                outcome: outcome,
                side: side,
                limitPrice: limit,
                quantity: uint128(qty),
                minFill: uint128(minFill),
                deadline: uint64(block.timestamp + 60)
            }),
            sources
        );
    }

    function _one(IMezonkExchange.Source memory s) internal pure returns (IMezonkExchange.Source[] memory a) {
        a = new IMezonkExchange.Source[](1);
        a[0] = s;
    }

    function _two(IMezonkExchange.Source memory s1, IMezonkExchange.Source memory s2)
        internal
        pure
        returns (IMezonkExchange.Source[] memory a)
    {
        a = new IMezonkExchange.Source[](2);
        a[0] = s1;
        a[1] = s2;
    }

    /// @dev The exchange's token balance equals the sum of its buckets (no donations in tests).
    function _assertBuckets() internal view {
        assertEq(
            musd.balanceOf(address(ex)),
            ex.totalCollateral() + ex.escrowedCollateral() + ex.protocolFees(),
            "exchange buckets"
        );
        assertEq(
            musd.balanceOf(address(inc)), inc.rebateReserve() + inc.referralReserve(), "incentive buckets"
        );
        assertEq(musd.balanceOf(address(res)), res.lockedBonds() + res.bondCreditsTotal(), "bond buckets");
    }

    function _close(uint256 id) internal {
        vm.warp(ex.getMarket(id).closeTime);
    }

    function _resolve(uint256 id, IMezonkExchange.Outcome o) internal {
        _close(id);
        vm.prank(resolver);
        res.proposeOutcome(id, o, keccak256("evidence"), "ipfs://evidence");
        vm.warp(block.timestamp + 1 days);
        res.finalize(id);
    }
}
