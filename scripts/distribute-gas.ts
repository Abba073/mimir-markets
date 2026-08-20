/**
 * Make sure every agent account exists and can pay its own fees.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/distribute-gas.ts
 *   DRY_RUN=1 npx tsx ... scripts/distribute-gas.ts     (report only, create nothing)
 *
 * ── This script's premise collapsed, and that is the point ───────────────────
 *
 * On the EVM chain it was a real, recurring job: read every wallet's ETH balance,
 * work out per-role targets (a market-creator opening four markets a run burns far
 * more than a philosopher placing the occasional stake), keep a reserve on the
 * funder, and send each wallet exactly its shortfall — because gas was a scarce
 * budget that ran out mid-cycle and had to be replenished from an account that
 * itself had to be kept solvent from a faucet.
 *
 * On Stellar none of that arithmetic exists:
 *
 *   - A transaction fee is 100 stroops per operation — 0.00001 XLM. Friendbot
 *     hands a new account 10,000 XLM. That is a billion operations. Per-role
 *     targets, reserve thresholds and top-up hysteresis are all tuning for a
 *     constraint that is nine orders of magnitude away from binding.
 *   - Fees are paid in XLM, which is NOT the stake currency. An agent burning
 *     through its USDC bankroll cannot strand itself for fees, and vice versa —
 *     the coupling that made the EVM version fiddly is gone.
 *   - The only genuinely fatal state is an account that does not EXIST: below the
 *     base reserve there is no account, so it cannot hold a trustline, cannot be
 *     paid, and cannot sign. That is binary, not a level to top up.
 *
 * So what is left is a health check with a fix attached: report every agent's XLM,
 * and create anything missing from Friendbot. Kept as its own command because
 * "is the fleet able to transact at all" is a question worth answering in one
 * line, separately from `fund-agents.ts` doing trustlines and SDEX purchases.
 */

import { Keypair } from "@stellar/stellar-sdk";

import { COUNCIL_PERSONAS, personaSecretEnv } from "../agents/council/personas";
import { PHILOSOPHER_PERSONAS, philosopherSecretEnv } from "../agents/council/philosophers";
import { TRADER_PERSONAS } from "../agents/traders/personas";
import { STELLAR_NETWORK } from "../lib/stellar";
import { envValue } from "./lib/stellar-env";
import { ensureAccount, readAccount } from "./lib/stellar-funding";

/**
 * Enough XLM to pay fees for a very long time while leaving the base reserve
 * intact. Purely advisory: below it the script warns, it does not act, because a
 * funded account below this figure has still spent under a hundredth of what
 * Friendbot gave it and something else is wrong.
 */
const LOW_XLM_WARNING = 1;

interface Target {
  label: string;
  address: string;
}

function collect(): Target[] {
  const targets: Target[] = [];
  const add = (label: string, secretEnv: string) => {
    const secret = envValue(secretEnv);
    if (!secret) return;
    try {
      targets.push({ label, address: Keypair.fromSecret(secret).publicKey() });
    } catch {
      console.warn(`  · skip ${label} — ${secretEnv} is not a valid Stellar secret seed`);
    }
  };

  add("oracle", "ORACLE_SECRET");
  add("market-creator", "CREATOR_SECRET");
  for (const persona of COUNCIL_PERSONAS) add(persona.displayName, personaSecretEnv(persona));
  for (const persona of PHILOSOPHER_PERSONAS) {
    add(persona.displayName, philosopherSecretEnv(persona.slug));
  }
  for (const persona of TRADER_PERSONAS) add(persona.displayName, persona.keyEnv);
  return targets;
}

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === "1";
  const targets = collect();
  if (targets.length === 0) {
    console.error("No agent secrets configured — run: npm run agents:create-wallets");
    process.exit(1);
  }

  console.log(`── Agent account reserve check (${STELLAR_NETWORK})${dryRun ? " · dry run" : ""} ──`);
  console.log(`  ${targets.length} accounts · a fee is 0.00001 XLM per operation\n`);

  let missing = 0;
  let created = 0;
  let low = 0;

  for (const target of targets) {
    const state = await readAccount(target.address);
    if (!state.exists) {
      missing += 1;
      if (dryRun) {
        console.log(`  ✗ ${target.label.padEnd(24)} does not exist — would fund via friendbot`);
        continue;
      }
      try {
        await ensureAccount(target.address);
        const after = await readAccount(target.address);
        created += 1;
        console.log(`  ✓ ${target.label.padEnd(24)} created — ${after.xlm.toFixed(2)} XLM`);
      } catch (error) {
        console.error(
          `  ✗ ${target.label.padEnd(24)} friendbot failed: ${error instanceof Error ? error.message : error}`,
        );
      }
      continue;
    }
    if (state.xlm < LOW_XLM_WARNING) {
      low += 1;
      console.log(
        `  ⚠ ${target.label.padEnd(24)} ${state.xlm.toFixed(4)} XLM — unexpectedly low; ` +
          `check for a runaway loop or a large payment out`,
      );
      continue;
    }
    console.log(`  · ${target.label.padEnd(24)} ${state.xlm.toFixed(2)} XLM`);
  }

  console.log(
    `\n${targets.length - missing - low} healthy` +
      `${created ? `, ${created} created` : ""}` +
      `${low ? `, ${low} low` : ""}` +
      `${missing - created ? `, ${missing - created} still missing` : ""}.`,
  );
  if (!dryRun && missing > created) process.exit(1);
}

main().catch((error) => {
  console.error("distribute-gas failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
