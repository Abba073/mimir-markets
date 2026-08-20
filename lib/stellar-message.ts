/**
 * Off-chain attestations: signing a plain message with a Stellar wallet, and
 * verifying it on the server.
 *
 * Used by the surfaces where a user authorises a RECORD rather than a transfer —
 * composing a basket, subscribing to one, registering an agent. Nothing here
 * moves money; the point is proving "this wallet asked for this", so the row
 * cannot be forged by anyone who can POST.
 *
 * ── Replaces `verifyMessage` from the EVM client ─────────────────────────────
 *
 * EIP-191 prefixes the message, hashes it with keccak256 and RECOVERS the signer
 * from the signature, so an EVM verifier does not need to be told who signed.
 * Ed25519 has no recovery: the public key is an input, not an output. That is
 * fine here because every call site already knows which address it expects — and
 * it is strictly safer, since there is no "recovered some other address" branch
 * to get wrong.
 *
 * ── The payload ──────────────────────────────────────────────────────────────
 *
 * SEP-43 `signMessage` takes a string and returns a base64 signature. It does not
 * pin a domain-separation prefix, and the wallets differ in what they show the
 * user, but the bytes signed are the UTF-8 bytes of the message as given —
 * confirmed against the installed `@stellar/freighter-api` 6.0.0 (`signMessage`
 * returns the raw signature over the message) and the kit's Freighter module,
 * which only base64-encodes what the extension handed back.
 *
 * So domain separation is done in the message text itself: every message starts
 * with a `Mimir …` line naming what is being authorised. A signature harvested
 * from one surface will not verify against another surface's text.
 *
 * NOT usable with Albedo, whose own message-signing predates SEP-43 and is not
 * compatible; the kit's Albedo module rejects `signMessage` outright. The wallet
 * layer reports that as `canSignMessages: false` rather than failing at submit.
 */

import { Keypair, StrKey } from "@stellar/stellar-sdk";

export interface StellarSignedMessage {
  /** The `G…` account that signed. */
  address: string;
  /** Exactly the string that was handed to the wallet. */
  message: string;
  /** Base64 signature as SEP-43 returns it. */
  signature: string;
}

/** Base64, loose about padding because wallets differ; length is checked below. */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Verify a wallet-signed message. Fails closed on anything malformed.
 *
 * An Ed25519 signature is always 64 bytes. Checking that before calling `verify`
 * keeps a hostile client from feeding megabytes into the crypto path, and turns a
 * whole class of garbage input into a plain `false`.
 */
export function verifyStellarSignedMessage(args: StellarSignedMessage): boolean {
  const address = args.address?.trim();
  const signature = args.signature?.trim();
  if (!address || !signature) return false;
  if (!StrKey.isValidEd25519PublicKey(address)) return false;
  if (!BASE64.test(signature)) return false;

  try {
    const raw = Buffer.from(signature, "base64");
    if (raw.length !== 64) return false;
    return Keypair.fromPublicKey(address).verify(Buffer.from(args.message, "utf8"), raw);
  } catch {
    return false;
  }
}

/**
 * True when a value looks like a Stellar account address.
 *
 * Deliberately NOT tolerant of case: strkeys are case-sensitive base32, so the
 * `toLowerCase()` normalisation the EVM paths used everywhere would turn a valid
 * address into an invalid one. Any call site that used to lowercase an address
 * before comparing or signing has to stop.
 */
export function isStellarAccount(value: string | null | undefined): boolean {
  return Boolean(value) && StrKey.isValidEd25519PublicKey(value!.trim());
}
