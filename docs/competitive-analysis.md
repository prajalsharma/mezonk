# Competitive analysis

Research date: 2026-10-19. Sources were read directly where possible; anything not verified is marked.

## Mezo ecosystem

### Hackathon 1 winners ([mezo.org/blog/mezo-hackathon-winners](https://mezo.org/blog/mezo-hackathon-winners/))
TrovePilot, BTCShield, StratumFi, KhipuVault, BitSpend, CreatorBank, Invoiced, BountyPay, MezoLotto.
**No prediction market won.** The nearest is MezoLotto ([repo](https://github.com/AllenAJ/MezoLotto)), a no-loss prize-savings
lottery: deposits earn tickets and the yield goes to a random winner. It's a different product: no question, no outcome, no trading.

### Hackathon 2 winners ([announcement](https://mezo.org/blog/announcing-mezo-hackathon-2-winners/))
Cermin, Mezo TreasuryOS, AdaptiveGuard, Cark, MezoPay, SuperPage, Mezoir, BynD, Fractals. **No prediction market won.**

**Wager** received an honorable mention as "a prediction market where MUSD is the only asset"
([contracts](https://github.com/Mezo-Hackathon/wager-contract), [frontend](https://github.com/Mezo-Hackathon/wager-frontend),
[backend](https://github.com/Mezo-Hackathon/wager-backend)). From reading its contracts (internally "MammothBet"):

| | Wager | MEZONK |
|---|---|---|
| Market type | price direction only (asset above/below a target over a window) | any objectively checkable yes/no event, including prices |
| Mechanism | pari-mutuel pools + LPs | fixed-product AMM over fully backed Yes/No pairs |
| Exit before close | no | yes, sell back to the pool |
| Price signal | pool ratio, final payout unknown until close | live price = implied probability; payout per share fixed at 1 MUSD |
| Resolution | automatic from Pyth start/close prices | optimistic: resolver proposal with evidence → challenge with bond → arbitrator ruling with published rationale; Invalid fallback |
| Rules | implied by price parameters | structured rules hashed on-chain at creation, verified in the UI |

The blog also mentions unnamed submissions that settled prediction-market bets in MUSD.

### Other live prediction markets on Mezo
None found (web search, Mezo docs, GitHub). **UNVERIFIED:** there may be unlisted projects.

### Current program
The Akindo page (wave-hacks/OVOO0gdrVU8379D10) is the **Mezo Buildathon: Build with MUSD and MEZO**: $7,000 in MEZO;
Wave 1 submissions due **2026-10-26 15:00 UTC**; Wave 2 demo day 23 Nov. The tracks are (1) DeFi and (2) Access and Distribution.
MUSD or MEZO integration is mandatory, and judges favour composability ("extend, don't detour") over standalone consumer apps.
A prediction market fits neither track cleanly, so MEZONK should be pitched on MUSD utility and composability:
MUSD as the only collateral and settlement asset, a public market-data API, and a settlement interface other Mezo apps can read.

## Outside Mezo (background, not re-verified today)

| Product | Mechanism | Resolution |
|---|---|---|
| Polymarket | CTF outcome tokens, hybrid off-chain orderbook | UMA Optimistic Oracle (proposal, dispute window, DVM vote) |
| Omen (Gnosis) | FPMM over CTF tokens | Reality.eth bonds + Kleros arbitration |
| Azuro | shared liquidity pool as bookmaker (sports) | data providers + dispute layer |
| Limitless (Base) | moved from AMM to CTF orderbook; short-term price markets | price markets via oracle; others team-resolved |

MEZONK's mechanism is closest to Omen's FPMM. Its resolution is closest in shape to UMA and Reality.eth, but there is no UMA,
Reality.eth or Kleros on Mezo (verified by the absence of any deployment in the Mezo docs), so MEZONK implements its own
optimistic flow with a replaceable arbitrator address.

## Differentiation

1. **Event markets, not only price bets.** Structured rules (Yes / No / Invalid / conflicting-data clauses, a source, an
   evaluation time) are hashed into the contract and verified in the UI.
2. **Contestable resolution with a public evidence trail.** Every proposal, challenge and ruling commits a document hash.
   The app re-verifies each document. Nothing can get stuck, because missed deadlines fall through to Invalid.
3. **Exit any time before close**, with a live price that is the implied probability.
4. **Transparent accounting.** Every Yes/No pair is backed by 1 MUSD; the solvency invariants are fuzz-tested.
5. **Composable data.** A public JSON API (markets, history, resolution, portfolio) and a non-upgradeable contract others can read.

## Name check

"MEZONK": no GitHub repositories, no npm package, no DNS for mezonk.com/.xyz/.io, and no product or token found by web search.
**UNVERIFIED:** the CoinGecko lookup was rate-limited.

## Open questions

- Will Mezo or its ecosystem deploy a decentralized arbitration or oracle layer MEZONK could plug into?
- Pyth (`0x2880aB155794e7179c9eE2e38200202908C17B43`) and the native Skip BTC/USD feed (`0x7b7c…0015`) are live on Mezo. A Pyth-based resolver adapter could automate price markets.
- Stork and Supra addresses on Mezo: UNVERIFIED.
