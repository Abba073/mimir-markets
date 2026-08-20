import assert from "node:assert/strict";
import test from "node:test";

import type { ClaimData } from "../../lib/contract";

// This suite exercises the read-index against a real Postgres instance.
// Skip when DATABASE_URL is missing (e.g. local smoke runs without NeonDB)
// so the test:smoke script stays fast.
const HAS_DB = Boolean(process.env.DATABASE_URL?.trim());
const describeDb = HAS_DB ? test : test.skip;

/**
 * Real Stellar strkeys, with their mixed case intact.
 *
 * The EVM addresses these fixtures used to carry made the round-trip assertions
 * below vacuous: an all-lowercase hex string survives `toLowerCase()` unchanged,
 * so `assert.equal(stored.creator, claim.creator)` passed while the index was
 * silently corrupting every real address. A strkey has upper and lower case in it,
 * so the same assertion now actually tests something.
 */
const CREATOR = "GBO43ZBS4RBC2QFDKB23U6TBFEEK47ZLGSXDJSRV2H3PNQK5ZDEYXVLE";
const CHALLENGER = "GD2SI5PUEFKC7TONNX7OR72WMYUO7WZDSCDSIVWWXPDIDYW5OP3ETM5D";

function makeClaim(overrides: Partial<ClaimData> = {}): ClaimData {
  return {
    id: 101,
    creator: CREATOR,
    question: "Will the private claim stay private?",
    creator_position: "Yes",
    counter_position: "No",
    resolution_url: "https://example.com/private-source",
    creator_stake: 7,
    total_challenger_stake: 4,
    reserved_creator_liability: 2,
    available_creator_liability: 5,
    deadline: 1_800_000_000,
    state: "active",
    winner_side: "",
    resolution_summary: "Hidden summary",
    confidence: 88,
    category: "crypto",
    parent_id: 0,
    challenger_count: 1,
    market_type: "binary",
    odds_mode: "fixed",
    challenger_payout_bps: 15000,
    handicap_line: "BTC >= 100k",
    settlement_rule: "Use the linked source at deadline",
    max_challengers: 2,
    created_at: 0,
    visibility: "private",
    is_private: true,
    challengers: [
      {
        address: CHALLENGER,
        stake: 4,
        potential_payout: 6,
      },
    ],
    first_challenger: CHALLENGER,
    challenger_addresses: [CHALLENGER],
    total_pot: 11,
    ...overrides,
  };
}

describeDb("upsertClaim scrubs private content before storage", async () => {
  const db = await import("../../lib/db");
  const claim = makeClaim();

  await db.upsertClaim(claim);
  await db.upsertChallengers(claim.id, claim.challengers ?? []);

  const stored = await db.getClaimById(claim.id);
  assert.ok(stored);
  assert.equal(stored.visibility, "private");
  assert.equal(stored.question, null);
  assert.equal(stored.creator_position, null);
  assert.equal(stored.counter_position, null);
  assert.equal(stored.resolution_url, null);
  assert.equal(stored.resolution_summary, null);
  assert.equal(stored.handicap_line, null);
  assert.equal(stored.settlement_rule, null);
  assert.equal(stored.creator, claim.creator);
  assert.equal(stored.state, claim.state);
  assert.equal(stored.total_pot, claim.total_pot);

  const challengers = await db.getChallengersByClaimId(claim.id);
  assert.deepEqual(challengers, [
    {
      claim_id: claim.id,
      address: CHALLENGER,
      stake: 4,
      potential_payout: 6,
    },
  ]);

  const claimIdsByChallenger = await db.getClaimsByChallenger(
    CHALLENGER
  );
  assert.deepEqual(claimIdsByChallenger, [claim.id]);
});

describeDb("sync_meta persists seeded and updated values", async () => {
  const db = await import("../../lib/db");

  assert.equal(await db.getSyncMeta("last_claim_count"), "0");
  assert.equal(await db.getSyncMeta("last_sync_at"), "0");

  await db.setSyncMeta("last_sync_at", "123456");
  assert.equal(await db.getSyncMeta("last_sync_at"), "123456");
});
