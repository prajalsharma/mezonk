# Threat model (protocol-wide)

The resolution-specific threats are in [RESOLUTION_THREAT_MODEL.md](RESOLUTION_THREAT_MODEL.md). This file covers the rest.

| Threat | Impact | Mitigation | Residual |
|---|---|---|---|
| Reentrancy via token | theft | `nonReentrant` everywhere, CEI; malicious-token tests | — |
| Malicious or fee-on-transfer collateral | insolvency | immutable MUSD address; balance-delta check rejects fee-on-transfer | MUSD is trusted (OZ ERC20Permit, no hooks) |
| Wrong token or chain | lost funds | verified addresses in one module; deploy script checks code, decimals and symbol; mainnet flags | — |
| Rounding drift | insolvency | all rounding favours the pool; invariants fuzzed | dust stays in the contract |
| Sandwiching trades | worse price | `minOut` and `deadline` parameters; quote re-read on-chain before signing | normal AMM exposure |
| Stale quotes | unexpected fills | 30s quote age display; on-chain re-quote at submit; slippage floor | — |
| Permit or signature replay | — | permits not used; evidence signatures are informational only | — |
| Gas DoS / unbounded loops | stuck functions | no loops over users or markets in the contract | — |
| API abuse | cost | validation, size caps, rate limits | per-instance limiter |
| XSS / injection | phishing | React escaping, Drizzle parameterized queries, escaped LIKE patterns | — |
| SSRF | internal access | no server-side fetch of user URLs | — |
| DB race conditions | duplicate rows | unique constraints; single-flight indexer; per-market transactional rebuild | — |
| Indexer reorg errors | wrong history | block-hash checks, rewind, replay; integration-tested | display only |
| Compromised deploy key | config abuse | transfer ownership to a multisig after deploy; keystore not raw keys | operational |
| Dependency supply chain | wallet compromise | pinned versions, lockfile; optional SDK paths stubbed rather than installed | review `pnpm audit` before release |
