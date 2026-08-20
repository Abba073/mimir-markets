/**
 * Fan real activity across many wallets: create wallets, give them a float, open
 * markets from live sources, and place the smallest stake the contract allows on
 * every claim each wallet has not already taken a side in.
 *
 *   DRY_RUN=1 npx tsx --env-file-if-exists=.env.local scripts/seed-traction.ts
 *   npx tsx --env-file-if-exists=.env.local scripts/seed-traction.ts
 *   ... scripts/seed-traction.ts --wallets 40 --markets 10
 *   ... scripts/seed-traction.ts --bet-only        (skip provisioning and creation)
 *
 * ── The ceilings, and which one survived the move to Stellar ─────────────────
 *
 * MIN_STAKE is 2 USDC in the contract, so "small" still bottoms out there. That
 * ceiling is unchanged.
 *
 * The other one is gone. On the EVM chain USDC was Circle's, could only be
 * RECEIVED, and total concurrent bets were therefore capped at (USDC we hold) / 2
 * no matter how many wallets existed — while gas was a separate scarce budget that
 * had to be rationed from a funder. On Stellar Testnet both constraints dissolve:
 * Friendbot creates each wallet with 10,000 XLM for free, and the SDEX carries
 * genuine XLM/USDC liquidity against Circle's issuer, so a wallet converts its own
 * XLM into REAL `USDC:GBBD47…` — the same asset the contract escrows — with one
 * `pathPaymentStrictReceive`. Provisioning is per-wallet and self-serve; there is
 * no funder to drain and no float to apportion.
 *
 * What replaces the ceiling is SDEX depth: forty wallets each buying six USDC does
 * move the book, so `provisionAccount` quotes before it buys and the per-wallet
 * target is kept small on purpose.
 *
 * Staked USDC is still not spent, only locked: settlement returns it to whichever
 * side won, so capacity comes back as markets resolve.
 *
 * Wallet seeds are appended to traction-wallets.env (gitignored) and reused on the
 * next run. That file IS the money: a fresh set of wallets each run would strand
 * the float in accounts nothing can sign for.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";

import { Keypair } from "@stellar/stellar-sdk";

import { fetchLaunchEvents, fetchWeatherEvents } from "../agents/market-creator/sources";
import { COUNCIL_PERSONAS, personaSecretEnv } from "../agents/council/personas";
import { PHILOSOPHER_PERSONAS, philosopherSecretEnv } from "../agents/council/philosophers";
import { challengeClaim, createClaim, getOpenClaimSummaries } from "../lib/contract";
import {
  loadAgentWallet,
  readAgentBalances,
  walletFromKeypair,
  type AgentWallet,
} from "../lib/agent-wallets";
import {
  getExplorerContractUrl,
  isAccountAddress,
  isContractAddress,
  requireMarketContractId,
} from "../lib/stellar";
import { MIN_STAKE_USDC } from "../lib/usdc";
import { envValue } from "./lib/stellar-env";
import { provisionAccount, readAccount } from "./lib/stellar-funding";

const WALLET_FILE = "traction-wallets.env";

/** The contract's floor. Nothing here can go lower. */
const BET_USDC = MIN_STAKE_USDC;
/** Bets each wallet is provisioned for. */
const BETS_PER_WALLET = 3;
/**
 * Seconds of margin over the contract's 60s challenge lock. Generous because a
 * stake submitted close to the line is rejected with `ChallengeWindowClosed`, and
 * a wasted fee is cheaper to avoid than to explain.
 */
const DEADLINE_MARGIN_SECS = 180;

const DRY = process.env.DRY_RUN === "1";
const argv = process.argv.slice(2);
const flag = (name: string, fallback: number): number => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] ? Number(argv[at + 1]) : fallback;
};
const WANT_WALLETS = flag("wallets", 40);
const WANT_MARKETS = flag("markets", 10);
const BET_ONLY = argv.includes("--bet-only");

/* ── Wallets ──────────────────────────────────────────────────────────────── */

interface Traction {
  index: number;
  keypair: Keypair;
}

function readWallets(): Traction[] {
  if (!existsSync(WALLET_FILE)) return [];
  return readFileSync(WALLET_FILE, "utf8")
    .split(/\r?\n/)
    .map((line) => line.match(/^TRACTION_(\d+)_SECRET=(S[A-Z2-7]{55})/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ index: Number(m[1]), keypair: Keypair.fromSecret(m[2]) }));
}

