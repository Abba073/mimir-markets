/**
 * Read every Mimir agent account off Horizon: native XLM (fees) and the USDC
 * trustline balance (stakes).
 *
 * Run: npx tsx --env-file-if-exists=.env.local scripts/check-agent-balances.ts
 *
 * ── Three states, not two ───────────────────────────────────────────────────
 *
 * The EVM version reported two numbers per wallet and could not distinguish "this
 * address has never been used" from "this address is empty" — on an account-model
 * chain that distinction is the whole diagnosis:
 *
 *   NO ACCOUNT     nothing on the ledger. It cannot hold a trustline, cannot be
 *                  paid, cannot sign. Fix: `npm run agents:fund` (Friendbot).
 *   NO TRUSTLINE   the account exists but cannot hold USDC. A payment to it is
 *                  rejected with `op_no_trust`. Fix: `npm run agents:fund`.
 *   BALANCE        the only state where a number is meaningful.
 *
 * Horizon rather than the SAC balance read in `lib/usdc.ts` because that helper
 * folds all three into `null`, and here telling them apart is the point.
 *
 * Public keys are preferred from `<ROLE>_PUBLIC` and derived from `<ROLE>_SECRET`
 * only as a fallback, so this is runnable on a web-server-shaped env that holds no
 * seeds at all.
 */
import { Keypair } from "@stellar/stellar-sdk";

import { listCouncilPersonas, personaPublicEnv, personaSecretEnv } from "../agents/council/personas";
import {
  PHILOSOPHER_PERSONAS,
  philosopherPublicEnv,
  philosopherSecretEnv,
} from "../agents/council/philosophers";
import { TRADER_PERSONAS } from "../agents/traders/personas";
import { getExplorerAccountUrl, isAccountAddress } from "../lib/stellar";
import { USDC_ASSET } from "../lib/usdc";
import { envValue } from "./lib/stellar-env";
import { readAccount } from "./lib/stellar-funding";

/** `<ROLE>_PUBLIC` if set and valid, else derived from `<ROLE>_SECRET`. */
function resolveAddress(publicEnv: string, secretEnv: string): string | null {
  const declared = envValue(publicEnv);
  if (declared && isAccountAddress(declared)) return declared;
  const secret = envValue(secretEnv);
  if (!secret) return null;
  try {
    return Keypair.fromSecret(secret).publicKey();
  } catch {
    return null;
  }
}

async function withRetry<T>(read: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastError;
}

async function main(): Promise<void> {
  const rows: Array<{ label: string; address: string }> = [];

  const add = (label: string, publicEnv: string, secretEnv: string) => {
    const address = resolveAddress(publicEnv, secretEnv);
    if (address) rows.push({ label, address });
  };

  add("oracle", "ORACLE_PUBLIC", "ORACLE_SECRET");
  add("market-creator", "CREATOR_PUBLIC", "CREATOR_SECRET");
  for (const persona of listCouncilPersonas()) {
    add(`council:${persona.slug}`, personaPublicEnv(persona), personaSecretEnv(persona));
  }
  for (const persona of PHILOSOPHER_PERSONAS) {
    add(
      `philosopher:${persona.slug}`,
      philosopherPublicEnv(persona.slug),
      philosopherSecretEnv(persona.slug),
    );
  }
  for (const persona of TRADER_PERSONAS) {
    add(`trader:${persona.agentId}`, persona.addressEnv, persona.keyEnv);
  }

  if (rows.length === 0) {
    console.error(
      "No agent wallets configured — run: npx tsx scripts/create-agent-wallets.ts --write",
    );
    process.exit(1);
  }

  console.log("Stellar Testnet balances (fee XLM + stake USDC):\n");
  console.log(`USDC asset: ${USDC_ASSET}\n`);

  let unfunded = 0;
  let untrusted = 0;

  for (const row of rows) {
    const state = await withRetry(() => readAccount(row.address));
    if (!state.exists) {
      unfunded += 1;
      console.log(`  ${row.label.padEnd(26)} ${"—".padStart(12)}      ${"no account".padStart(14)}  ${row.address}`);
      continue;
    }
    if (state.usdc === null) untrusted += 1;
    const usdc = state.usdc === null ? "no trustline" : state.usdc.toFixed(4);
    console.log(
      `  ${row.label.padEnd(26)} ${state.xlm.toFixed(4).padStart(12)} XLM ${usdc.padStart(14)} USDC  ${row.address}`,
    );
  }

  if (unfunded > 0 || untrusted > 0) {
    console.log(
      `\n${unfunded} account(s) missing, ${untrusted} without a USDC trustline — ` +
        `fix both with: npm run agents:fund`,
    );
  }
  console.log(`\n${getExplorerAccountUrl(rows[0].address)}`);
}

main().catch((error) => {
  console.error("check-agent-balances failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
