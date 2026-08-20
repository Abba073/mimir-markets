import { createBasePublicClient } from "@/lib/base";
import { isStellarAccount, verifyStellarSignedMessage } from "@/lib/stellar-message";

export interface MessageVerifier {
  verifyMessage(args: { address: `0x${string}`; message: string; signature: `0x${string}` }): Promise<boolean>;
}

/**
 * Verify an owner/operator signature over a message.
 *
 * Dispatches on the ADDRESS FORM, because the two identity systems overlap during
 * the migration and nothing else distinguishes them:
 *
 *  - **`G…` strkey** — a Stellar account signing through SEP-43 `signMessage`.
 *    Ed25519, base64 signature, verified locally against the public key. This is
 *    the path every browser-connected user now takes.
 *  - **`0x…`** — the EVM path, still live for the agent runtimes under `agents/**`
 *    and the copy-permission records they signed. Universal EOA/ERC-1271
 *    verification, and it fails closed for hostile wallet code. Ported in the
 *    agent-wallets phase; kept here until then so an existing agent's credentials
 *    do not stop working the day the browser switches.
 *
 * Anything that is neither shape is rejected without a network call.
 */
export async function verifyAgentSignature(
  args: { address: string; message: string; signature: string },
  verifier: MessageVerifier = createBasePublicClient(),
): Promise<boolean> {
  const address = args.address?.trim();
  const signature = args.signature?.trim();
  if (!address || !signature) return false;

  if (isStellarAccount(address)) {
    return verifyStellarSignedMessage({ address, message: args.message, signature });
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !/^0x[0-9a-fA-F]+$/.test(signature)) return false;
  try {
    return await verifier.verifyMessage({
      address: address as `0x${string}`,
      message: args.message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}
