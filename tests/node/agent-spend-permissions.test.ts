import assert from "node:assert/strict";
import test from "node:test";

import {
  checkPermission, configuredSpender, currentPeriodStart, evaluateSpend,
  parseSpendPermissionGrant, permissionKey, type SpendPermissionRecord,
} from "../../lib/agents/spend-permissions";

/**
 * The USDC contract id every permission must name.
 *
 * Set on `process.env` here rather than passed in, because that is how the module
 * reads it — and it reads it PER CALL (`requiredToken`), not at import time, which
 * is what lets a plain static import work. A module-level capture would have
 * frozen the value before this line ran and rejected every fixture below with
 * `wrong_token`.
 */
const USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
process.env.NEXT_PUBLIC_STELLAR_USDC_SAC_ID = USDC_SAC;

// Real strkeys, never lowercased: base32 strkeys are case-sensitive, and the EVM
// version's `toLowerCase()` normalisation is exactly what these tests now assert
// must NOT happen.
const SPENDER = "GDZCBCIU6EI5FM5UC5IAWRT5ZY76OK4QDX5BEELC5V3NTNGAUIX5X4UH";
const ACCOUNT = "GBMGZBFKUNOS7JWPRPF5IMZR27DCR6BEP6SQVFV2I354UPY35FZTIR2Y";
const OTHER   = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const DAY = 86_400;
const START = 1_800_000_000;
/** 1 USDC in atomic units — 7 decimals on Stellar, not the ERC-20's 6. */
const UNIT = 10_000_000n;
/** Base64, as SEP-43 `signMessage` returns it. */
const SIGNATURE = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODkw";

function permission(overrides: Partial<SpendPermissionRecord> = {}): SpendPermissionRecord {
  const fields = {
    account: ACCOUNT, spender: SPENDER, token: USDC_SAC,
    allowanceAtomic: 5n * UNIT, periodSeconds: 7 * DAY, startAt: START,
    endAt: START + 30 * DAY, salt: "0",
    ...overrides,
  };
  return {
    agentId: "forecaster", extraData: "", signature: SIGNATURE,
    permissionJson: "{}", createdAt: START * 1000,
    ...overrides,
    ...fields,
    // Keyed from the merged fields, so an override actually changes the identity.
    permissionHash: permissionKey(fields),
  };
}

test("the same grant always keys to the same permission", () => {
  const a = permission();
  const b = permission();
  assert.equal(a.permissionHash, b.permissionHash);
  // A wider allowance is a different budget, not the same one re-signed.
  assert.notEqual(permission({ allowanceAtomic: 6n * UNIT }).permissionHash, a.permissionHash);
});

test("periods advance in whole steps from the signed start", () => {
  const p = permission();
  assert.equal(currentPeriodStart(p, START), START);
  assert.equal(currentPeriodStart(p, START + DAY), START, "same period one day in");
  assert.equal(currentPeriodStart(p, START + 7 * DAY), START + 7 * DAY, "second period");
  assert.equal(currentPeriodStart(p, START + 15 * DAY), START + 14 * DAY);
  // Before the start there is no period to spend against.
  assert.equal(currentPeriodStart(p, START - 100), START);
});

test("a permission is refused before it starts, after it expires and once revoked", () => {
  const p = permission();
  assert.equal(checkPermission(p, START + DAY, SPENDER).ok, true);
  const early = checkPermission(p, START - 1, SPENDER);
  assert.equal(early.ok === false && early.reason, "not_started");
  const late = checkPermission(p, START + 30 * DAY, SPENDER);
  assert.equal(late.ok === false && late.reason, "expired");
  const revoked = checkPermission(permission({ revokedAt: START * 1000 }), START + DAY, SPENDER);
  assert.equal(revoked.ok === false && revoked.reason, "revoked");
});

test("a permission naming a different spender or token is refused", () => {
  const other = OTHER;
  const wrongSpender = checkPermission(permission(), START + DAY, other);
  assert.equal(wrongSpender.ok === false && wrongSpender.reason, "wrong_spender");
  // No configured spender at all must fail closed, not match anything.
  const noSpender = checkPermission(permission(), START + DAY, null);
  assert.equal(noSpender.ok === false && noSpender.reason, "wrong_spender");
  const wrongToken = checkPermission(permission({ token: other }), START + DAY, SPENDER);
  assert.equal(wrongToken.ok === false && wrongToken.reason, "wrong_token");
});

