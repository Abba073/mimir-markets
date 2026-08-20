/**
 * Derivation of the hidden chat-only signing key that XMTP's protocol requires.
 *
 * These tests never touch a wallet: both inputs to the derivation (the Stellar
 * account and the signature it produced) are fixed strings here, so the whole
 * function is pure and the only thing worth asserting is what the design
 * promises — same inputs give the same identity forever, different inputs never
 * collide, and the key/address/signature it hands to XMTP are well formed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";

import {
  clearXmtpIdentityCache,
  deriveXmtpIdentity,
  deriveXmtpIdentityFromSignature,
  xmtpIdentityDerivationMessage,
  XMTP_IDENTITY_DERIVATION_VERSION,
} from "@/lib/xmtp/identity";

const ACCOUNT_A = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
const ACCOUNT_B = "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX";

/** A plausible base64 SEP-43 signature; the value only has to be constant. */
const SIGNATURE_A =
  "cnFmMOtmzHrfL7pM8QqPqYaLXvYTMBmM1MP5eAKKQnFRc6dRVX0k3vJcaNaSAcbtnFHOoZ4qUPTe0nqvz5nUAg==";
const SIGNATURE_B =
  "ZmFrZS1zaWduYXR1cmUtYnV0LXN0YWJsZS1lbm91Z2gtZm9yLWEtdW5pdC10ZXN0LXR3bw==";

test("derivation message is stable and pins version + account", () => {
  const message = xmtpIdentityDerivationMessage(ACCOUNT_A);
  assert.equal(message, xmtpIdentityDerivationMessage(ACCOUNT_A));
  assert.ok(message.includes(ACCOUNT_A));
  assert.ok(message.includes(XMTP_IDENTITY_DERIVATION_VERSION));
  assert.notEqual(message, xmtpIdentityDerivationMessage(ACCOUNT_B));
});

test("same account + same signature always derives the same identity", () => {
  const first = deriveXmtpIdentityFromSignature(ACCOUNT_A, SIGNATURE_A);
  const second = deriveXmtpIdentityFromSignature(ACCOUNT_A, SIGNATURE_A);

  assert.equal(first.address, second.address);
  assert.deepEqual(first.privateKey, second.privateKey);
});

test("derived address is a well-formed 20-byte hex address", () => {
  const { address } = deriveXmtpIdentityFromSignature(ACCOUNT_A, SIGNATURE_A);
  assert.match(address, /^0x[0-9a-f]{40}$/);
});

test("derived private key is a valid secp256k1 scalar", () => {
  const { privateKey } = deriveXmtpIdentityFromSignature(ACCOUNT_A, SIGNATURE_A);
  assert.equal(privateKey.length, 32);
  assert.ok(secp256k1.utils.isValidPrivateKey(privateKey));
});

test("address is keccak256(pubkey)[12:] of the derived key", () => {
  const { address, privateKey } = deriveXmtpIdentityFromSignature(
    ACCOUNT_A,
    SIGNATURE_A,
  );
  const uncompressed = secp256k1.getPublicKey(privateKey, false);
  const expected = keccak_256(uncompressed.subarray(1)).subarray(-20);
  assert.equal(
    address,
    `0x${Buffer.from(expected).toString("hex")}`,
  );
});

test("a different account or a different signature derives a different identity", () => {
  const base = deriveXmtpIdentityFromSignature(ACCOUNT_A, SIGNATURE_A);
  const otherAccount = deriveXmtpIdentityFromSignature(ACCOUNT_B, SIGNATURE_A);
  const otherSignature = deriveXmtpIdentityFromSignature(ACCOUNT_A, SIGNATURE_B);

  assert.notEqual(base.address, otherAccount.address);
  assert.notEqual(base.address, otherSignature.address);
});

test("signMessage returns a 65-byte signature that recovers to the derived address", async () => {
  const identity = deriveXmtpIdentityFromSignature(ACCOUNT_A, SIGNATURE_A);
  const signature = await identity.signMessage("XMTP : Authenticate to inbox\n…");

  assert.equal(signature.length, 65);
  const v = signature[64];
  assert.ok(v === 27 || v === 28, `unexpected recovery byte ${v}`);

  // Recover exactly the way an EOA signature is checked: over the prefixed
  // digest, then keccak of the recovered public key.
  const digest = keccak_256(
    new Uint8Array([
      ...new TextEncoder().encode(
        `\x19Ethereum Signed Message:\n${
          new TextEncoder().encode("XMTP : Authenticate to inbox\n…").length
        }`,
      ),
      ...new TextEncoder().encode("XMTP : Authenticate to inbox\n…"),
    ]),
  );
  const recovered = secp256k1.Signature.fromCompact(signature.subarray(0, 64))
    .addRecoveryBit(v - 27)
    .recoverPublicKey(digest)
    .toRawBytes(false);
  const recoveredAddress = `0x${Buffer.from(
    keccak_256(recovered.subarray(1)).subarray(-20),
  ).toString("hex")}`;

  assert.equal(recoveredAddress, identity.address);
});

test("signMessage is deterministic for the same message", async () => {
  const identity = deriveXmtpIdentityFromSignature(ACCOUNT_A, SIGNATURE_A);
  const a = await identity.signMessage("hello");
  const b = await identity.signMessage("hello");
  assert.deepEqual(a, b);
});

test("deriveXmtpIdentity asks the wallet once per account and caches the result", async () => {
  clearXmtpIdentityCache();
  let prompts = 0;
  const signMessage = async (message: string) => {
    prompts += 1;
    assert.equal(message, xmtpIdentityDerivationMessage(ACCOUNT_A));
    return SIGNATURE_A;
  };

  const [first, second] = await Promise.all([
    deriveXmtpIdentity(ACCOUNT_A, signMessage),
    deriveXmtpIdentity(ACCOUNT_A, signMessage),
  ]);
  const third = await deriveXmtpIdentity(ACCOUNT_A, signMessage);

  assert.equal(prompts, 1);
  assert.equal(first.address, second.address);
  assert.equal(first.address, third.address);
  assert.equal(
    first.address,
    deriveXmtpIdentityFromSignature(ACCOUNT_A, SIGNATURE_A).address,
  );
});

test("a failed signature is not cached", async () => {
  clearXmtpIdentityCache();
  let attempts = 0;
  const rejecting = async () => {
    attempts += 1;
    throw new Error("User rejected");
  };

  await assert.rejects(() => deriveXmtpIdentity(ACCOUNT_B, rejecting));
  await assert.rejects(() => deriveXmtpIdentity(ACCOUNT_B, rejecting));
  assert.equal(attempts, 2);

  const ok = await deriveXmtpIdentity(ACCOUNT_B, async () => SIGNATURE_B);
  assert.equal(
    ok.address,
    deriveXmtpIdentityFromSignature(ACCOUNT_B, SIGNATURE_B).address,
  );
  clearXmtpIdentityCache();
});

test("an empty signature is rejected rather than derived from", () => {
  assert.throws(() => deriveXmtpIdentityFromSignature(ACCOUNT_A, ""));
  assert.throws(() => deriveXmtpIdentityFromSignature("", SIGNATURE_A));
});
