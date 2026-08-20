/**
 * The market contract's activity feed, read from Soroban events.
 *
 * One decoder shared by `/stats`, `/agents` and `/council`, which each used to
 * hand-roll their own `eth_getLogs` scan with their own inline ABI event
 * definitions. That duplication is what let one of them get its filter wrong (see
 * the note in `app/api/vs/[id]/council/route.ts`) — so the decoding lives here
 * once and the pages consume typed rows.
 *
 * ── What Soroban events can and cannot tell you ──────────────────────────────
 *
 * Soroban RPC retains a ROLLING WINDOW of events — about 120_960 ledgers, roughly
 * a week, on Testnet. It is not an archive. That is a hard property of the RPC, not
 * a tuning knob, and it changes what these pages can honestly claim:
 *
 *   - "all-time first seen" is really "first seen within the retained window", so
 *     {@link readContractActivity} reports `oldestLedger` and callers say so.
 *   - CURRENT STATE must never be derived from this. A claim's state, stakes and
 *     challenger roster come from `get_claim` (`lib/contract.ts`), which is
 *     authoritative and has no retention limit. Events are only for "when did this
 *     happen, and in which transaction".
 *
 * Event shape is verified against the deployed contract rather than inferred from
 * the `#[contractevent]` macro: `topic[0]` is the snake_case event name, `topic[1..]`
 * are the `#[topic]` fields in declaration order, and `value` is a MAP of the
 * remaining fields keyed by their snake_case names.
 *
 *   topics: "claim_created"    | <u64 id> | <G… creator>   value: { category }
 *   topics: "claim_challenged" | <u64 id> | <G… challenger> value: { stake }
 *   topics: "claim_resolved"   | <u64 id>                   value: { winner_side, summary, confidence, evidence_hash }
 */

import { scValToNative, type rpc } from "@stellar/stellar-sdk";

import {
  getContractEvents,
  isMarketConfigured,
  requireMarketContractId,
} from "@/lib/stellar";
import { unitsToUsdc } from "@/lib/usdc";

export type ActivityKind = "created" | "challenged" | "resolved";

export interface ActivityRow {
  kind: ActivityKind;
  claimId: number;
  /** `G…` account that acted. Empty for `resolved`, which has no actor topic. */
  actor: string;
  /** Display USDC staked. Only meaningful for `challenged`. */
  stakeUsdc: number;
  txHash: string;
  ledger: number;
  /** Unix seconds — the ledger close time. */
  at: number;
  /** Present on `created`. */
  category?: string;
  /** Present on `resolved`: 1 creator, 2 challengers, 3 draw, 4 unresolvable. */
  winnerSide?: number;
  /** Present on `resolved` — the oracle's verdict confidence, 0-100. */
  confidence?: number;
  /** Present on `resolved` — the oracle's one-paragraph reasoning, truncated. */
  summary?: string;
}

export interface ActivityScan {
  rows: ActivityRow[];
  /**
   * Oldest ledger the RPC still retains. Anything before this is invisible here —
   * surface it rather than letting a page imply it has full history.
   */
  oldestLedger: number;
  latestLedger: number;
  /** True when the page budget stopped the walk before the chain tip. */
  truncated: boolean;
}

const EMPTY: ActivityScan = { rows: [], oldestLedger: 0, latestLedger: 0, truncated: false };

function native(value: rpc.Api.EventResponse["topic"][number]): unknown {
  try {
    return scValToNative(value);
  } catch {
    return null;
  }
}

function asNumber(value: unknown): number | null {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

/**
 * Read the contract's `claim_created` / `claim_challenged` / `claim_resolved`
 * events, newest first.
 *
 * Never throws: an activity feed is a display surface, and a rate-limited RPC must
 * degrade to an empty list rather than 500 the page.
 */
export async function readContractActivity(
  opts: { maxPages?: number } = {},
): Promise<ActivityScan> {
  if (!isMarketConfigured()) return EMPTY;

  let scan;
  try {
    scan = await getContractEvents(requireMarketContractId(), {
      maxPages: opts.maxPages ?? 20,
    });
  } catch (err) {
    console.warn(
      "[contract-activity] event scan failed:",
      err instanceof Error ? err.message : err,
    );
    return EMPTY;
  }

  const rows: ActivityRow[] = [];
  for (const event of scan.events) {
    const topics = event.topic ?? [];
    if (topics.length < 2) continue;

    const name = String(native(topics[0]) ?? "");
    const claimId = asNumber(native(topics[1]));
    if (claimId === null) continue;

    let fields: Record<string, unknown> = {};
    try {
      const decoded = scValToNative(event.value);
      if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
        fields = decoded as Record<string, unknown>;
      }
    } catch {
      // A field this feed does not read may fail to decode; the topics still
      // identify the event, which is enough for a timeline entry.
    }

    const base = {
      claimId,
      txHash: event.txHash ?? "",
      ledger: Number(event.ledger ?? 0),
      at: Math.floor(new Date(event.ledgerClosedAt ?? 0).getTime() / 1000),
    };

    if (name === "claim_created") {
      rows.push({
        ...base,
        kind: "created",
        actor: String(native(topics[2]) ?? ""),
        stakeUsdc: 0,
        category: typeof fields.category === "string" ? fields.category : undefined,
      });
    } else if (name === "claim_challenged") {
      const stake = asNumber(fields.stake);
      rows.push({
        ...base,
        kind: "challenged",
        actor: String(native(topics[2]) ?? ""),
        // `stake` is atomic i128 on the wire; display USDC is what a page shows.
        stakeUsdc: stake === null ? 0 : unitsToUsdc(BigInt(stake)),
      });
    } else if (name === "claim_resolved") {
      rows.push({
        ...base,
        kind: "resolved",
        // `claim_resolved` carries no actor topic — the oracle is the only account
        // that can call `resolve_claim`, so the actor is implied rather than logged.
        actor: "",
        stakeUsdc: 0,
        // A Soroban unit-variant enum decodes to its u32 discriminant, so this is a
        // number: 1 creator, 2 challengers, 3 draw, 4 unresolvable. Verified against
        // the deployed contract (`"winner_side":2` on the smoke-test settlement).
        winnerSide: asNumber(fields.winner_side) ?? undefined,
        confidence: asNumber(fields.confidence) ?? undefined,
        // Truncated here rather than at each call site: this is a feed entry, and an
        // unbounded contract String has no business sizing a React tree.
        summary: typeof fields.summary === "string" ? fields.summary.slice(0, 180) : undefined,
      });
    }
  }

  rows.sort((a, b) => b.ledger - a.ledger);
  return {
    rows,
    oldestLedger: scan.oldestLedger,
    latestLedger: scan.latestLedger,
    truncated: scan.truncated,
  };
}