test("spend fits, then exhausts, then refreshes in the next period", () => {
  const p = permission();
  const now = START + DAY;
  const first = evaluateSpend({ permission: p, spentThisPeriodAtomic: 0n, amountAtomic: 2_000_000n, nowSeconds: now, spender: SPENDER });
  assert.equal(first.allowed, true);
  assert.equal(first.remainingAtomic, 48_000_000n);

  // 49 of 50 USDC already gone: a 2 USDC stake no longer fits.
  const tight = evaluateSpend({ permission: p, spentThisPeriodAtomic: 49_000_000n, amountAtomic: 2_000_000n, nowSeconds: now, spender: SPENDER });
  assert.equal(tight.allowed, false);
  assert.equal(tight.reason, "allowance_exhausted");
  assert.equal(tight.remainingAtomic, 1_000_000n, "a refusal still reports what is left");

  // The ledger is queried per period, so the next period starts from zero spent.
  const nextPeriod = evaluateSpend({ permission: p, spentThisPeriodAtomic: 0n, amountAtomic: 2_000_000n, nowSeconds: START + 8 * DAY, spender: SPENDER });
  assert.equal(nextPeriod.allowed, true);
  assert.equal(nextPeriod.periodStart, START + 7 * DAY);
});

test("a zero or negative amount is never allowed", () => {
  const p = permission();
  for (const amount of [0n, -1n]) {
    const decision = evaluateSpend({ permission: p, spentThisPeriodAtomic: 0n, amountAtomic: amount, nowSeconds: START + DAY, spender: SPENDER });
    assert.equal(decision.allowed, false, `${amount} must not be allowed`);
  }
});

test("a grant is parsed only when every field is present and sane", () => {
  const good = {
    account: ACCOUNT, spender: SPENDER, token: USDC_SAC,
    allowance: String(5n * UNIT), period: String(7 * DAY),
    start: String(START), end: String(START + 30 * DAY), signature: SIGNATURE,
  };
  const parsed = parseSpendPermissionGrant({ agentId: "forecaster", grant: good, spender: SPENDER, now: START * 1000 });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ok && parsed.record.allowanceAtomic, 5n * UNIT);

  // Each of these must refuse rather than default to something nobody agreed to.
  const cases: Array<[string, Record<string, unknown>]> = [
    ["no signature", { ...good, signature: undefined }],
    ["zero allowance", { ...good, allowance: "0" }],
    ["zero period", { ...good, period: "0" }],
    ["end before start", { ...good, end: String(START - 1) }],
    ["wrong token", { ...good, token: OTHER }],
    ["bad account", { ...good, account: "nope" }],
    // A lowercased strkey is a different, invalid string — never silently the same
    // account.
    ["case-folded account", { ...good, account: ACCOUNT.toLowerCase() }],
    // An allowance is drawn from a `G...` balance; a contract id is not a source.
    ["contract account as source", { ...good, account: USDC_SAC }],
  ];
  for (const [label, grant] of cases) {
    const result = parseSpendPermissionGrant({ agentId: "forecaster", grant, spender: SPENDER, now: START * 1000 });
    assert.equal(result.ok, false, `${label} must be refused`);
  }
});

test("a grant for another deployment's spender is refused", () => {
  const grant = {
    account: ACCOUNT, spender: OTHER,
    token: USDC_SAC, allowance: String(UNIT), period: String(DAY),
    start: String(START), end: String(START + DAY * 2), signature: SIGNATURE,
  };
  const result = parseSpendPermissionGrant({ agentId: "forecaster", grant, spender: SPENDER, now: START * 1000 });
  assert.equal(result.ok, false);
});

test("an unset spender env reads as no spender rather than as a wildcard", () => {
  assert.equal(configuredSpender({}), null);
  assert.equal(configuredSpender({ SPEND_PERMISSION_SPENDER: "not-an-address" }), null);
  // A lowercased strkey is INVALID, not a casing variant to normalise. The EVM
  // version deliberately down-cased checksummed hex here; doing the same to a
  // strkey would yield a spender no signature could ever match.
  assert.equal(configuredSpender({ SPEND_PERMISSION_SPENDER: SPENDER.toLowerCase() }), null);
  // Whitespace and a trailing `# comment` are both real .env hazards.
  assert.equal(configuredSpender({ SPEND_PERMISSION_SPENDER: `  ${SPENDER}  ` }), SPENDER);
  assert.equal(configuredSpender({ SPEND_PERMISSION_SPENDER: `${SPENDER}  # mimir` }), SPENDER);
  // A `C...` contract account is a valid spender: a SAC allowance takes an Address.
  assert.equal(configuredSpender({ SPEND_PERMISSION_SPENDER: USDC_SAC }), USDC_SAC);
});
