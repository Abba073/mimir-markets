/**
 * Provision the whole Mimir agent fleet on Stellar Testnet.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/fund-agents.ts
 *   FUND_AMOUNT_USDC=20 FUND_COUNCIL_AMOUNT_USDC=10 npx tsx ... scripts/fund-agents.ts
 *   DRY_RUN=1 npx tsx ... scripts/fund-agents.ts        # show the plan, send nothing
 *
 * For every agent, in order: create the account (Friendbot), add the USDC
 * trustline, and top its USDC up to the role's target by converting its own XLM on
 * the SDEX. Idempotent throughout — an already-provisioned account costs a few
 * reads and no transaction.
 *
 * ── There is no funder any more ─────────────────────────────────────────────
 *
 * The EVM version required `FUNDER_PRIVATE_KEY` to hold both testnet ETH (from a
 * faucet) and test USDC, then sent each agent a fixed amount of each. Neither leg
 * survives:
 *
 *   gas   Friendbot creates and funds an account for free, and a Stellar fee is
 *         ~0.00001 XLM, so 10,000 XLM is not a budget to manage. The whole "send
 *         everyone 1 ETH of gas" step reduces to "does this account exist".
 *   USDC  Each account buys its own from the SDEX with its own XLM
 *         (`scripts/lib/stellar-funding.ts`). Nothing has to be pre-loaded into a
 *         funder, and one agent running dry cannot starve the rest.
 *
 * `fund-from-oracle.ts` is what remains of the distribution model, and it exists
 * for the one case that still needs it: moving USDC that is already sitting on a
 * specific account (accrued fees, say) out to the fleet.
 */

import { Keypair } from "@stellar/stellar-sdk";

import { listCouncilPersonas, personaSecretEnv } from "../agents/council/personas";
import { PHILOSOPHER_PERSONAS, philosopherSecretEnv } from "../agents/council/philosophers";
import { TRADER_PERSONAS } from "../agents/traders/personas";
import { envValue } from "./lib/stellar-env";
import { provisionAccount, readAccount } from "./lib/stellar-funding";

const USDC_CORE = Number(process.env.FUND_AMOUNT_USDC ?? "20");
const USDC_COUNCIL = Number(process.env.FUND_COUNCIL_AMOUNT_USDC ?? "10");
const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";

interface Target {
  label: string;
  secretEnv: string;
  keypair: Keypair;
  targetUsdc: number;
}

function collect(): Target[] {
  const targets: Target[] = [];

  const add = (label: string, secretEnv: string, targetUsdc: number) => {
    const secret = envValue(secretEnv);
    if (!secret) {
      console.warn(`  · skip ${label} — ${secretEnv} not set`);
      return;
    }
    let keypair: Keypair;
    try {
      keypair = Keypair.fromSecret(secret);
    } catch {
      console.warn(`  · skip ${label} — ${secretEnv} is not a valid Stellar secret seed`);
      return;
    }
    targets.push({ label, secretEnv, keypair, targetUsdc });
  };

  add("oracle", "ORACLE_SECRET", USDC_CORE);
  add("market-creator", "CREATOR_SECRET", USDC_CORE);

  for (const persona of listCouncilPersonas()) {
    add(`council:${persona.slug}`, personaSecretEnv(persona), USDC_COUNCIL);
  }
  // Each philosopher is provisioned to its own declared cycle budget rather than
  // the shared council figure: a persona whose rubric routinely abstains does not
  // need the same float as one that stakes on every claim.
  for (const persona of PHILOSOPHER_PERSONAS) {
    add(
      `philosopher:${persona.slug}`,
      philosopherSecretEnv(persona.slug),
      Math.min(USDC_COUNCIL, persona.limits.maxStakeUsdc * persona.limits.maxClaimsPerCycle),
    );
  }
  for (const persona of TRADER_PERSONAS) {
    // Enough for a few positions. A demo wallet holding a large balance is a
    // needless target, and topping up is free.
    add(`trader:${persona.agentId}`, persona.keyEnv, persona.stakeUsdc * 3);
  }

  return targets;
}

async function main(): Promise<void> {
  console.log("── Mimir agent fleet provisioning (Stellar Testnet) ──");
  const targets = collect();
  if (targets.length === 0) {
    console.error("\nNo agent secrets configured — run: npm run agents:create-wallets");
    process.exit(1);
  }
  console.log(`\nTargets: ${targets.length} wallets`);
  console.log(`  core roles : ${USDC_CORE} USDC each`);
  console.log(`  council    : up to ${USDC_COUNCIL} USDC each`);
  console.log(`  gas        : Friendbot on account creation — nothing to distribute\n`);

  if (DRY_RUN) {
    for (const target of targets) {
      const state = await readAccount(target.keypair.publicKey());
      const held = state.usdc === null ? "no trustline" : `${state.usdc.toFixed(4)} USDC`;
      console.log(
        `  ${target.label.padEnd(28)} ${target.keypair.publicKey()}  ` +
          `${state.exists ? `${state.xlm.toFixed(2)} XLM` : "does not exist"} · ${held} ` +
          `→ target ${target.targetUsdc} USDC`,
      );
    }
    console.log("\nDry run only; nothing was created, trusted or bought.");
    return;
  }

  let failures = 0;
  for (const target of targets) {
    console.log(`[${target.label}] ${target.keypair.publicKey()}`);
    try {
      await provisionAccount({
        label: target.label,
        keypair: target.keypair,
        targetUsdc: target.targetUsdc,
      });
    } catch (error) {
      // One agent's failure is not the fleet's: a thin SDEX book for one top-up
      // must not leave the remaining twenty unprovisioned.
      failures += 1;
      console.error(`    ✗ ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log(
    failures === 0
      ? "\n✓ fleet provisioned. Balances: npm run agents:balances"
      : `\n⚠ ${failures} of ${targets.length} wallets failed — re-run to retry just those.`,
  );
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error("fund-agents failed:", error instanceof Error ? error.message : error);
  const extras = (error as { response?: { data?: unknown } })?.response?.data;
  if (extras) console.error(JSON.stringify(extras, null, 2));
  process.exit(1);
});
