# Initial audit (2026-10-19)

- **Repository:** none existed. Created `~/mezonk` (pnpm monorepo, git on `main`, repo-local identity).
- **Toolchain:** Node 22.23.1, pnpm 10.20, bun 1.2.12, Foundry 1.6.0. No Postgres or Docker on the machine, so PGlite is used locally.
  Slither was installed via pip during the build.
- **Prior work:** none for this product. Related prior art reviewed: Mezo hackathon projects (see competitive-analysis.md).
- **Environment variables:** none existed. See `.env.example`.
- **Verified chain facts** (live RPC and official docs): testnet 31611 / mainnet 31612; MUSD addresses; getLogs cap 9,999 blocks;
  docs list a non-resolving `rpc.mezo.org`, so the provider RPCs from the docs are used instead.
- **Decisions:** Next.js 15 + wagmi 2 + RainbowKit; Mezo Passport deferred because it requires React 18 and pins RainbowKit 2.0.2.