function ensureWallets(target: number): Traction[] {
  const existing = readWallets();
  if (existing.length >= target) {
    console.log(`${existing.length} traction wallets on file; none created.`);
    return existing;
  }
  const wallets = [...existing];
  const lines: string[] = [];
  for (let i = existing.length; i < target; i++) {
    const keypair = Keypair.random();
    wallets.push({ index: i, keypair });
    lines.push(`TRACTION_${i}_SECRET=${keypair.secret()}`);
  }
  if (DRY) {
    console.log(`would create ${lines.length} wallets (dry run, nothing written)`);
    return wallets;
  }
  // Append, never rewrite: truncating this file loses the seeds to whatever float
  // the older wallets are holding.
  appendFileSync(
    WALLET_FILE,
    (existing.length === 0 ? "# Mimir traction wallets — Stellar seeds only, gitignored.\n" : "") +
      lines.join("\n") +
      "\n",
    "utf8",
  );
  console.log(`created ${lines.length} wallets → ${WALLET_FILE} (now ${wallets.length})`);
  return wallets;
}

/* ── Provisioning ─────────────────────────────────────────────────────────── */

/** Existing agent wallets, which bet alongside the traction wallets. */
function agentBettors(): { label: string; wallet: AgentWallet }[] {
  const envs: { label: string; env: string }[] = [
    { label: "market-creator", env: "CREATOR_SECRET" },
    ...COUNCIL_PERSONAS.map((p) => ({ label: `council:${p.slug}`, env: personaSecretEnv(p) })),
    ...PHILOSOPHER_PERSONAS.map((p) => ({
      label: `philosopher:${p.slug}`,
      env: philosopherSecretEnv(p.slug),
    })),
  ];
  const out: { label: string; wallet: AgentWallet }[] = [];
  for (const { label, env } of envs) {
    if (!envValue(env)) continue;
    try {
      out.push({ label, wallet: loadAgentWallet(env) });
    } catch {
      // A malformed seed is one bettor's problem, not the run's.
    }
  }
  return out;
}

async function provisionWallets(wallets: Traction[]): Promise<void> {
  const target = BET_USDC * BETS_PER_WALLET;
  console.log(`\nProvisioning: ${wallets.length} wallets to ${target} USDC each`);
  console.log(`  XLM comes from Friendbot; USDC from each wallet's own XLM on the SDEX.`);

  if (DRY) {
    for (const w of wallets) {
      const state = await readAccount(w.keypair.publicKey());
      console.log(
        `  traction-${w.index}  ${state.exists ? `${state.xlm.toFixed(2)} XLM` : "does not exist"} · ` +
          `${state.usdc === null ? "no trustline" : `${state.usdc.toFixed(4)} USDC`} → ${target} USDC`,
      );
    }
    return;
  }

  let failed = 0;
  for (const w of wallets) {
    try {
      await provisionAccount({
        label: `traction-${w.index}`,
        keypair: w.keypair,
        targetUsdc: target,
        // A wallet with one bet left in it is still useful, so only top up when it
        // can no longer place a single stake. Fewer SDEX round trips, less impact
        // on the book.
        topUpBelow: 1 / BETS_PER_WALLET,
        log: () => process.stdout.write("."),
      });
    } catch (error) {
      failed += 1;
      console.warn(
        `\n  traction-${w.index}: ${error instanceof Error ? error.message.split("\n")[0] : error}`,
      );
    }
  }
  console.log(failed === 0 ? " done" : ` done (${failed} failed)`);
}

/* ── Markets ──────────────────────────────────────────────────────────────── */

interface Draft {
  question: string;
  creatorPosition: string;
  counterPosition: string;
  resolutionUrl: string;
  category: string;
  marketType: string;
  settlementRule: string;
  deadline: number;
}

/**
 * Claims built from the same live sources the market-creator uses, without the
 * LLM in the way: the threshold is derived from the forecast itself, so the
 * question is genuinely close rather than decorative.
 */
