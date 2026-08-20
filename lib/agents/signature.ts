import { isStellarAccount, verifyStellarSignedMessage } from "@/lib/stellar-message";
import { isContractAddress } from "@/lib/stellar";

/**
 * How a `C…` contract account's signature is checked.
 *
 * Ed25519 verification is local and needs no injection, but a Soroban custom
 * account defines its own `__check_auth`, so proving one signed requires a
 * simulated invocation against the network. That is the only remaining reason
 * this function takes a verifier: it is the seam the contract-account path is
 * built on, and the seam the tests substitute.
 *
 * This replaces the EVM-era `MessageVerifier`, whose single `verifyMessage` call
 * covered both plain keys and ERC-1271 smart wallets. The Stellar analogue of
 * ERC-1271 is a custom account contract; until Mimir accepts one, the default
 * verifier refuses.
 */
export interface ContractAccountVerifier {
  verifyMessage(args: { address: string; message: string; signature: string }): Promise<boolean>;
}

/**
 * Default: refuse contract-account signatures rather than guess.
 *
 * Failing closed matters more than breadth here. Accepting a `C…` signature we
 * cannot actually check would let anyone who can POST claim to be a contract
 * account, and the registry's whole premise is that a wallet proved control.
 */
const REFUSE_CONTRACT_ACCOUNTS: ContractAccountVerifier = {
  verifyMessage: async () => false,
};

/**
 * Verify an owner/operator signature over a message.
 *
 * Dispatches on the ADDRESS FORM, which on Stellar is a real distinction rather
 * than a migration artefact:
 *
 *  - **`G…` strkey** — an account signing through SEP-43 `signMessage`. Ed25519,
 *    base64 signature, verified locally against the public key. This is the path
 *    every browser wallet and every Mimir worker agent takes.
 *  - **`C…` strkey** — a contract account, whose `__check_auth` decides. Needs a
 *    network round trip, so it goes through the injected verifier and is refused
 *    by default.
 *
 * Ed25519 has no signature recovery: the public key is an INPUT, not an output.
 * That is fine because every call site already knows which address it expects,
 * and it removes the "recovered some other address" branch the EVM path had.
 *
 * Anything that is neither shape is rejected without a network call.
 */
export async function verifyAgentSignature(
  args: { address: string; message: string; signature: string },
  verifier: ContractAccountVerifier = REFUSE_CONTRACT_ACCOUNTS,
): Promise<boolean> {
  const address = args.address?.trim();
  const signature = args.signature?.trim();
  if (!address || !signature) return false;

  if (isStellarAccount(address)) {
    return verifyStellarSignedMessage({ address, message: args.message, signature });
  }

  if (!isContractAddress(address)) return false;
  try {
    return await verifier.verifyMessage({ address, message: args.message, signature });
  } catch {
    return false;
  }
}
