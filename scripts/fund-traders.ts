/**
 * Provision the demo BYOA traders only.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/fund-traders.ts
 *   TRADER_FUND_USDC=6 npx tsx ... scripts/fund-traders.ts
 *
 * Separate from `fund-agents.ts` so the traders can be re-provisioned without
 * touching the twenty council wallets — a demo reset is a common thing to want and
 * walking the whole fleet is twenty needless Horizon round trips.
 *
 * Sends only what a trader needs for a few positions: topping up is free, and a
 * demo wallet holding a large balance is a needless target.
 *
 * ── No gas leg ──────────────────────────────────────────────────────────────
 *
 * The EVM version sent `TRADER_FUND_ETH` alongside the stake token. Friendbot
 * creates the account with 10,000 XLM and a Stellar fee is ~0.00001 XLM, so the
 * gas parameter had nothing left to tune and is gone rather than kept as a knob
 * that does nothing. USDC comes from the trader's own XLM on the SDEX — see
 * `scripts/lib/stellar-funding.ts`.
 */

import { Keypair } from "@stellar/stellar-sdk";

import { TRADER_PERSONAS } from "../agents/traders/personas";
import { envValue } from "./lib/stellar-env";
import { provisionAccount, readAccount } from "./lib/stellar-funding";

const TARGET_USDC = Number(process.env.TRADER_FUND_USDC ?? "6");

async function main(): Promise<void> {
  console.log("── Demo trader provisioning (Stellar Testnet) ──");
  console.log(`  target: ${TARGET_USDC} USDC per trader\n`);

  let failures = 0;
  for (const persona of TRADER_PERSONAS) {
    const secret = envValue(persona.keyEnv);
    if (!secret) {
      console.log(`  ${persona.emoji} ${persona.agentId}: ${persona.keyEnv} not set, skipping`);
      continue;
    }
    let keypair: Keypair;
    try {
      keypair = Keypair.fromSecret(secret);
    } catch {
      console.log(`  ${persona.emoji} ${persona.agentId}: ${persona.keyEnv} is not a valid S… seed`);
      failures += 1;
      continue;
    }

    const before = await readAccount(keypair.publicKey());
    console.log(`  ${persona.emoji} ${persona.agentId} ${keypair.publicKey()}`);
    console.log(
      `     before: ${before.exists ? `${before.xlm.toFixed(2)} XLM` : "does not exist"} · ` +
        `${before.usdc === null ? "no USDC trustline" : `${before.usdc.toFixed(4)} USDC`}`,
    );

    try {
      await provisionAccount({
        label: persona.agentId,
        keypair,
        targetUsdc: TARGET_USDC,
        log: (line) => console.log(`  ${line}`),
      });
    } catch (error) {
      failures += 1;
      console.error(`     ✗ ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log(failures === 0 ? "\n✓ Done." : `\n⚠ ${failures} trader(s) failed — re-run to retry.`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error("fund-traders failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