async function draftMarkets(count: number): Promise<Draft[]> {
  const drafts: Draft[] = [];
  const now = Date.now();

  try {
    const { events } = await fetchWeatherEvents();
    for (const event of events) {
      // Round to the nearest degree: a threshold sitting exactly on the forecast
      // is the coin-flip, which is the only interesting version of this market.
      const line = Math.round(event.forecastHighC);
      const deadline = Math.floor(new Date(`${event.targetDate}T23:00:00Z`).getTime() / 1000);
      if (deadline * 1000 < now + 3 * 3600_000) continue;
      drafts.push({
        question: `Will the daily high in ${event.city} reach ${line}°C or more on ${event.targetDate}?`,
        creatorPosition: `Yes — ${event.city} hits ${line}°C or higher`,
        counterPosition: `No — it stays below ${line}°C`,
        resolutionUrl: event.resolutionUrl,
        category: "weather",
        marketType: "threshold",
        settlementRule: `Resolve YES if daily temperature_2m_max for ${event.targetDate} at the given coordinates is >= ${line}. Source: Open-Meteo.`,
        deadline,
      });
    }
  } catch (err) {
    console.warn("weather source unavailable:", err instanceof Error ? err.message : err);
  }

  try {
    const { events } = await fetchLaunchEvents();
    for (const event of events) {
      // Deadline at the window, not after it: the trade is whether it goes on time.
      const deadline = Math.floor(event.windowStartMs / 1000);
      if (event.windowStartMs < now + 6 * 3600_000) continue;
      drafts.push({
        question: `Will ${event.name} still be scheduled to launch by ${new Date(event.windowStartMs).toISOString().slice(0, 16)}Z?`,
        creatorPosition: "Yes — the window holds",
        counterPosition: "No — it slips past the window",
        resolutionUrl: event.resolutionUrl,
        category: "space",
        marketType: "binary",
        settlementRule: `Resolve YES if the launch record still shows a window start at or before the deadline. Source: Launch Library 2 record ${event.id}.`,
        deadline,
      });
    }
  } catch (err) {
    console.warn("launch source unavailable:", err instanceof Error ? err.message : err);
  }

  return drafts.slice(0, count);
}

async function createMarkets(count: number): Promise<void> {
  if (count <= 0) return;
  const creator = loadAgentWallet("CREATOR_SECRET");
  const configuredRecipient = envValue("PLATFORM_FEE_RECIPIENT");
  const feeRecipient =
    configuredRecipient && (isAccountAddress(configuredRecipient) || isContractAddress(configuredRecipient))
      ? configuredRecipient
      : creator.address;
  const drafts = await draftMarkets(count);

  const balances = await readAgentBalances(creator.address);
  const budget = balances.usdc ?? 0;
  const affordable = Math.min(drafts.length, Math.floor(budget / BET_USDC));
  console.log(
    `\nMarkets: ${drafts.length} drafted from live sources, creator can fund ${affordable} ` +
      `(${budget.toFixed(4)} USDC on hand).`,
  );

  for (const draft of drafts.slice(0, affordable)) {
    if (DRY) {
      console.log(`  would open: ${draft.question}`);
      continue;
    }
    try {
      const result = await createClaim(creator.signer, {
        question:              draft.question,
        creator_position:      draft.creatorPosition,
        counter_position:      draft.counterPosition,
        resolution_url:        draft.resolutionUrl,
        deadline:              draft.deadline,
        stake_amount:          BET_USDC,
        category:              draft.category,
        market_type:           draft.marketType,
        odds_mode:             "pool",
        settlement_rule:       draft.settlementRule,
        max_challengers:       100,
        visibility:            "public",
        agent_owner_recipient: feeRecipient,
      });
      console.log(`  opened #${result.claimId}: ${draft.question.slice(0, 56)}…`);
    } catch (err) {
      console.warn(
        `  failed: ${draft.question.slice(0, 48)} — ${err instanceof Error ? err.message.split("\n")[0] : err}`,
      );
    }
  }
}

/* ── Betting ──────────────────────────────────────────────────────────────── */

interface Bettable {
  id: number;
  creator: string;
  question: string;
  freeSlots: number;
  /** Who is already in, so a duplicate stake is not attempted. */
  challengers: Set<string>;
}

/**
 * Joinable claims, from one pass of the contract's own reader.
 *
 * `getOpenClaimSummaries` already filters to open/active public markets and each
 * claim arrives with its full challenger roster, so the EVM version's three reads
 * per claim (`getClaim`, `getClaimMarketConfig`, then `hasChallenged` per bettor)
 * collapse into one. That matters against a rate-limited public RPC.
 */
async function bettableClaims(): Promise<Bettable[]> {
  const now = Math.floor(Date.now() / 1000);
  const claims = await getOpenClaimSummaries();
  return claims
    .filter((claim) => claim.deadline > now + DEADLINE_MARGIN_SECS)
    .filter((claim) => claim.max_challengers === 0 || claim.challenger_count < claim.max_challengers)
    .map((claim) => ({
      id: claim.id,
      creator: claim.creator,
      question: claim.question,
      freeSlots:
        claim.max_challengers === 0
          ? Number.MAX_SAFE_INTEGER
          : claim.max_challengers - claim.challenger_count,
      challengers: new Set(claim.challenger_addresses ?? []),
    }));
}

