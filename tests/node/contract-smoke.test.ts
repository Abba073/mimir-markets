import assert from "node:assert/strict";
import test from "node:test";

import {
  getVSTotalPot,
  isVSJoinable,
  isVSPrivate,
  mapClaimToVS,
  type ClaimData,
} from "../../lib/contract";

// Real `G…` strkeys. Case matters: `isSameAddress` in lib/contract.ts compares
// exactly, because base32 strkeys are case-sensitive and the EVM
// `toLowerCase()` pairing would corrupt them.
const CREATOR    = "GBMGZBFKUNOS7JWPRPF5IMZR27DCR6BEP6SQVFV2I354UPY35FZTIR2Y";
const CHALLENGER = "GDZCBCIU6EI5FM5UC5IAWRT5ZY76OK4QDX5BEELC5V3NTNGAUIX5X4UH";
const OTHER_1    = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const OTHER_2    = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const OUTSIDER   = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

function makeClaim(overrides: Partial<ClaimData> = {}): ClaimData {
  return {
    id: 4,
    creator: CREATOR,
    question: "Will BTC close above 100k?",
    creator_position: "Yes",
    counter_position: "No",
    resolution_url: "https://example.com/source",
    creator_stake: 5,
    total_challenger_stake: 3,
    reserved_creator_liability: 0,
    available_creator_liability: 5,
    // Far future — isVSJoinable compares against the real clock, so a past
    // deadline silently turns every joinability assertion false.
    deadline: 4_100_000_000,
    state: "active",
    winner_side: "",
    resolution_summary: "",
    confidence: 0,
    category: "crypto",
    parent_id: 0,
    challenger_count: 1,
    market_type: "binary",
    odds_mode: "pool",
    challenger_payout_bps: 0,
    handicap_line: "",
    settlement_rule: "",
    max_challengers: 3,
    created_at: 0,
    visibility: "private",
    is_private: true,
    challengers: [
      {
        address: CHALLENGER,
        stake: 3,
        potential_payout: 8,
      },
    ],
    first_challenger: CHALLENGER,
    challenger_addresses: [CHALLENGER],
    total_pot: 8,
    ...overrides,
  };
}

test("mapClaimToVS keeps compatibility fields for active private claims", () => {
  const vs = mapClaimToVS(makeClaim());

  assert.equal(vs.state, "accepted");
  assert.equal(vs.opponent, CHALLENGER);
  assert.equal(vs.opponent_position, "No");
  assert.equal(vs.stake_amount, 5);
  assert.equal(isVSPrivate(vs), true);
  assert.equal(getVSTotalPot(vs), 8);
});

test("isVSJoinable blocks creator, existing challenger, and full pools", () => {
  const baseVS = mapClaimToVS(makeClaim());

  assert.equal(
    isVSJoinable(baseVS, CREATOR),
    false
  );
  assert.equal(
    isVSJoinable(baseVS, CHALLENGER),
    false
  );
  assert.equal(
    isVSJoinable(baseVS, OUTSIDER),
    true
  );

  const fullVS = mapClaimToVS(
    makeClaim({
      challenger_count: 3,
      max_challengers: 3,
      challenger_addresses: [
        CHALLENGER,
        OTHER_1,
        OTHER_2,
      ],
    })
  );
  assert.equal(
    isVSJoinable(fullVS, OUTSIDER),
    false
  );
});

test("mapClaimToVS preserves fixed-odds winner information", () => {
  const vs = mapClaimToVS(
    makeClaim({
      state: "resolved",
      winner_side: "challengers",
      odds_mode: "fixed",
      challenger_payout_bps: 18000,
    })
  );

  assert.equal(vs.state, "resolved");
  assert.equal(vs.winner, CHALLENGER);
  assert.equal(vs.odds_mode, "fixed");
  assert.equal(vs.challenger_payout_bps, 18000);
});

test("address comparison is exact, so a case-folded strkey is a different party", () => {
  // The EVM version of this file asserted that `getContractAddress()` trimmed a
  // stray carriage return out of a 0x address. That function is gone with
  // lib/base.ts, and env normalisation now lives in lib/stellar.ts (`cleanEnv`).
  //
  // What is worth pinning here instead is the property that replaced it: a Stellar
  // strkey is case-SENSITIVE base32, so `isSameAddress` must not fold case. If it
  // did, a lowercased creator address would pass the "are you the creator?" check
  // and a market's own creator could be admitted as its challenger.
  const vs = mapClaimToVS(makeClaim());

  assert.equal(isVSJoinable(vs, CREATOR), false, "the creator cannot join its own market");
  assert.equal(
    isVSJoinable(vs, CREATOR.toLowerCase()),
    true,
    "a lowercased strkey is a different string, and is treated as a stranger",
  );
});
