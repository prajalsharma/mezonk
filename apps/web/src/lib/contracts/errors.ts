import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

/** Plain-language messages for exchange, factory, resolution and incentives custom errors. */
const CONTRACT_ERRORS: Record<string, string> = {
  Slippage: "The price moved past your slippage limit. Review the new quote and try again.",
  Expired: "The quote expired before the transaction was mined. Try again.",
  NotTradable: "This market isn't trading right now. It may still be seeding, or trading has closed.",
  InsufficientLiquidity: "Not enough liquidity at this price. Adjust your limit price or quantity, or leave the rest unfilled.",
  InsufficientShares: "You don't hold enough shares for this.",
  BadLot: "Quantities must be in steps of 0.01 shares.",
  CrossesBook: "That price would cross an existing order. Trade against it instead, or pick a price that doesn't cross.",
  NotMaker: "Only the wallet that placed this order can cancel it.",
  StillLocked: "Seed orders are locked for a short time after placement and after launch. Try again later.",
  SelfTrade: "You can't trade against your own order.",
  BadOrderSignature: "One of the orders had an invalid signature. Refresh the book and retry.",
  GraduationUnmet: "The market doesn't meet its launch conditions yet.",
  PolicyInactive: "This market policy no longer accepts new markets.",
  ReferrerLocked: "A referrer can only be set once, before your first trade.",
  BadReferrer: "That referrer isn't allowed (yourself, or someone you referred).",
  NotApprovedCreator: "This wallet isn't an approved creator.",
  NotCurator: "That approval isn't from an approved curator.",
  SelfApproval: "A creator can't approve their own market.",
  ApprovalExpired: "This approval has expired. Ask a curator to sign a new one.",
  ApprovalUsed: "This approval was already used or withdrawn.",
  ApprovalMismatch: "The market details don't match what the curator approved.",
  BadApprovalSignature: "The curator's signature doesn't match the approval.",
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