async function placeBets(wallets: Traction[]): Promise<void> {
  const claims = await bettableClaims();
  console.log(`\nBetting: ${claims.length} bettable claims.`);
  if (claims.length === 0) {
    console.log("Nothing open far enough from its deadline. Open markets first.");
    return;
  }

  // Existing agent wallets bet too — they hold most of the float, and leaving them
  // idle would cap the run at whatever the new wallets were given.
  const bettors: { label: string; wallet: AgentWallet }[] = [
    ...wallets.map((w) => ({
      label: `traction-${w.index}`,
      wallet: walletFromKeypair(w.keypair),
    })),
    ...agentBettors(),
  ];

  let placed = 0;
  let skipped = 0;
  let failed = 0;

  for (const [seat, bettor] of bettors.entries()) {
    const balances = await readAgentBalances(bettor.wallet.address);
    // No account, no trustline, or under one stake: nothing to do. All three are
    // "cannot bet", and distinguishing them here would only add noise.
    if (!balances.exists || balances.usdc === null || balances.usdc < BET_USDC) {
      skipped++;
      continue;
    }
    let budget = balances.usdc;

    // Start each bettor at a different claim. Walking the same order every time
    // means everyone spends their budget on the lowest ids, which left ten fresh
    // markets at zero challengers while one collected sixty.
    const offset = seat % claims.length;
    const rotated = claims.slice(offset).concat(claims.slice(0, offset));

    for (const claim of rotated) {
      if (budget < BET_USDC) break;
      if (claim.freeSlots <= 0) continue;
      // The contract rejects both of these; checking here saves a wasted fee.
      // EXACT comparison — a `G…` strkey is case-sensitive base32.
      if (claim.creator === bettor.wallet.address) continue;
      if (claim.challengers.has(bettor.wallet.address)) continue;

      if (DRY) {
        console.log(`  would bet ${BET_USDC} ${bettor.label} → #${claim.id}`);
        placed++;
        budget -= BET_USDC;
        claim.freeSlots--;
        claim.challengers.add(bettor.wallet.address);
        continue;
      }
      try {
        await challengeClaim(bettor.wallet.signer, claim.id, BET_USDC);
        placed++;
        budget -= BET_USDC;
        claim.freeSlots--;
        claim.challengers.add(bettor.wallet.address);
        process.stdout.write(".");
      } catch (err) {
        failed++;
        // A Soroban contract error arrives already named through the bindings'
        // `Result` unwrap (see lib/contract.ts), so the message is the diagnosis —
        // no multi-line revert reason to dig a cause out of.
        const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
        // Out of USDC: stop this wallet rather than offering it every remaining
        // claim in turn. The local budget can outrun the real balance, so the
        // chain's refusal is the authority on when a wallet is finished.
        if (/InsufficientBalance|StakeTooSmall|exceeds balance/i.test(message)) break;
        if (/AlreadyChallenged|SelfChallenge|MaxChallengers|ChallengeWindowClosed/i.test(message)) {
          continue;
        }
        console.warn(`\n  ${bettor.label} → #${claim.id}: ${message.slice(0, 110)}`);
      }
    }
  }
  console.log(
    `\n\nplaced ${placed} bets of ${BET_USDC} USDC` +
      `  (${skipped} wallets had nothing to stake, ${failed} calls rejected)`,
  );
}

/* ── Main ─────────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const contractId = requireMarketContractId();
  console.log(`Mimir traction run${DRY ? "  (dry run)" : ""}`);
  console.log(`contract ${contractId}   bet size ${BET_USDC} USDC (contract minimum)\n`);

  const wallets = BET_ONLY ? readWallets() : ensureWallets(WANT_WALLETS);

  if (!BET_ONLY) {
    // Markets before provisioning, deliberately. The creator is also the largest
    // USDC holder, and although each traction wallet now buys its own float, the
    // SDEX round trips are the slow part — opening markets first means there is
    // something to bet into by the time provisioning finishes.
    await createMarkets(WANT_MARKETS);
    await provisionWallets(wallets);
  }
  await placeBets(wallets);

  const holders = [
    ...wallets.map((w) => w.keypair.publicKey()),
    ...agentBettors().map((b) => b.wallet.address),
  ];
  const states = await Promise.all(holders.map((address) => readAgentBalances(address)));
  const usdc = states.reduce((sum, state) => sum + (state.usdc ?? 0), 0);
  console.log(
    `\nFloat still liquid: ${usdc.toFixed(2)} USDC across ${holders.length} wallets ` +
      `(~${Math.floor(usdc / BET_USDC)} more bets before settlements return capital).`,
  );
  console.log(`\n${getExplorerContractUrl(contractId)}`);
}

main().catch((err) => {
  console.error("\nseed-traction failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
