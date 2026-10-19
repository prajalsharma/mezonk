/** Exact message a wallet signs to attach an evidence link. Shared by client and server. */
export const evidenceMessage = (marketId: number, url: string, note: string) =>
  `MEZONK evidence submission\nMarket: ${marketId}\nURL: ${url}\nNote: ${note}`;
