import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

/** Plain-language messages for MezonkMarkets custom errors. */
const CONTRACT_ERRORS: Record<string, string> = {
  Slippage: "The price moved past your slippage limit. Review the new quote and try again.",
  Expired: "The quote expired before the transaction was mined. Try again.",
  NotTradable: "Trading has closed for this market.",
  WrongStage: "The market is not at the right stage for this action. Refresh to see its current state.",
  NotResolver: "Only the market's designated resolver can do this.",
  NotArbitrator: "Only the market's arbitrator can do this.",
  WindowClosed: "The window for this action has closed.",
  WindowOpen: "This can't happen yet. Its waiting period hasn't ended.",
  InvalidOutcome: "Pick Yes, No or Invalid.",
  NothingToClaim: "There is nothing to claim here.",
  NotCreator: "Only the market creator can do this.",
  InvalidParams: "Some market parameters are outside the allowed range.",
  UnknownMarket: "This market does not exist on-chain.",
  UnsupportedToken: "The collateral token behaved unexpectedly. The transaction was stopped.",
  EnforcedPause: "New markets and trading are paused right now. Claims and resolution still work.",
  ERC20InsufficientBalance: "Your MUSD balance is too low for this.",
  ERC20InsufficientAllowance: "MUSD spending approval is too low. Approve first.",
};

export function explainError(e: unknown): string {
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return "You declined the request in your wallet.";
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = revert?.data?.errorName;
    if (name && CONTRACT_ERRORS[name]) return CONTRACT_ERRORS[name];
    const msg = e.shortMessage || e.message;
    if (/insufficient funds/i.test(msg)) return "Not enough BTC to pay network fees. Get testnet BTC from the faucet.";
    if (/user rejected|denied/i.test(msg)) return "You declined the request in your wallet.";
    if (/chain/i.test(msg) && /mismatch|does not match/i.test(msg)) return "Your wallet is on a different network. Switch to Mezo and retry.";
    if (/timeout|timed out|fetch failed|network/i.test(msg)) return "The network didn't respond. Check your connection and retry.";
    return msg.split("\n")[0]!.slice(0, 180);
  }
  return e instanceof Error ? e.message.slice(0, 180) : "Something went wrong.";
}
