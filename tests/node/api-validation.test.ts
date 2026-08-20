import assert from "node:assert/strict";
import test from "node:test";

import { StrKey } from "@stellar/stellar-sdk";

import {
  parseAddressParam,
  parseInviteKey,
  parsePositiveIntegerParam,
} from "../../lib/server/api-validation";

test("parsePositiveIntegerParam accepts positive integer ids", () => {
  assert.equal(parsePositiveIntegerParam("7"), 7);
});

test("parsePositiveIntegerParam rejects missing and invalid ids", () => {
  assert.equal(parsePositiveIntegerParam(undefined), null);
  assert.equal(parsePositiveIntegerParam("0"), null);
  assert.equal(parsePositiveIntegerParam("-1"), null);
  assert.equal(parsePositiveIntegerParam("1.2"), null);
  assert.equal(parsePositiveIntegerParam("abc"), null);
});

// Circle's real Stellar Testnet USDC issuer — a known-good G… strkey, so the
// checksum is genuinely exercised rather than a hand-made string that happens to
// be 56 characters long.
const ACCOUNT = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

test("parseAddressParam accepts a G… account address", () => {
  assert.equal(parseAddressParam(ACCOUNT), ACCOUNT);
});

test("parseAddressParam accepts a C… contract address", () => {
  // A claim's creator or challenger can be a smart-contract account, not only a
  // keypair, so both strkey forms have to pass. Encoded rather than pasted, so
  // the checksum is correct by construction.
  const contract = StrKey.encodeContract(Buffer.alloc(32, 7));
  assert.equal(parseAddressParam(contract), contract);
});

test("parseAddressParam rejects malformed and EVM-shaped addresses", () => {
  assert.equal(parseAddressParam(undefined), null);
  assert.equal(parseAddressParam("not-an-address"), null);
  // The EVM format is not merely unsupported, it must be actively refused: a
  // 0x address reaching a chain read would silently return an empty feed.
  assert.equal(parseAddressParam("0x000000000000000000000000000000000000dEaD"), null);
  // Right shape, wrong checksum.
  assert.equal(parseAddressParam(`${ACCOUNT.slice(0, -1)}A`), null);
});

test("parseAddressParam does not normalise case", () => {
  // Strkeys are case-sensitive base32; lowercasing one invalidates it.
  assert.equal(parseAddressParam(ACCOUNT.toLowerCase()), null);
});

test("parseInviteKey accepts blank and generated-safe invite values", () => {
  assert.equal(parseInviteKey(null), "");
  assert.equal(parseInviteKey(""), "");
  assert.equal(parseInviteKey("abc123XYZ_-"), "abc123XYZ_-");
});

test("parseInviteKey rejects malformed invite values", () => {
  assert.equal(parseInviteKey("bad value"), null);
  assert.equal(parseInviteKey("slash/value"), null);
  assert.equal(parseInviteKey("*"), null);
});
