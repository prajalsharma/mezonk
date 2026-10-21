// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IMezonkExchange} from "./interfaces/IMezonkExchange.sol";

interface IExchangeIncentiveView {
    function getMarket(uint256 marketId) external view returns (IMezonkExchange.Market memory);
    function getPolicy(uint32 policyId) external view returns (IMezonkExchange.Policy memory);
    function seedWeight(uint256 marketId, address seeder) external view returns (uint256);
    function totalSeedWeight(uint256 marketId) external view returns (uint256);
    function hasTraded(address account) external view returns (bool);
}

/// @title MezonkIncentives
/// @notice Holds the only money incentives can ever pay: the rebate and referral share of taker fees that the
///         exchange actually collected. It never sees collateral, escrow or bonds, so an incentive can't be paid
///         from user funds. No fees, no rewards: there is no budget to overdraw and no unfunded liability.
///
///  - Seeder rebates: a market's rebate pool is split pro rata by seed weight (collateral escrowed in seed
///    orders that were still open at graduation), capped per wallet, claimable until the claim window ends.
///    Then the rest is swept to the protocol's fee balance on the exchange.
///  - Referrals: one referrer per account, set once before its first trade; no self or two-way referral; one
///    level only. Credit comes from taker fees on fills where the referrer is not the maker, capped per market.
/// Deployed by the exchange constructor.
contract MezonkIncentives is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IExchangeIncentiveView public immutable exchange;
    IERC20 public immutable collateralToken;

    uint256 public rebateReserve; // accrued rebates not yet claimed or swept
    uint256 public referralReserve; // referral credits not yet claimed

    mapping(uint32 => uint256) public policyRebateAccrued;
    mapping(uint256 => uint256) public rebateAccrued;
    mapping(uint256 => uint256) public rebateClaimedTotal;
    mapping(uint256 => mapping(address => uint256)) public rebateClaimed;
    mapping(uint256 => bool) public rebatesSwept;

    mapping(address => address) public referrerOf;
    mapping(uint256 => mapping(address => uint256)) public referralEarned;
    mapping(address => uint256) public referralCredits;

    event ReferrerSet(address indexed account, address indexed referrer);
    event RebateAccrued(uint256 indexed marketId, uint256 amount);
    event ReferralAccrued(uint256 indexed marketId, address indexed referrer, uint256 amount);
    event RebateClaimed(uint256 indexed marketId, address indexed seeder, uint256 amount);
    event RebatesSwept(uint256 indexed marketId, uint256 amount);
    event ReferralClaimed(address indexed referrer, uint256 amount);

    error NotExchange();
    error NothingToClaim();
    error WindowOpen();
    error ReferrerLocked();
    error BadReferrer();

    constructor(IERC20 collateral_) {
        exchange = IExchangeIncentiveView(msg.sender);
        collateralToken = collateral_;
    }

    /// @notice Called by the exchange inside `take`, before it transfers the returned total here.
    /// @param fee the taker fee just collected
    /// @param referralFee the part of `fee` from fills where the referrer was not the maker
    function accrue(uint256 marketId, address referrer, uint256 fee, uint256 referralFee)
        external
        returns (uint256 rebatePart, uint256 referralPart)
    {
        if (msg.sender != address(exchange)) revert NotExchange();
        IMezonkExchange.Market memory m = exchange.getMarket(marketId);
        IMezonkExchange.Policy memory p = exchange.getPolicy(m.policyId);
        if (block.timestamp < uint256(m.graduatedAt) + p.rebatePeriod && exchange.totalSeedWeight(marketId) > 0) {
            rebatePart = (fee * p.rebateShareBps) / 10_000;
            rebatePart = _min(rebatePart, p.rebateCapPerMarket - rebateAccrued[marketId]);
            rebatePart = _min(rebatePart, p.rebateBudget - policyRebateAccrued[m.policyId]);
            if (rebatePart > 0) {
                rebateAccrued[marketId] += rebatePart;
                policyRebateAccrued[m.policyId] += rebatePart;
                rebateReserve += rebatePart;
                emit RebateAccrued(marketId, rebatePart);
            }
        }
        if (referrer != address(0) && referralFee > 0) {
            referralPart = (referralFee * p.referralShareBps) / 10_000;
            referralPart = _min(referralPart, p.referralCapPerMarket - referralEarned[marketId][referrer]);
            if (referralPart > 0) {
                referralEarned[marketId][referrer] += referralPart;
                referralCredits[referrer] += referralPart;
                referralReserve += referralPart;
                emit ReferralAccrued(marketId, referrer, referralPart);
            }
        }
    }

    /// @notice Rebate `seeder` can claim from `marketId` now.
    function rebateClaimable(uint256 marketId, address seeder) public view returns (uint256) {
        IMezonkExchange.Market memory m = exchange.getMarket(marketId);
        if (m.graduatedAt == 0 || rebatesSwept[marketId]) return 0;
        IMezonkExchange.Policy memory p = exchange.getPolicy(m.policyId);
        if (block.timestamp >= uint256(m.graduatedAt) + p.rebatePeriod + p.claimWindow) return 0;
        uint256 total = exchange.totalSeedWeight(marketId);
        if (total == 0) return 0;
        uint256 entitled = (rebateAccrued[marketId] * exchange.seedWeight(marketId, seeder)) / total;
        if (entitled > p.rebateCapPerWallet) entitled = p.rebateCapPerWallet;
        uint256 done = rebateClaimed[marketId][seeder];
        return entitled > done ? entitled - done : 0;
    }

    function claimRebate(uint256 marketId) external nonReentrant returns (uint256 amount) {
        amount = rebateClaimable(marketId, msg.sender);
        if (amount == 0) revert NothingToClaim();
        rebateClaimed[marketId][msg.sender] += amount;
        rebateClaimedTotal[marketId] += amount;
        rebateReserve -= amount;
        collateralToken.safeTransfer(msg.sender, amount);
        emit RebateClaimed(marketId, msg.sender, amount);
    }

    /// @notice After the claim window, unclaimed rebates (including amounts above per-wallet caps) go back to the
    ///         exchange as protocol fee revenue. Permissionless.
    function sweepRebates(uint256 marketId) external nonReentrant {
        IMezonkExchange.Market memory m = exchange.getMarket(marketId);
        IMezonkExchange.Policy memory p = exchange.getPolicy(m.policyId);
        if (m.graduatedAt == 0 || rebatesSwept[marketId]) revert NothingToClaim();
        if (block.timestamp < uint256(m.graduatedAt) + p.rebatePeriod + p.claimWindow) revert WindowOpen();
        rebatesSwept[marketId] = true;
        uint256 rest = rebateAccrued[marketId] - rebateClaimedTotal[marketId];
        rebateReserve -= rest;
        if (rest > 0) {
            collateralToken.safeTransfer(address(exchange), rest);
            IExchangeFees(address(exchange)).creditSweptRebates(rest);
        }
        emit RebatesSwept(marketId, rest);
    }

    /// @notice One-time, before your first trade.
    function setReferrer(address referrer) external {
        if (referrerOf[msg.sender] != address(0) || exchange.hasTraded(msg.sender)) revert ReferrerLocked();
        if (referrer == address(0) || referrer == msg.sender || referrerOf[referrer] == msg.sender) {
            revert BadReferrer();
        }
        referrerOf[msg.sender] = referrer;
        emit ReferrerSet(msg.sender, referrer);
    }

    function claimReferral() external nonReentrant returns (uint256 amount) {
        amount = referralCredits[msg.sender];
        if (amount == 0) revert NothingToClaim();
        referralCredits[msg.sender] = 0;
        referralReserve -= amount;
        collateralToken.safeTransfer(msg.sender, amount);
        emit ReferralClaimed(msg.sender, amount);
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}

interface IExchangeFees {
    function creditSweptRebates(uint256 amount) external;
}
