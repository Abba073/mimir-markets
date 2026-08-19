/**
 * Construct the generated contract clients from `.env.local`.
 *
 * Everything here goes through `sdk/contracts/*` — the output of
 * `stellar contract bindings typescript` — so any script built on this doubles as
 * a bindings smoke test. No hand-rolled XDR, no hand-written contract specs.
 */
import { Keypair } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";

import { Client as MarketClient } from "../../sdk/contracts/mimir-market/src/index";
import { Client as SquadClient } from "../../sdk/contracts/mimir-squad/src/index";
import { ENV_KEYS, NETWORK_PASSPHRASE, SOROBAN_RPC_URL, requireEnv } from "./stellar-env";

export type Role = "deployer" | "oracle";

const SECRET_KEYS: Record<Role, string> = {
  deployer: ENV_KEYS.deployerSecret,
  oracle: ENV_KEYS.oracleSecret,
};

export function keypairFor(role: Role): Keypair {
  return Keypair.fromSecret(requireEnv(SECRET_KEYS[role], "run: npx tsx scripts/stellar-keys.ts"));
}

interface SignerBundle {
  publicKey: string;
  signTransaction: ReturnType<typeof basicNodeSigner>["signTransaction"];
  signAuthEntry: ReturnType<typeof basicNodeSigner>["signAuthEntry"];
}

/**
 * `signAuthEntry` matters as much as `signTransaction` here: `create_claim` and
 * `challenge_claim` both `require_auth()` and then invoke the USDC SAC's
 * `transfer` on the caller's behalf, so the caller has to sign a SorobanAuth
 * entry, not just the envelope.
 */
export function signerFor(role: Role): SignerBundle {
  const keypair = keypairFor(role);
  const signer = basicNodeSigner(keypair, NETWORK_PASSPHRASE);
  return {
    publicKey: keypair.publicKey(),
    signTransaction: signer.signTransaction,
    signAuthEntry: signer.signAuthEntry,
  };
}

function baseOptions(role?: Role) {
  return {
    rpcUrl: SOROBAN_RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    allowHttp: false,
    ...(role ? signerFor(role) : {}),
  };
}

/** Read-only when `role` is omitted; signing-capable otherwise. */
export function marketClient(role?: Role): MarketClient {
  return new MarketClient({
    contractId: requireEnv(ENV_KEYS.marketId, "run: npx tsx deploy/deploy.ts"),
    ...baseOptions(role),
  });
}

export function squadClient(role?: Role): SquadClient {
  return new SquadClient({
    contractId: requireEnv(ENV_KEYS.squadId, "run: npx tsx deploy/deploy.ts"),
    ...baseOptions(role),
  });
}

export function marketContractId(): string {
  return requireEnv(ENV_KEYS.marketId, "run: npx tsx deploy/deploy.ts");
}

export function squadContractId(): string {
  return requireEnv(ENV_KEYS.squadId, "run: npx tsx deploy/deploy.ts");
}

export function usdcSacId(): string {
  return requireEnv(ENV_KEYS.usdcSac, "run: npx tsx deploy/deploy.ts");
}

/**
 * Simulate, sign, submit, and unwrap a `Result<T>` returned by a contract call.
 * The generated bindings hand back `AssembledTransaction<Result<T>>`; a Soroban
 * `Err` surfaces as a `Result` in the `result` field rather than a throw, so it
 * has to be unwrapped explicitly or contract errors pass silently.
 */
export async function sendAndUnwrap<T>(
  label: string,
  assembled: { signAndSend: () => Promise<{ result: unknown; getTransactionResponse?: unknown }> },
): Promise<T> {
  const sent = await assembled.signAndSend();
  return unwrapResult<T>(label, sent.result);
}

export function unwrapResult<T>(label: string, result: unknown): T {
  if (result && typeof result === "object" && "isOk" in result) {
    const rustResult = result as { isOk(): boolean; unwrap(): T; error?: unknown };
    if (!rustResult.isOk()) {
      const error = rustResult.error;
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : JSON.stringify(error);
      throw new Error(`${label} returned a contract error: ${message}`);
    }
    return rustResult.unwrap();
  }
  return result as T;
}
