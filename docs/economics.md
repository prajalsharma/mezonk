# Economics

Current defaults are those in `contracts/script/Deploy.s.sol`. They are configurable for future markets within hard caps,
and each market keeps the values it was created with.

## Who pays what

| Fee or cost | Paid by | When | Amount | Goes to |
|---|---|---|---|---|
| Trading fee | trader | every buy (on MUSD in) and sell (on MUSD out) | 1% default, hard cap 5% | split: 50% market creator, 50% protocol (default; owner-set split for future markets) |
| Seed liquidity | creator | at creation | ≥ 50 MUSD default | not a fee: it backs the pool and is withdrawn at settlement |
| Proposal bond | resolver | with the proposal | 25 MUSD default | returned if unchallenged or upheld; else to the challenger |
| Challenge bond | challenger | with the challenge | 25 MUSD default | returned plus the resolver's bond if the challenge wins; else to the resolver |
| Claims | — | — | free (network fee only) | — |

Fees never come out of the collateral that backs shares. They accrue in separate buckets (`creatorFees`, `protocolFees`).
The owner can withdraw `protocolFees` only.

## Creator incentives and risk

The creator earns their share of every trading fee and can claim it at any time. In exchange, their seed is the pool's inventory:
at settlement they withdraw what the pool holds at the final rate. If informed traders bought the winning side from the pool,
the pool ends up holding more of the losing side, and the withdrawal can be worth less than the seed. The create flow states
this, and the creator must acknowledge it before publishing.

## Spam and manipulation

- Creating a market requires locking real MUSD (the minimum seed) plus gas. Spam is costly.
- Resolver allowlist: only owner-approved resolvers can resolve, so a creator can't pick themselves to rubber-stamp an outcome.
- Bonds make false proposals and frivolous challenges cost money.
- Price manipulation costs the manipulator slippage, which accrues to the pool.

## Invalid and unresolved markets

Invalid pays 0.5 MUSD per share of either side. A market is Invalid when the resolver rules it, when the arbitrator rules it,
or when either party misses its deadline. Funds never get stuck.

## Sustainability

Revenue is the protocol's share of trading fees. There are no token emissions or reward programs, and nothing promises yield
to MEZO holders or LPs. Possible later revenue: a hosted market-data API for Mezo apps. MEZO token utility (for example creator
bonds or fee governance) is deliberately not implemented until it has a funded, tested rationale.

## Testnet

All amounts on testnet are testnet MUSD with no cash value.
