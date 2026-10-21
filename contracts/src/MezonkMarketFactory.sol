// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IMezonkExchange} from "./interfaces/IMezonkExchange.sol";

interface IExchangeOpen {
    function openMarket(
        address creator,
        address resolver,
        uint32 policyId,
        uint64 closeTime,
        string calldata metadata,
        IMezonkExchange.Config calldata config
    ) external returns (uint256 marketId);
}

/// @title MezonkMarketFactory
/// @notice Publication authority for MezonkExchange. Holds the creator, curator and resolver lists and the
///         publication/resolution config, and verifies each curator approval before the exchange opens a market.
///         Created by the exchange constructor; the only address the exchange accepts new markets from.
contract MezonkMarketFactory is Ownable2Step, EIP712 {
    uint32 public constant MIN_CHALLENGE_WINDOW = 1 hours;
    uint32 public constant MAX_WINDOW = 30 days;
    uint256 public constant MAX_METADATA_BYTES = 8192;
    bytes32 public constant MARKET_APPROVAL_TYPEHASH = keccak256(
        "MarketApproval(bytes32 metadataHash,address creator,address resolver,uint64 closeTime,uint32 policyId,uint64 deadline,bytes32 nonce)"
    );

    IExchangeOpen public immutable exchange;
    IMezonkExchange.Config internal _config;

    mapping(address => bool) public isResolver;
    mapping(address => bool) public isCreator;
    mapping(address => bool) public isCurator;
    /// @notice Consumed or voided approval nonces. An approval publishes at most one market.
    mapping(bytes32 => bool) public approvalUsed;

    event MarketApprovalUsed(uint256 indexed marketId, address indexed curator, bytes32 indexed nonce);
    event MarketApprovalCancelled(address indexed by, bytes32 indexed nonce);
    event ConfigUpdated(IMezonkExchange.Config config);
    event ResolverUpdated(address indexed resolver, bool approved);
    event CreatorUpdated(address indexed creator, bool approved);
    event CuratorUpdated(address indexed curator, bool approved);

    error InvalidConfig();
    error InvalidParams();
    error NotResolver();
    error NotApprovedCreator();
    error NotCurator();
    error SelfApproval();
    error ApprovalExpired();
    error ApprovalUsed();
    error ApprovalMismatch();
    error BadApprovalSignature();

    constructor(address owner_, IMezonkExchange.Config memory config_)
        Ownable(owner_)
        EIP712("MEZONK Markets", "2")
    {
        exchange = IExchangeOpen(msg.sender);
        _setConfig(config_);
    }

    function config() external view returns (IMezonkExchange.Config memory) {
        return _config;
    }

    function approvalDigest(IMezonkExchange.MarketApproval calldata a) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    MARKET_APPROVAL_TYPEHASH,
                    a.metadataHash,
                    a.creator,
                    a.resolver,
                    a.closeTime,
                    a.policyId,
                    a.deadline,
                    a.nonce
                )
            )
        );
    }

    /// @notice Publish a reviewed market into SEEDING. Caller must be an approved creator holding an unused,
    ///         unexpired approval signed by an approved curator (EOA or ERC-1271) who is not the caller.
    function createMarket(
        IMezonkExchange.CreateParams calldata p,
        IMezonkExchange.MarketApproval calldata a,
        address curator,
        bytes calldata sig
    ) external returns (uint256 marketId) {
        uint256 metaLen = bytes(p.metadata).length;
        if (metaLen == 0 || metaLen > MAX_METADATA_BYTES) revert InvalidParams();
        if (!isResolver[p.resolver]) revert NotResolver();
        if (!isCreator[msg.sender]) revert NotApprovedCreator();
        if (!isCurator[curator]) revert NotCurator();
        if (curator == msg.sender) revert SelfApproval();
        if (block.timestamp > a.deadline) revert ApprovalExpired();
        if (approvalUsed[a.nonce]) revert ApprovalUsed();
        if (
            a.creator != msg.sender || a.resolver != p.resolver || a.closeTime != p.closeTime
                || a.policyId != p.policyId || a.metadataHash != keccak256(bytes(p.metadata))
        ) revert ApprovalMismatch();
        if (!SignatureChecker.isValidSignatureNow(curator, approvalDigest(a), sig)) revert BadApprovalSignature();
        approvalUsed[a.nonce] = true;

        marketId = exchange.openMarket(msg.sender, p.resolver, p.policyId, p.closeTime, p.metadata, _config);
        emit MarketApprovalUsed(marketId, curator, a.nonce);
    }

    /// @notice Void an approval before use (review withdrawn). Curators or the owner.
    function cancelApproval(bytes32 nonce) external {
        if (!isCurator[msg.sender] && msg.sender != owner()) revert NotCurator();
        if (approvalUsed[nonce]) revert ApprovalUsed();
        approvalUsed[nonce] = true;
        emit MarketApprovalCancelled(msg.sender, nonce);
    }

    /// @notice Applies to markets published after this call only.
    function setConfig(IMezonkExchange.Config calldata c) external onlyOwner {
        _setConfig(c);
    }

    function setCreator(address a, bool approved) external onlyOwner {
        if (a == address(0)) revert InvalidParams();
        isCreator[a] = approved;
        emit CreatorUpdated(a, approved);
    }

    function setCurator(address a, bool approved) external onlyOwner {
        if (a == address(0)) revert InvalidParams();
        isCurator[a] = approved;
        emit CuratorUpdated(a, approved);
    }

    function setResolver(address a, bool approved) external onlyOwner {
        if (a == address(0)) revert InvalidParams();
        isResolver[a] = approved;
        emit ResolverUpdated(a, approved);
    }

    function _setConfig(IMezonkExchange.Config memory c) internal {
        if (
            c.minLiveDuration == 0 || c.maxDuration > 730 days || c.maxDuration < c.minLiveDuration
                || c.proposalWindow == 0 || c.proposalWindow > MAX_WINDOW || c.challengeWindow < MIN_CHALLENGE_WINDOW
                || c.challengeWindow > MAX_WINDOW || c.arbitrationWindow == 0 || c.arbitrationWindow > MAX_WINDOW
                || c.disputeBond == 0 || c.arbitrator == address(0)
        ) revert InvalidConfig();
        _config = c;
        emit ConfigUpdated(c);
    }
}
