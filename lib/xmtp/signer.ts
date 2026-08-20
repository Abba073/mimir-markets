/**
 * XMTP `Signer` built from the locally derived chat key.
 *
 * **Client-only** (`"use client"`): this pulls in `@xmtp/browser-sdk`
 * (WASM + workers) for its types and must never load on the server.
 *
 * ── What changed and why ─────────────────────────────────────────────────────
 *
 * This used to ask an injected browser wallet for a `personal_sign` over every
 * XMTP payload. There is no injected wallet in Mimir anymore — the connected
 * wallet is a Stellar one — so the signer now holds the identity derived in
 * `./identity` and signs locally, in-process, with no confirmation dialog per
 * message. The user is prompted exactly once, by their Stellar wallet, to
 * derive that identity; everything after that is a local signature.
 *
 * The identity is the address-shaped one XMTP's protocol mandates for an inbox
 * (`IdentifierKind.Ethereum`); see `./identity` for why that is a protocol
 * requirement rather than a chain dependency. It signs nothing but XMTP
 * payloads.
 *
 * Signer shape per the official docs:
 * https://docs.xmtp.org/chat-apps/core-messaging/create-a-signer
 */

import {
  IdentifierKind,
  type Identifier,
  type Signer,
} from "@xmtp/browser-sdk";

import {
  deriveXmtpIdentity,
  type XmtpLocalIdentity,
} from "@/lib/xmtp/identity";

export type XmtpSignerErrorCode =
  /** The user declined the derivation signature in their wallet. */
  | "rejected"
  /** The connected wallet cannot sign off-chain messages at all. */
  | "unsupported_wallet"
  | "invalid_address"
  | "unknown";

export class XmtpSignerError extends Error {
  constructor(
    message: string,
    public readonly code: XmtpSignerErrorCode,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "XmtpSignerError";
  }
}

const INBOX_ADDRESS = /^0x[0-9a-f]{40}$/;

/**
 * Turn a wallet-layer failure into something a user can act on.
 *
 * A declined signature is not an error state to retry silently — it is a
 * decision — so it gets its own code, and the UI can offer "try again" without
 * claiming chat is broken.
 */
export function toXmtpSignerError(cause: unknown): XmtpSignerError {
  if (cause instanceof XmtpSignerError) return cause;
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  if (/reject|denied|cancel|declined|closed the modal/i.test(message)) {
    return new XmtpSignerError(
      "Signature declined. Chat needs one signature to create your messaging key.",
      "rejected",
      cause,
    );
  }
  if (/does not support|not supported|unsupported/i.test(message)) {
    return new XmtpSignerError(
      "This wallet cannot sign messages, which chat needs to create your messaging key.",
      "unsupported_wallet",
      cause,
    );
  }
  return new XmtpSignerError(
    message || "Could not create your messaging key.",
    "unknown",
    cause,
  );
}

/**
 * Wrap an already-derived identity as an XMTP EOA signer.
 *
 * Synchronous and side-effect free: everything that could prompt the user
 * already happened during derivation.
 */
export function createXmtpSignerFromIdentity(identity: XmtpLocalIdentity): Signer {
  if (!INBOX_ADDRESS.test(identity.address)) {
    throw new XmtpSignerError(
      "Derived messaging identity is malformed.",
      "invalid_address",
    );
  }

  const identifier: Identifier = {
    identifier: identity.address,
    identifierKind: IdentifierKind.Ethereum,
  };

  return {
    type: "EOA",
    getIdentifier: () => identifier,
    signMessage: (message: string) => identity.signMessage(message),
  };
}

/**
 * The whole path from "a Stellar wallet is connected" to "an XMTP signer":
 * derive the chat identity (one wallet signature, cached per account) and wrap
 * it.
 *
 * @param stellarPublicKey - The connected `G…` strkey.
 * @param signMessage - `useWallet().signMessage`.
 */
export async function createXmtpSignerForStellarAccount(
  stellarPublicKey: string,
  signMessage: (message: string) => Promise<string>,
): Promise<{ signer: Signer; identity: XmtpLocalIdentity }> {
  let identity: XmtpLocalIdentity;
  try {
    identity = await deriveXmtpIdentity(stellarPublicKey, signMessage);
  } catch (cause) {
    throw toXmtpSignerError(cause);
  }
  return { signer: createXmtpSignerFromIdentity(identity), identity };
}
