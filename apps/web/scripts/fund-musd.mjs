// Funds anvil test accounts with MUSD on a LOCAL FORK by writing the balance storage slot.
// Finds the balances mapping slot empirically, then verifies with balanceOf.
import { createTestClient, http, publicActions, keccak256, encodeAbiParameters, parseAbi, toHex, pad } from "viem";

const rpc = process.argv[2] ?? "http://127.0.0.1:8545";
const MUSD = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503";
const abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const c = createTestClient({ mode: "anvil", transport: http(rpc) }).extend(publicActions);
const accounts = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
];
const amount = 1_000_000n * 10n ** 18n;
const slotFor = (a, i) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [a, BigInt(i)]));

let slot = -1;
for (let i = 0; i < 20 && slot < 0; i++) {
  await c.setStorageAt({ address: MUSD, index: slotFor(accounts[0], i), value: pad(toHex(amount)) });
  if ((await c.readContract({ address: MUSD, abi, functionName: "balanceOf", args: [accounts[0]] })) === amount) slot = i;
}
if (slot < 0) throw new Error("couldn't find MUSD balance slot");
for (const a of accounts) await c.setStorageAt({ address: MUSD, index: slotFor(a, slot), value: pad(toHex(amount)) });
console.log(`funded ${accounts.length} anvil accounts with 1,000,000 MUSD (fork-local, slot ${slot})`);
