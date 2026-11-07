/**
 * A signer for scripts: either a Foundry keystore (local runs; the password is asked once and kept in a 0600 temp
 * file that is deleted on exit) or a private key from an environment variable (unattended hosts). Keys never leave
 * this process and are never logged.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { createWalletClient, getAddress, http, type Address, type Hex, type TypedDataDefinition } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mezoTestnet } from "../../src/lib/chain/config";
import { laggingNodeFetch } from "../../src/lib/chain/laggingNodeFetch";

let dir: string | null = null;
function tempDir() {
  if (!dir) {
    dir = mkdtempSync(path.join(tmpdir(), "mezonk-signer-"));
    process.on("exit", () => dir && rmSync(dir, { recursive: true, force: true }));
  }
  return dir;
}

function askHidden(q: string): Promise<string> {
  const mute = new Writable({ write: (_c, _e, cb) => cb() });
  const rl = createInterface({ input: process.stdin, output: mute, terminal: true });
  process.stdout.write(q);
  return new Promise((res) => rl.question("", (a) => (rl.close(), process.stdout.write("\n"), res(a))));
}

const cast = (args: string[]) => execFileSync("cast", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

export interface Signer {
  label: string;
  address: Address;
  signMessage(message: string): Promise<Hex>;
  signTypedData(def: TypedDataDefinition & { domain: Record<string, unknown> }): Promise<Hex>;
  /** Broadcasts once (never retried: a retry after a broadcast that landed could act twice) and returns the hash. */
  send(to: Address, data: Hex, rpc: string): Promise<Hex>;
}

/** `envKey` names a variable holding a 0x private key; otherwise `account` is a Foundry keystore name. */
export async function loadSigner(role: string, envKey: string, account: string): Promise<Signer> {
  const key = process.env[envKey]?.trim();
  if (key) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`${envKey} must be 0x followed by 64 hex characters`);
    const acct = privateKeyToAccount(key as Hex);
    return {
      label: `${role} (${envKey})`,
      address: acct.address,
      signMessage: (message) => acct.signMessage({ message }),
      signTypedData: (def) => acct.signTypedData(def as never),
      send: (to, data, rpc) =>
        createWalletClient({ account: acct, chain: mezoTestnet, transport: http(rpc, { retryCount: 3, retryDelay: 1000, fetchFn: laggingNodeFetch }) }).sendTransaction({ to, data }),
    };
  }
  const pwFile = path.join(tempDir(), `${role}.pw`);
  writeFileSync(pwFile, await askHidden(`Password for keystore "${account}" (${role}): `), { mode: 0o600 });
  const auth = ["--account", account, "--password-file", pwFile];
  const address = getAddress(cast(["wallet", "address", ...auth]).trim());
  return {
    label: `${role} (keystore ${account})`,
    address,
    signMessage: async (message) => cast(["wallet", "sign", ...auth, message]).trim() as Hex,
    signTypedData: async (def) => {
      const f = path.join(tempDir(), `${role}-typed.json`);
      const domainFields = [
        ["name", "string"],
        ["version", "string"],
        ["chainId", "uint256"],
        ["verifyingContract", "address"],
      ].filter(([k]) => def.domain[k!] !== undefined);
      const json = JSON.stringify(
        { types: { EIP712Domain: domainFields.map(([name, type]) => ({ name, type })), ...def.types }, primaryType: def.primaryType, domain: def.domain, message: def.message },
        (_k, v) => (typeof v === "bigint" ? v.toString() : v),
      );
      writeFileSync(f, json, { mode: 0o600 });
      return cast(["wallet", "sign", ...auth, "--data", "--from-file", f]).trim() as Hex;
    },
    send: async (to, data, rpc) => {
      try {
        return cast(["send", to, data, ...auth, "--rpc-url", rpc, "--async"]).trim() as Hex;
      } catch (e) {
        const msg = (e as { stderr?: string }).stderr || (e as Error).message;
        throw new Error(msg.trim().split("\n").slice(-3).join(" "));
      }
    },
  };
}
