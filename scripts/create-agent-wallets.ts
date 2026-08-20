/**
 * Generate every Mimir agent's Stellar keypair in one pass:
 *
 *   ORACLE_SECRET / ORACLE_PUBLIC
 *   CREATOR_SECRET / CREATOR_PUBLIC
 *   COUNCIL_<SLUG>_SECRET / _PUBLIC  ×10 (classic jury)
 *   COUNCIL_<SLUG>_SECRET / _PUBLIC  ×10 (philosopher jury)
 *   TRADER_<NAME>_SECRET / _PUBLIC   ×3  (demo BYOA traders)
 *
 *   npx tsx scripts/create-agent-wallets.ts           # print the env block
 *   npx tsx scripts/create-agent-wallets.ts --write   # upsert into .env.local
 *
 * The --write mode upserts: an existing secret is KEPT (never rotated silently),
 * only missing ones are generated. It also writes the public-key block the WEB
 * server needs (`SELLER_ADDRESS` + every `_PUBLIC`) — the web server never sees a
 * secret seed.
 *
 * ── What changed from the EVM version ───────────────────────────────────────
 *
 *  - `Keypair.random()` instead of `generatePrivateKey()`; the seed is a `S…`
 *    strkey, not 0x hex, and the public key is a `G…` strkey derived from it
 *    rather than a hash of it.
 *  - Env names are `_SECRET` / `_PUBLIC`, matching `STELLAR_DEPLOYER_SECRET` /
 *    `STELLAR_DEPLOYER_PUBLIC` from `deploy/deploy.ts`.
 *  - `.env.local` is written through `writeEnvLocal` from
 *    `scripts/lib/stellar-env.ts` rather than a local regex upsert, so comments,
 *    ordering and unrelated keys survive exactly as the deploy tooling leaves
 *    them. (The old hand-rolled version could not rewrite an `export FOO=` line
 *    and appended a duplicate.)
 *  - A generated keypair is INERT until it is funded: nothing exists on the
 *    ledger until Friendbot creates it. Run `npm run agents:fund` next.
 *
 * Secrets are printed only in the dry-run block (which is what makes the dry run
 * useful) and are never logged by `--write`.
 */

import { Keypair } from "@stellar/stellar-sdk";

import {
  listCouncilPersonas,
  personaSecretEnv,
  personaPublicEnv,
} from "../agents/council/personas";
import {
  PHILOSOPHER_PERSONAS,
  philosopherPublicEnv,
  philosopherSecretEnv,
} from "../agents/council/philosophers";
import { TRADER_PERSONAS } from "../agents/traders/personas";
import { ENV_LOCAL_PATH, readEnvLocal, writeEnvLocal } from "./lib/stellar-env";

const WRITE = process.argv.includes("--write");

interface WalletEntry {
  secretEnv: string;
  publicEnv: string;
  label: string;
  keypair: Keypair;
  reused: boolean;
}

function main(): void {
  // Read from process.env first (so `--env-file` wins) and fall back to the file,
  // matching `envValue()`'s precedence — otherwise a secret injected by CI would
  // be treated as missing and silently rotated.
  const fromFile = readEnvLocal();
  const existing = (key: string): string | undefined =>
    (process.env[key] ?? fromFile[key])?.split(/\s+#/)[0].trim() || undefined;

  const entries: WalletEntry[] = [];

  const make = (secretEnv: string, publicEnv: string, label: string): WalletEntry => {
    const kept = existing(secretEnv);
    let keypair: Keypair | null = null;
    if (kept) {
      try {
        keypair = Keypair.fromSecret(kept);
      } catch {
        throw new Error(
          `${secretEnv} is set but is not a valid Stellar secret seed (S…). ` +
            `Fix or remove it — this script will not overwrite a key it cannot read.`,
        );
      }
    }
    const entry: WalletEntry = {
      secretEnv,
      publicEnv,
      label,
      keypair: keypair ?? Keypair.random(),
      reused: keypair !== null,
    };
    entries.push(entry);
    return entry;
  };

  const oracle = make("ORACLE_SECRET", "ORACLE_PUBLIC", "oracle");
  make("CREATOR_SECRET", "CREATOR_PUBLIC", "market-creator");

  for (const persona of listCouncilPersonas()) {
    make(personaSecretEnv(persona), personaPublicEnv(persona), `council:${persona.slug}`);
  }
  // The philosopher jury gets its own wallets, so a philosopher's budget and its
  // record are separable from a classic persona's rather than pooled.
  for (const persona of PHILOSOPHER_PERSONAS) {
    make(
      philosopherSecretEnv(persona.slug),
      philosopherPublicEnv(persona.slug),
      `philosopher:${persona.slug}`,
    );
  }
  // Demo BYOA traders. Same treatment: they register through the public agent API
  // and sign their own transactions, so they need their own keypairs.
  for (const persona of TRADER_PERSONAS) {
    make(persona.keyEnv, persona.addressEnv, `trader:${persona.agentId}`);
  }

  const generated = entries.filter((entry) => !entry.reused).length;

  console.log("\n# ── Worker secrets (agents only — NEVER expose to the web server) ──");
  for (const entry of entries) {
    console.log(
      `${entry.secretEnv}=${entry.keypair.secret()}   # ${entry.label}${entry.reused ? " (reused)" : ""}`,
    );
  }
  console.log("\n# ── Public keys (safe for the web server / Vercel env) ──");
  // Default x402 payment recipient = oracle, as before.
  console.log(`SELLER_ADDRESS=${oracle.keypair.publicKey()}`);
  for (const entry of entries) {
    console.log(`${entry.publicEnv}=${entry.keypair.publicKey()}`);
  }

  if (!WRITE) {
    console.log(
      `\n(dry run — ${entries.length} wallets, ${generated} would be newly generated.` +
        ` Re-run with --write to upsert them into .env.local)`,
    );
    return;
  }

  const updates: Record<string, string> = { SELLER_ADDRESS: oracle.keypair.publicKey() };
  for (const entry of entries) {
    updates[entry.secretEnv] = entry.keypair.secret();
    updates[entry.publicEnv] = entry.keypair.publicKey();
  }
  writeEnvLocal(updates, {
    header: "# ── Agent wallets (written by scripts/create-agent-wallets.ts) ──",
  });

  console.log(
    `\n✓ ${ENV_LOCAL_PATH} updated — ${entries.length} wallets ` +
      `(${generated} new, ${entries.length - generated} reused)`,
  );
  console.log("Next: fund them on testnet — npm run agents:fund");
}

try {
  main();
} catch (error) {
  console.error("create-agent-wallets failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
