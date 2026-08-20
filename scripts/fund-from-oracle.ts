/**
 * Distribute USDC from the oracle account to the rest of the fleet.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/fund-from-oracle.ts
 *   npx tsx --env-file-if-exists=.env.local scripts/fund-from-oracle.ts --dry-run
 *
 * This is the one funding path that still needs a funder, and it exists for the
 * case `fund-agents.ts` cannot cover: USDC that is ALREADY sitting on a specific
 * account — accrued platform fees the oracle has claimed, or a balance bought in
 * bulk — and should be spread across the personas rather than each of them buying
 * its own on the SDEX.
 *
 * ── Half of this script's old job no longer exists ──────────────────────────
 *
 * The EVM version sent every target native ETH for gas AND USDC for stakes. The
 * gas leg is gone: Friendbot creates an account with 10,000 XLM for free and a
 * Stellar fee is ~0.00001 XLM, so there is nothing to ration and no funder to keep
 * topped up. `fund-agents.ts` handles account creation; this script only moves
 * USDC, and it refuses to send to an account that cannot receive it yet rather
 * than silently failing with `op_no_trust`.
 */

import { Keypair } from "@stellar/stellar-sdk";

import { listCouncilPersonas, personaSecretEnv } from "../agents/council/personas";
import { PHILOSOPHER_PERSONAS, philosopherSecretEnv } from "../agents/council/philosophers";
import { TRADER_PERSONAS } from "../agents/traders/personas";
import { loadAgentWallet, transferUsdc } from "../lib/agent-wallets";
import { envValue, explorerTxUrl, formatAtomicUsdc, parseUsdcAtomic } from "./lib/stellar-env";
import { readAccount } from "./lib/stellar-funding";

const USDC_CREATOR = parseUsdcAtomic(process.env.FUND_AMOUNT_USDC ?? "20");
const USDC_COUNCIL = parseUsdcAtomic(process.env.FUND_COUNCIL_AMOUNT_USDC ?? "10");
const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";

function bigintMin(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

interface Target {
  label: string;
  address: string;
  targetAtomic: bigint;
}

async function main(): Promise<void> {
  // `loadAgentWallet` normalises the seed (inline comments, stray CR) and throws a
  // named error when it is missing, so no local cleaning pass is needed.
  const funder = loadAgentWallet("ORACLE_SECRET");

  const targets: Target[] = [];
  const add = (label: string, secretEnv: string, targetAtomic: bigint) => {
    const secret = envValue(secretEnv);
    if (!secret) {
      console.warn(`  · skip ${label} — ${secretEnv} not set`);
      return;
    }
    let address: string;
    try {
      address = Keypair.fromSecret(secret).publicKey();
    } catch {
      console.warn(`  · skip ${label} — ${secretEnv} is not a valid Stellar secret seed`);
      return;
    }
    if (address === funder.address) {
      console.log(`  · ${label.padEnd(28)} is the funder — skip self-transfer`);
      return;
    }
    targets.push({ label, address, targetAtomic });
  };

  add("market-creator", "CREATOR_SECRET", USDC_CREATOR);
  for (const persona of listCouncilPersonas()) {
    add(`council:${persona.slug}`, personaSecretEnv(persona), USDC_COUNCIL);
  }
  for (const persona of PHILOSOPHER_PERSONAS) {
    const cycleBudget = parseUsdcAtomic(
      String(persona.limits.maxStakeUsdc * persona.limits.maxClaimsPerCycle),
    );
    add(
      `philosopher:${persona.slug}`,
      philosopherSecretEnv(persona.slug),
      bigintMin(USDC_COUNCIL, cycleBudget),
    );
  }
  for (const persona of TRADER_PERSONAS) {
    add(`trader:${persona.agentId}`, persona.keyEnv, parseUsdcAtomic(String(persona.stakeUsdc * 3)));
  }

  const funderState = await readAccount(funder.address);
  console.log(`Funder (oracle): ${funder.address}`);
  console.log(`  XLM  : ${funderState.xlm.toFixed(4)}`);
  console.log(
    `  USDC : ${funderState.usdc === null ? "no trustline" : funderState.usdc.toFixed(4)}`,
  );
  console.log(`Targets: ${targets.length}\n`);

  if (funderState.usdc === null) {
    throw new Error(
      "the oracle holds no USDC trustline — run npm run agents:fund first, or use the SDEX faucet",
    );
  }

  const plan: Array<Target & { needAtomic: bigint; receivable: boolean }> = [];
  for (const target of targets) {
    const state = await readAccount(target.address);
    // No trustline means the payment would be rejected with `op_no_trust`. Report
    // it as an actionable state instead of burning a fee finding out.
    const receivable = state.exists && state.usdc !== null;
    const heldAtomic = parseUsdcAtomic((state.usdc ?? 0).toFixed(7));
    const needAtomic = heldAtomic >= target.targetAtomic ? 0n : target.targetAtomic - heldAtomic;
    plan.push({ ...target, needAtomic, receivable });
  }

  const total = plan.reduce((sum, item) => sum + (item.receivable ? item.needAtomic : 0n), 0n);
  console.log(`Distribution total: ${formatAtomicUsdc(total)} USDC`);

  if (DRY_RUN) {
    for (const item of plan) {
      const note = !item.receivable
        ? "NOT RECEIVABLE (no account or no USDC trustline)"
        : item.needAtomic === 0n
          ? "already at target"
          : `+${formatAtomicUsdc(item.needAtomic)} USDC`;
      console.log(`  ${item.label.padEnd(28)} ${item.address}  ${note}`);
    }
    console.log("\nDry run only; no transfers sent.");
    return;
  }

  const funderAtomic = parseUsdcAtomic(funderState.usdc.toFixed(7));
  if (total > funderAtomic) {
    throw new Error(
      `not enough: need ${formatAtomicUsdc(total)} USDC but the oracle holds ` +
        `${formatAtomicUsdc(funderAtomic)}. Lower the targets or run npm run stellar:usdc.`,
    );
  }

  for (const item of plan) {
    if (!item.receivable) {
      console.log(`  ✗ ${item.label.padEnd(28)} no USDC trustline — run npm run agents:fund`);
      continue;
    }
    if (item.needAtomic === 0n) {
      console.log(`  · ${item.label.padEnd(28)} USDC ok`);
      continue;
    }
    const hash = await transferUsdc({
      wallet: funder,
      to: item.address,
      amountUsdc: formatAtomicUsdc(item.needAtomic),
    });
    console.log(
      `  ✓ ${item.label.padEnd(28)} +${formatAtomicUsdc(item.needAtomic)} USDC  ${explorerTxUrl(hash)}`,
    );
  }

  console.log("\nDone. Run: npm run agents:balances");
}

main().catch((error) => {
  console.error("fund-from-oracle failed:", error instanceof Error ? error.message : error);
  const extras = (error as { response?: { data?: unknown } })?.response?.data;
  if (extras) console.error(JSON.stringify(extras, null, 2));
  process.exit(1);
});
