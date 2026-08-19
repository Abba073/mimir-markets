import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CDV6JXIJCALSXQELCS6YUEWJWG5DFXQK5PJ5I7MWI6KVMQJBC5DLPKZI",
  }
} as const


export interface Claim {
  category: string;
  /**
 * How many challengers have pulled their settlement. The last one absorbs
 * whatever `remaining_escrow` is left, so truncation dust is never stranded.
 */
challenger_claims: u32;
  challenger_count: u32;
  confidence: u32;
  context_hash: Buffer;
  counter_position: string;
  created_at: u64;
  creator: string;
  creator_position: string;
  creator_stake: i128;
  deadline: u64;
  evidence_hash: Option<Buffer>;
  fees: FeeSnapshot;
  market: MarketConfig;
  parent_id: u64;
  question: string;
  /**
 * Escrow still owed to challengers after resolution. Seeded by
 * `resolve_claim` and drawn down by each `claim_challenger_payout`, so the
 * contract can never pay out more than it took in.
 */
remaining_escrow: i128;
  reserved_creator_liability: i128;
  resolution_summary: string;
  resolution_url: string;
  state: ClaimState;
  total_challenger_stake: i128;
  winner_side: WinnerSide;
}

export const Errors = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"NotOwner"},
  4: {message:"NotOracle"},
  5: {message:"FeeCapExceeded"},
  6: {message:"FeeNeedsRecipient"},
  7: {message:"NothingQueued"},
  8: {message:"Timelocked"},
  9: {message:"StakeTooSmall"},
  10: {message:"DeadlineInPast"},
  11: {message:"EmptyQuestion"},
  12: {message:"ClaimNotFound"},
  13: {message:"ClaimNotOpen"},
  14: {message:"SelfChallenge"},
  15: {message:"AlreadyChallenged"},
  16: {message:"ClaimFull"},
  17: {message:"ChallengeWindowClosed"},
  18: {message:"InvalidInviteKey"},
  19: {message:"DuelNeedsEqualStake"},
  20: {message:"InsufficientCreatorLiquidity"},
  21: {message:"ClaimNotActive"},
  22: {message:"NotYetExpired"},
  23: {message:"InvalidVerdict"},
  24: {message:"NotCreator"},
  25: {message:"NothingToWithdraw"},
  26: {message:"NoFees"},
  27: {message:"PayoutExceedsEscrow"},
  28: {message:"UnsupportedToken"},
  29: {message:"Overflow"},
  30: {message:"InviteKeyTooLong"},
  31: {message:"ZeroStake"},
  32: {message:"ClaimNotResolved"},
  33: {message:"NotAChallenger"},
  34: {message:"AlreadyClaimedPayout"},
  35: {message:"ChallengersDidNotWin"}
}


export interface FeePolicy {
  agent_owner_fee_bps: u32;
  platform_fee_bps: u32;
  platform_recipient: Option<string>;
}


export interface Challenger {
  address: string;
  /**
 * Set once this challenger has pulled their settlement. Held on the roster
 * entry rather than in a side map so `get_challenger_list` can report claim
 * status without an extra read per challenger.
 */
claimed: boolean;
  stake: i128;
}

export enum ClaimState {
  Open = 0,
  Active = 1,
  Resolved = 2,
  Cancelled = 3,
}

export enum WinnerSide {
  None = 0,
  Creator = 1,
  Challengers = 2,
  Draw = 3,
  Unresolvable = 4,
}


/**
 * Copied onto each claim at creation and never mutated afterwards.
 */
export interface FeeSnapshot {
  agent_owner_fee_bps: u32;
  agent_owner_recipient: Option<string>;
  platform_fee_bps: u32;
  platform_recipient: Option<string>;
}


/**
 * What a challenger would receive from `claim_challenger_payout`, without
 * performing it.
 */
export interface PayoutQuote {
  claimed: boolean;
  fee: i128;
  gross: i128;
  net: i128;
}


export interface ClaimFeeView {
  agent_owner_fee_bps: u32;
  agent_owner_recipient: Option<string>;
  context_hash: Buffer;
  platform_fee_bps: u32;
  platform_recipient: Option<string>;
}


/**
 * Mirrors `MimirV2.CreateParams`. Grouped into a struct for the same reason the
 * Solidity did: the argument list is otherwise unwieldy.
 */
export interface CreateParams {
  /**
 * `None` when the market is not attributed to an agent.
 */
agent_owner_recipient: Option<string>;
  category: string;
  challenger_payout_bps: u32;
  context_hash: Buffer;
  counter_position: string;
  creator_position: string;
  deadline: u64;
  handicap_line: string;
  invite_key: Option<string>;
  is_private: boolean;
  market_type: string;
  max_challengers: u32;
  odds_mode: string;
  parent_id: u64;
  question: string;
  resolution_url: string;
  settlement_rule: string;
  stake_amount: i128;
}


export interface MarketConfig {
  challenger_payout_bps: u32;
  handicap_line: string;
  invite_key_hash: Option<Buffer>;
  is_private: boolean;
  market_type: string;
  max_challengers: u32;
  odds_mode: string;
  settlement_rule: string;
}


export interface PlatformStats {
  balance: i128;
  fees_accrued: i128;
  fees_claimed: i128;
  resolved: u64;
  total_claims: u64;
}


export interface PendingFeePolicy {
  agent_owner_fee_bps: u32;
  executable_at: u64;
  platform_fee_bps: u32;
  platform_recipient: Option<string>;
}

















export type DataKey = {tag: "Init", values: void} | {tag: "Owner", values: void} | {tag: "Oracle", values: void} | {tag: "Usdc", values: void} | {tag: "Policy", values: void} | {tag: "Pending", values: void} | {tag: "ClaimCount", values: void} | {tag: "TotalResolved", values: void} | {tag: "FeesAccrued", values: void} | {tag: "FeesClaimed", values: void} | {tag: "Claim", values: readonly [u64]} | {tag: "Challengers", values: readonly [u64]} | {tag: "Withdrawable", values: readonly [string]} | {tag: "Accrued", values: readonly [string]};

export interface Client {
  /**
   * Construct and simulate a get_usdc transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_usdc: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Solidity used `msg.sender`; Soroban has no equivalent for a top-level
   * call, so the beneficiary is an explicit argument that must authorize.
   */
  withdraw: ({who}: {who: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a get_claim transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_claim: ({claim_id}: {claim_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Claim>>>

  /**
   * Construct and simulate a get_owner transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_owner: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a claim_fees transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  claim_fees: ({who}: {who: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a get_oracle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_oracle: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Constructor equivalent, callable once.
   */
  initialize: ({owner, oracle, usdc_token, platform_fee_bps, agent_owner_fee_bps, platform_recipient}: {owner: string, oracle: string, usdc_token: string, platform_fee_bps: u32, agent_owner_fee_bps: u32, platform_recipient: Option<string>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_oracle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_oracle: ({new_oracle}: {new_oracle: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a cancel_claim transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  cancel_claim: ({claim_id}: {claim_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_claim transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  create_claim: ({creator, params}: {creator: string, params: CreateParams}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a resolve_claim transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  resolve_claim: ({claim_id, winner_side, summary, confidence, evidence_hash}: {claim_id: u64, winner_side: WinnerSide, summary: string, confidence: u32, evidence_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_claim_fees transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_claim_fees: ({claim_id}: {claim_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<ClaimFeeView>>>

  /**
   * Construct and simulate a get_fee_policy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_fee_policy: (options?: MethodOptions) => Promise<AssembledTransaction<Result<FeePolicy>>>

  /**
   * Construct and simulate a challenge_claim transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  challenge_claim: ({challenger, claim_id, stake_amount, invite_key}: {challenger: string, claim_id: u64, stake_amount: i128, invite_key: Option<string>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_accrued_fees transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_accrued_fees: ({who}: {who: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a get_withdrawable transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_withdrawable: ({who}: {who: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a queue_fee_policy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  queue_fee_policy: ({platform_fee_bps, agent_owner_fee_bps, platform_recipient}: {platform_fee_bps: u32, agent_owner_fee_bps: u32, platform_recipient: Option<string>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a cancel_fee_policy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  cancel_fee_policy: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a execute_fee_policy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Permissionless once the timelock has elapsed.
   */
  execute_fee_policy: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_platform_stats transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_platform_stats: (options?: MethodOptions) => Promise<AssembledTransaction<Result<PlatformStats>>>

  /**
   * Construct and simulate a transfer_ownership transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  transfer_ownership: ({new_owner}: {new_owner: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_challenger_list transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The roster, including each challenger's stake and whether they have
   * already pulled their settlement.
   */
  get_challenger_list: ({claim_id}: {claim_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Array<Challenger>>>

  /**
   * Construct and simulate a get_pending_fee_policy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_pending_fee_policy: (options?: MethodOptions) => Promise<AssembledTransaction<Option<PendingFeePolicy>>>

  /**
   * Construct and simulate a claim_challenger_payout transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Settle one challenger's winning or refunded position. Callable once per
   * challenger after resolution, and O(1) in the number of challengers, so a
   * market filled to MAX_CHALLENGERS can always be paid out in full.
   * 
   * `resolve_claim` deliberately does NOT loop over challengers: a Stellar
   * transaction is capped on its ledger-entry footprint, and paying ~100
   * challengers at once does not fit. Returns the net amount credited.
   */
  claim_challenger_payout: ({challenger, claim_id}: {challenger: string, claim_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a get_claim_market_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_claim_market_config: ({claim_id}: {claim_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<MarketConfig>>>

  /**
   * Construct and simulate a quote_challenger_payout transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * What `claim_challenger_payout` would pay this challenger right now.
   */
  quote_challenger_payout: ({claim_id, challenger}: {claim_id: u64, challenger: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<PayoutQuote>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAQAAAAAAAAAAAAAABUNsYWltAAAAAAAAFwAAAAAAAAAIY2F0ZWdvcnkAAAAQAAAAkkhvdyBtYW55IGNoYWxsZW5nZXJzIGhhdmUgcHVsbGVkIHRoZWlyIHNldHRsZW1lbnQuIFRoZSBsYXN0IG9uZSBhYnNvcmJzCndoYXRldmVyIGByZW1haW5pbmdfZXNjcm93YCBpcyBsZWZ0LCBzbyB0cnVuY2F0aW9uIGR1c3QgaXMgbmV2ZXIgc3RyYW5kZWQuAAAAAAARY2hhbGxlbmdlcl9jbGFpbXMAAAAAAAAEAAAAAAAAABBjaGFsbGVuZ2VyX2NvdW50AAAABAAAAAAAAAAKY29uZmlkZW5jZQAAAAAABAAAAAAAAAAMY29udGV4dF9oYXNoAAAD7gAAACAAAAAAAAAAEGNvdW50ZXJfcG9zaXRpb24AAAAQAAAAAAAAAApjcmVhdGVkX2F0AAAAAAAGAAAAAAAAAAdjcmVhdG9yAAAAABMAAAAAAAAAEGNyZWF0b3JfcG9zaXRpb24AAAAQAAAAAAAAAA1jcmVhdG9yX3N0YWtlAAAAAAAACwAAAAAAAAAIZGVhZGxpbmUAAAAGAAAAAAAAAA1ldmlkZW5jZV9oYXNoAAAAAAAD6AAAA+4AAAAgAAAAAAAAAARmZWVzAAAH0AAAAAtGZWVTbmFwc2hvdAAAAAAAAAAABm1hcmtldAAAAAAH0AAAAAxNYXJrZXRDb25maWcAAAAAAAAACXBhcmVudF9pZAAAAAAAAAYAAAAAAAAACHF1ZXN0aW9uAAAAEAAAALZFc2Nyb3cgc3RpbGwgb3dlZCB0byBjaGFsbGVuZ2VycyBhZnRlciByZXNvbHV0aW9uLiBTZWVkZWQgYnkKYHJlc29sdmVfY2xhaW1gIGFuZCBkcmF3biBkb3duIGJ5IGVhY2ggYGNsYWltX2NoYWxsZW5nZXJfcGF5b3V0YCwgc28gdGhlCmNvbnRyYWN0IGNhbiBuZXZlciBwYXkgb3V0IG1vcmUgdGhhbiBpdCB0b29rIGluLgAAAAAAEHJlbWFpbmluZ19lc2Nyb3cAAAALAAAAAAAAABpyZXNlcnZlZF9jcmVhdG9yX2xpYWJpbGl0eQAAAAAACwAAAAAAAAAScmVzb2x1dGlvbl9zdW1tYXJ5AAAAAAAQAAAAAAAAAA5yZXNvbHV0aW9uX3VybAAAAAAAEAAAAAAAAAAFc3RhdGUAAAAAAAfQAAAACkNsYWltU3RhdGUAAAAAAAAAAAAWdG90YWxfY2hhbGxlbmdlcl9zdGFrZQAAAAAACwAAAAAAAAALd2lubmVyX3NpZGUAAAAH0AAAAApXaW5uZXJTaWRlAAA=",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAIwAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAITm90T3duZXIAAAADAAAAAAAAAAlOb3RPcmFjbGUAAAAAAAAEAAAAAAAAAA5GZWVDYXBFeGNlZWRlZAAAAAAABQAAAAAAAAARRmVlTmVlZHNSZWNpcGllbnQAAAAAAAAGAAAAAAAAAA1Ob3RoaW5nUXVldWVkAAAAAAAABwAAAAAAAAAKVGltZWxvY2tlZAAAAAAACAAAAAAAAAANU3Rha2VUb29TbWFsbAAAAAAAAAkAAAAAAAAADkRlYWRsaW5lSW5QYXN0AAAAAAAKAAAAAAAAAA1FbXB0eVF1ZXN0aW9uAAAAAAAACwAAAAAAAAANQ2xhaW1Ob3RGb3VuZAAAAAAAAAwAAAAAAAAADENsYWltTm90T3BlbgAAAA0AAAAAAAAADVNlbGZDaGFsbGVuZ2UAAAAAAAAOAAAAAAAAABFBbHJlYWR5Q2hhbGxlbmdlZAAAAAAAAA8AAAAAAAAACUNsYWltRnVsbAAAAAAAABAAAAAAAAAAFUNoYWxsZW5nZVdpbmRvd0Nsb3NlZAAAAAAAABEAAAAAAAAAEEludmFsaWRJbnZpdGVLZXkAAAASAAAAAAAAABNEdWVsTmVlZHNFcXVhbFN0YWtlAAAAABMAAAAAAAAAHEluc3VmZmljaWVudENyZWF0b3JMaXF1aWRpdHkAAAAUAAAAAAAAAA5DbGFpbU5vdEFjdGl2ZQAAAAAAFQAAAAAAAAANTm90WWV0RXhwaXJlZAAAAAAAABYAAAAAAAAADkludmFsaWRWZXJkaWN0AAAAAAAXAAAAAAAAAApOb3RDcmVhdG9yAAAAAAAYAAAAAAAAABFOb3RoaW5nVG9XaXRoZHJhdwAAAAAAABkAAAAAAAAABk5vRmVlcwAAAAAAGgAAAAAAAAATUGF5b3V0RXhjZWVkc0VzY3JvdwAAAAAbAAAAAAAAABBVbnN1cHBvcnRlZFRva2VuAAAAHAAAAAAAAAAIT3ZlcmZsb3cAAAAdAAAAAAAAABBJbnZpdGVLZXlUb29Mb25nAAAAHgAAAAAAAAAJWmVyb1N0YWtlAAAAAAAAHwAAAAAAAAAQQ2xhaW1Ob3RSZXNvbHZlZAAAACAAAAAAAAAADk5vdEFDaGFsbGVuZ2VyAAAAAAAhAAAAAAAAABRBbHJlYWR5Q2xhaW1lZFBheW91dAAAACIAAAAAAAAAFENoYWxsZW5nZXJzRGlkTm90V2luAAAAIw==",
        "AAAAAQAAAAAAAAAAAAAACUZlZVBvbGljeQAAAAAAAAMAAAAAAAAAE2FnZW50X293bmVyX2ZlZV9icHMAAAAABAAAAAAAAAAQcGxhdGZvcm1fZmVlX2JwcwAAAAQAAAAAAAAAEnBsYXRmb3JtX3JlY2lwaWVudAAAAAAD6AAAABM=",
        "AAAAAQAAAAAAAAAAAAAACkNoYWxsZW5nZXIAAAAAAAMAAAAAAAAAB2FkZHJlc3MAAAAAEwAAAL9TZXQgb25jZSB0aGlzIGNoYWxsZW5nZXIgaGFzIHB1bGxlZCB0aGVpciBzZXR0bGVtZW50LiBIZWxkIG9uIHRoZSByb3N0ZXIKZW50cnkgcmF0aGVyIHRoYW4gaW4gYSBzaWRlIG1hcCBzbyBgZ2V0X2NoYWxsZW5nZXJfbGlzdGAgY2FuIHJlcG9ydCBjbGFpbQpzdGF0dXMgd2l0aG91dCBhbiBleHRyYSByZWFkIHBlciBjaGFsbGVuZ2VyLgAAAAAHY2xhaW1lZAAAAAABAAAAAAAAAAVzdGFrZQAAAAAAAAs=",
        "AAAAAwAAAAAAAAAAAAAACkNsYWltU3RhdGUAAAAAAAQAAAAAAAAABE9wZW4AAAAAAAAAAAAAAAZBY3RpdmUAAAAAAAEAAAAAAAAACFJlc29sdmVkAAAAAgAAAAAAAAAJQ2FuY2VsbGVkAAAAAAAAAw==",
        "AAAAAwAAAAAAAAAAAAAACldpbm5lclNpZGUAAAAAAAUAAAAAAAAABE5vbmUAAAAAAAAAAAAAAAdDcmVhdG9yAAAAAAEAAAAAAAAAC0NoYWxsZW5nZXJzAAAAAAIAAAAAAAAABERyYXcAAAADAAAAAAAAAAxVbnJlc29sdmFibGUAAAAE",
        "AAAAAQAAAEBDb3BpZWQgb250byBlYWNoIGNsYWltIGF0IGNyZWF0aW9uIGFuZCBuZXZlciBtdXRhdGVkIGFmdGVyd2FyZHMuAAAAAAAAAAtGZWVTbmFwc2hvdAAAAAAEAAAAAAAAABNhZ2VudF9vd25lcl9mZWVfYnBzAAAAAAQAAAAAAAAAFWFnZW50X293bmVyX3JlY2lwaWVudAAAAAAAA+gAAAATAAAAAAAAABBwbGF0Zm9ybV9mZWVfYnBzAAAABAAAAAAAAAAScGxhdGZvcm1fcmVjaXBpZW50AAAAAAPoAAAAEw==",
        "AAAAAQAAAFZXaGF0IGEgY2hhbGxlbmdlciB3b3VsZCByZWNlaXZlIGZyb20gYGNsYWltX2NoYWxsZW5nZXJfcGF5b3V0YCwgd2l0aG91dApwZXJmb3JtaW5nIGl0LgAAAAAAAAAAAAtQYXlvdXRRdW90ZQAAAAAEAAAAAAAAAAdjbGFpbWVkAAAAAAEAAAAAAAAAA2ZlZQAAAAALAAAAAAAAAAVncm9zcwAAAAAAAAsAAAAAAAAAA25ldAAAAAAL",
        "AAAAAQAAAAAAAAAAAAAADENsYWltRmVlVmlldwAAAAUAAAAAAAAAE2FnZW50X293bmVyX2ZlZV9icHMAAAAABAAAAAAAAAAVYWdlbnRfb3duZXJfcmVjaXBpZW50AAAAAAAD6AAAABMAAAAAAAAADGNvbnRleHRfaGFzaAAAA+4AAAAgAAAAAAAAABBwbGF0Zm9ybV9mZWVfYnBzAAAABAAAAAAAAAAScGxhdGZvcm1fcmVjaXBpZW50AAAAAAPoAAAAEw==",
        "AAAAAQAAAIRNaXJyb3JzIGBNaW1pclYyLkNyZWF0ZVBhcmFtc2AuIEdyb3VwZWQgaW50byBhIHN0cnVjdCBmb3IgdGhlIHNhbWUgcmVhc29uIHRoZQpTb2xpZGl0eSBkaWQ6IHRoZSBhcmd1bWVudCBsaXN0IGlzIG90aGVyd2lzZSB1bndpZWxkeS4AAAAAAAAADENyZWF0ZVBhcmFtcwAAABIAAAA1YE5vbmVgIHdoZW4gdGhlIG1hcmtldCBpcyBub3QgYXR0cmlidXRlZCB0byBhbiBhZ2VudC4AAAAAAAAVYWdlbnRfb3duZXJfcmVjaXBpZW50AAAAAAAD6AAAABMAAAAAAAAACGNhdGVnb3J5AAAAEAAAAAAAAAAVY2hhbGxlbmdlcl9wYXlvdXRfYnBzAAAAAAAABAAAAAAAAAAMY29udGV4dF9oYXNoAAAD7gAAACAAAAAAAAAAEGNvdW50ZXJfcG9zaXRpb24AAAAQAAAAAAAAABBjcmVhdG9yX3Bvc2l0aW9uAAAAEAAAAAAAAAAIZGVhZGxpbmUAAAAGAAAAAAAAAA1oYW5kaWNhcF9saW5lAAAAAAAAEAAAAAAAAAAKaW52aXRlX2tleQAAAAAD6AAAABAAAAAAAAAACmlzX3ByaXZhdGUAAAAAAAEAAAAAAAAAC21hcmtldF90eXBlAAAAABAAAAAAAAAAD21heF9jaGFsbGVuZ2VycwAAAAAEAAAAAAAAAAlvZGRzX21vZGUAAAAAAAAQAAAAAAAAAAlwYXJlbnRfaWQAAAAAAAAGAAAAAAAAAAhxdWVzdGlvbgAAABAAAAAAAAAADnJlc29sdXRpb25fdXJsAAAAAAAQAAAAAAAAAA9zZXR0bGVtZW50X3J1bGUAAAAAEAAAAAAAAAAMc3Rha2VfYW1vdW50AAAACw==",
        "AAAAAQAAAAAAAAAAAAAADE1hcmtldENvbmZpZwAAAAgAAAAAAAAAFWNoYWxsZW5nZXJfcGF5b3V0X2JwcwAAAAAAAAQAAAAAAAAADWhhbmRpY2FwX2xpbmUAAAAAAAAQAAAAAAAAAA9pbnZpdGVfa2V5X2hhc2gAAAAD6AAAA+4AAAAgAAAAAAAAAAppc19wcml2YXRlAAAAAAABAAAAAAAAAAttYXJrZXRfdHlwZQAAAAAQAAAAAAAAAA9tYXhfY2hhbGxlbmdlcnMAAAAABAAAAAAAAAAJb2Rkc19tb2RlAAAAAAAAEAAAAAAAAAAPc2V0dGxlbWVudF9ydWxlAAAAABA=",
        "AAAAAQAAAAAAAAAAAAAADVBsYXRmb3JtU3RhdHMAAAAAAAAFAAAAAAAAAAdiYWxhbmNlAAAAAAsAAAAAAAAADGZlZXNfYWNjcnVlZAAAAAsAAAAAAAAADGZlZXNfY2xhaW1lZAAAAAsAAAAAAAAACHJlc29sdmVkAAAABgAAAAAAAAAMdG90YWxfY2xhaW1zAAAABg==",
        "AAAAAQAAAAAAAAAAAAAAEFBlbmRpbmdGZWVQb2xpY3kAAAAEAAAAAAAAABNhZ2VudF9vd25lcl9mZWVfYnBzAAAAAAQAAAAAAAAADWV4ZWN1dGFibGVfYXQAAAAAAAAGAAAAAAAAABBwbGF0Zm9ybV9mZWVfYnBzAAAABAAAAAAAAAAScGxhdGZvcm1fcmVjaXBpZW50AAAAAAPoAAAAEw==",
        "AAAABQAAAAAAAAAAAAAACkZlZUFjY3J1ZWQAAAAAAAEAAAALZmVlX2FjY3J1ZWQAAAAABAAAAAAAAAACaWQAAAAAAAYAAAABAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAAAAAASaXNfYWdlbnRfb3duZXJfZmVlAAAAAAABAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAACkZlZUNsYWltZWQAAAAAAAEAAAALZmVlX2NsYWltZWQAAAAAAgAAAAAAAAAJcmVjaXBpZW50AAAAAAAAEwAAAAEAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAACldpdGhkcmF3YWwAAAAAAAEAAAAKd2l0aGRyYXdhbAAAAAAAAgAAAAAAAAACdG8AAAAAABMAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADENsYWltQ3JlYXRlZAAAAAEAAAANY2xhaW1fY3JlYXRlZAAAAAAAAAMAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAAHY3JlYXRvcgAAAAATAAAAAQAAAAAAAAAIY2F0ZWdvcnkAAAAQAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADUNsYWltUmVzb2x2ZWQAAAAAAAABAAAADmNsYWltX3Jlc29sdmVkAAAAAAAFAAAAAAAAAAJpZAAAAAAABgAAAAEAAAAAAAAAC3dpbm5lcl9zaWRlAAAAB9AAAAAKV2lubmVyU2lkZQAAAAAAAAAAAAAAAAAHc3VtbWFyeQAAAAAQAAAAAAAAAAAAAAAKY29uZmlkZW5jZQAAAAAABAAAAAAAAAAAAAAADWV2aWRlbmNlX2hhc2gAAAAAAAPuAAAAIAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADU1hcmtldFNldHRsZWQAAAAAAAABAAAADm1hcmtldF9zZXR0bGVkAAAAAAAFAAAAAAAAAAJpZAAAAAAABgAAAAEAAAAAAAAACnRvdGFsX3BhaWQAAAAAAAsAAAAAAAAAAAAAAAp0b3RhbF9mZWVzAAAAAAALAAAAAAAAAEJFc2Nyb3cgbGVmdCBmb3IgY2hhbGxlbmdlcnMgdG8gcHVsbCB2aWEgYGNsYWltX2NoYWxsZW5nZXJfcGF5b3V0YC4AAAAAABNvd2VkX3RvX2NoYWxsZW5nZXJzAAAAAAsAAAAAAAAAAAAAAARkdXN0AAAACwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADU9yYWNsZUNoYW5nZWQAAAAAAAABAAAADm9yYWNsZV9jaGFuZ2VkAAAAAAACAAAAAAAAAARuZXh0AAAAEwAAAAEAAAAAAAAACHByZXZpb3VzAAAD6AAAABMAAAAAAAAAAg==",
        "AAAABQAAANJPbmUgY2hhbGxlbmdlcidzIHNldHRsZW1lbnQuIFRvZ2V0aGVyIHdpdGggYENsYWltQ2hhbGxlbmdlZGAgYW5kCmBDbGFpbVJlc29sdmVkYCB0aGlzIGdpdmVzIGFuIG9mZi1jaGFpbiBpbmRleGVyIGV2ZXJ5dGhpbmcgaXQgbmVlZHMgdG8gZGVyaXZlCnBlci1hZGRyZXNzIHdpbi9sb3NzIHJlY29yZHMsIHdoaWNoIGFyZSBubyBsb25nZXIgdHJhY2tlZCBvbiBjaGFpbi4AAAAAAAAAAAAOQ2hhbGxlbmdlclBhaWQAAAAAAAEAAAAPY2hhbGxlbmdlcl9wYWlkAAAAAAYAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAAKY2hhbGxlbmdlcgAAAAAAEwAAAAEAAAAAAAAABXN0YWtlAAAAAAAACwAAAAAAAAAAAAAABWdyb3NzAAAAAAAACwAAAAAAAAAAAAAAA2ZlZQAAAAALAAAAAAAAAAAAAAADbmV0AAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADkNsYWltQ2FuY2VsbGVkAAAAAAABAAAAD2NsYWltX2NhbmNlbGxlZAAAAAABAAAAAAAAAAJpZAAAAAAABgAAAAEAAAAC",
        "AAAABQAAAAAAAAAAAAAAD0FnZW50QXR0cmlidXRlZAAAAAABAAAAEGFnZW50X2F0dHJpYnV0ZWQAAAACAAAAAAAAAAJpZAAAAAAABgAAAAEAAAAAAAAAFWFnZW50X293bmVyX3JlY2lwaWVudAAAAAAAABMAAAABAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAD0NsYWltQ2hhbGxlbmdlZAAAAAABAAAAEGNsYWltX2NoYWxsZW5nZWQAAAADAAAAAAAAAAJpZAAAAAAABgAAAAEAAAAAAAAACmNoYWxsZW5nZXIAAAAAABMAAAABAAAAAAAAAAVzdGFrZQAAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAD0ZlZVBvbGljeVF1ZXVlZAAAAAABAAAAEWZlZV9wb2xpY3lfcXVldWVkAAAAAAAABAAAAAAAAAAQcGxhdGZvcm1fZmVlX2JwcwAAAAQAAAAAAAAAAAAAABNhZ2VudF9vd25lcl9mZWVfYnBzAAAAAAQAAAAAAAAAAAAAABJwbGF0Zm9ybV9yZWNpcGllbnQAAAAAA+gAAAATAAAAAAAAAAAAAAANZXhlY3V0YWJsZV9hdAAAAAAAAAYAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAEEZlZVBvbGljeVVwZGF0ZWQAAAABAAAAEmZlZV9wb2xpY3lfdXBkYXRlZAAAAAAAAwAAAAAAAAAQcGxhdGZvcm1fZmVlX2JwcwAAAAQAAAAAAAAAAAAAABNhZ2VudF9vd25lcl9mZWVfYnBzAAAAAAQAAAAAAAAAAAAAABJwbGF0Zm9ybV9yZWNpcGllbnQAAAAAA+gAAAATAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAEVdpdGhkcmF3YWxQZW5kaW5nAAAAAAAAAQAAABJ3aXRoZHJhd2FsX3BlbmRpbmcAAAAAAAIAAAAAAAAAAnRvAAAAAAATAAAAAQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAEkZlZVBvbGljeUNhbmNlbGxlZAAAAAAAAQAAABRmZWVfcG9saWN5X2NhbmNlbGxlZAAAAAEAAAAAAAAACWNhbmNlbGxlZAAAAAAAAAEAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAFE93bmVyc2hpcFRyYW5zZmVycmVkAAAAAQAAABVvd25lcnNoaXBfdHJhbnNmZXJyZWQAAAAAAAACAAAAAAAAAARuZXh0AAAAEwAAAAEAAAAAAAAACHByZXZpb3VzAAAD6AAAABMAAAAAAAAAAg==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAADgAAAAAAAAAeT25lLXRpbWUgaW5pdGlhbGlzYXRpb24gZ3VhcmQuAAAAAAAESW5pdAAAAAAAAAAAAAAABU93bmVyAAAAAAAAAAAAAAAAAAAGT3JhY2xlAAAAAAAAAAAAAAAAAARVc2RjAAAAAAAAAAAAAAAGUG9saWN5AAAAAAAAAAAAAAAAAAdQZW5kaW5nAAAAAAAAAAAAAAAACkNsYWltQ291bnQAAAAAAAAAAAAAAAAADVRvdGFsUmVzb2x2ZWQAAAAAAAAAAAAAAAAAAAtGZWVzQWNjcnVlZAAAAAAAAAAAAAAAAAtGZWVzQ2xhaW1lZAAAAAABAAAAAAAAAAVDbGFpbQAAAAAAAAEAAAAGAAAAAQAAAAAAAAALQ2hhbGxlbmdlcnMAAAAAAQAAAAYAAAABAAAAL1B1bGwtcGF5bWVudCBmYWxsYmFjayBmb3IgZmFpbGVkIHBheW91dCBwdXNoZXMuAAAAAAxXaXRoZHJhd2FibGUAAAABAAAAEwAAAAEAAAA1QWNjcnVlZCwgdW5jbGFpbWVkIGZlZXMuIEFsd2F5cyBwdWxsZWQsIG5ldmVyIHB1c2hlZC4AAAAAAAAHQWNjcnVlZAAAAAABAAAAEw==",
        "AAAAAAAAAAAAAAAIZ2V0X3VzZGMAAAAAAAAAAQAAA+kAAAATAAAAAw==",
        "AAAAAAAAAItTb2xpZGl0eSB1c2VkIGBtc2cuc2VuZGVyYDsgU29yb2JhbiBoYXMgbm8gZXF1aXZhbGVudCBmb3IgYSB0b3AtbGV2ZWwKY2FsbCwgc28gdGhlIGJlbmVmaWNpYXJ5IGlzIGFuIGV4cGxpY2l0IGFyZ3VtZW50IHRoYXQgbXVzdCBhdXRob3JpemUuAAAAAAh3aXRoZHJhdwAAAAEAAAAAAAAAA3dobwAAAAATAAAAAQAAA+kAAAALAAAAAw==",
        "AAAAAAAAAAAAAAAJZ2V0X2NsYWltAAAAAAAAAQAAAAAAAAAIY2xhaW1faWQAAAAGAAAAAQAAA+kAAAfQAAAABUNsYWltAAAAAAAAAw==",
        "AAAAAAAAAAAAAAAJZ2V0X293bmVyAAAAAAAAAAAAAAEAAAPpAAAAEwAAAAM=",
        "AAAAAAAAAAAAAAAKY2xhaW1fZmVlcwAAAAAAAQAAAAAAAAADd2hvAAAAABMAAAABAAAD6QAAAAsAAAAD",
        "AAAAAAAAAAAAAAAKZ2V0X29yYWNsZQAAAAAAAAAAAAEAAAPpAAAAEwAAAAM=",
        "AAAAAAAAACZDb25zdHJ1Y3RvciBlcXVpdmFsZW50LCBjYWxsYWJsZSBvbmNlLgAAAAAACmluaXRpYWxpemUAAAAAAAYAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAAGb3JhY2xlAAAAAAATAAAAAAAAAAp1c2RjX3Rva2VuAAAAAAATAAAAAAAAABBwbGF0Zm9ybV9mZWVfYnBzAAAABAAAAAAAAAATYWdlbnRfb3duZXJfZmVlX2JwcwAAAAAEAAAAAAAAABJwbGF0Zm9ybV9yZWNpcGllbnQAAAAAA+gAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAKc2V0X29yYWNsZQAAAAAAAQAAAAAAAAAKbmV3X29yYWNsZQAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAMY2FuY2VsX2NsYWltAAAAAQAAAAAAAAAIY2xhaW1faWQAAAAGAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAMY3JlYXRlX2NsYWltAAAAAgAAAAAAAAAHY3JlYXRvcgAAAAATAAAAAAAAAAZwYXJhbXMAAAAAB9AAAAAMQ3JlYXRlUGFyYW1zAAAAAQAAA+kAAAAGAAAAAw==",
        "AAAAAAAAAAAAAAANcmVzb2x2ZV9jbGFpbQAAAAAAAAUAAAAAAAAACGNsYWltX2lkAAAABgAAAAAAAAALd2lubmVyX3NpZGUAAAAH0AAAAApXaW5uZXJTaWRlAAAAAAAAAAAAB3N1bW1hcnkAAAAAEAAAAAAAAAAKY29uZmlkZW5jZQAAAAAABAAAAAAAAAANZXZpZGVuY2VfaGFzaAAAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAOZ2V0X2NsYWltX2ZlZXMAAAAAAAEAAAAAAAAACGNsYWltX2lkAAAABgAAAAEAAAPpAAAH0AAAAAxDbGFpbUZlZVZpZXcAAAAD",
        "AAAAAAAAAAAAAAAOZ2V0X2ZlZV9wb2xpY3kAAAAAAAAAAAABAAAD6QAAB9AAAAAJRmVlUG9saWN5AAAAAAAAAw==",
        "AAAAAAAAAAAAAAAPY2hhbGxlbmdlX2NsYWltAAAAAAQAAAAAAAAACmNoYWxsZW5nZXIAAAAAABMAAAAAAAAACGNsYWltX2lkAAAABgAAAAAAAAAMc3Rha2VfYW1vdW50AAAACwAAAAAAAAAKaW52aXRlX2tleQAAAAAD6AAAABAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAQZ2V0X2FjY3J1ZWRfZmVlcwAAAAEAAAAAAAAAA3dobwAAAAATAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAAQZ2V0X3dpdGhkcmF3YWJsZQAAAAEAAAAAAAAAA3dobwAAAAATAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAAQcXVldWVfZmVlX3BvbGljeQAAAAMAAAAAAAAAEHBsYXRmb3JtX2ZlZV9icHMAAAAEAAAAAAAAABNhZ2VudF9vd25lcl9mZWVfYnBzAAAAAAQAAAAAAAAAEnBsYXRmb3JtX3JlY2lwaWVudAAAAAAD6AAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAARY2FuY2VsX2ZlZV9wb2xpY3kAAAAAAAAAAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAC1QZXJtaXNzaW9ubGVzcyBvbmNlIHRoZSB0aW1lbG9jayBoYXMgZWxhcHNlZC4AAAAAAAASZXhlY3V0ZV9mZWVfcG9saWN5AAAAAAAAAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAASZ2V0X3BsYXRmb3JtX3N0YXRzAAAAAAAAAAAAAQAAA+kAAAfQAAAADVBsYXRmb3JtU3RhdHMAAAAAAAAD",
        "AAAAAAAAAAAAAAASdHJhbnNmZXJfb3duZXJzaGlwAAAAAAABAAAAAAAAAAluZXdfb3duZXIAAAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAGRUaGUgcm9zdGVyLCBpbmNsdWRpbmcgZWFjaCBjaGFsbGVuZ2VyJ3Mgc3Rha2UgYW5kIHdoZXRoZXIgdGhleSBoYXZlCmFscmVhZHkgcHVsbGVkIHRoZWlyIHNldHRsZW1lbnQuAAAAE2dldF9jaGFsbGVuZ2VyX2xpc3QAAAAAAQAAAAAAAAAIY2xhaW1faWQAAAAGAAAAAQAAA+oAAAfQAAAACkNoYWxsZW5nZXIAAA==",
        "AAAAAAAAAAAAAAAWZ2V0X3BlbmRpbmdfZmVlX3BvbGljeQAAAAAAAAAAAAEAAAPoAAAH0AAAABBQZW5kaW5nRmVlUG9saWN5",
        "AAAAAAAAAaFTZXR0bGUgb25lIGNoYWxsZW5nZXIncyB3aW5uaW5nIG9yIHJlZnVuZGVkIHBvc2l0aW9uLiBDYWxsYWJsZSBvbmNlIHBlcgpjaGFsbGVuZ2VyIGFmdGVyIHJlc29sdXRpb24sIGFuZCBPKDEpIGluIHRoZSBudW1iZXIgb2YgY2hhbGxlbmdlcnMsIHNvIGEKbWFya2V0IGZpbGxlZCB0byBNQVhfQ0hBTExFTkdFUlMgY2FuIGFsd2F5cyBiZSBwYWlkIG91dCBpbiBmdWxsLgoKYHJlc29sdmVfY2xhaW1gIGRlbGliZXJhdGVseSBkb2VzIE5PVCBsb29wIG92ZXIgY2hhbGxlbmdlcnM6IGEgU3RlbGxhcgp0cmFuc2FjdGlvbiBpcyBjYXBwZWQgb24gaXRzIGxlZGdlci1lbnRyeSBmb290cHJpbnQsIGFuZCBwYXlpbmcgfjEwMApjaGFsbGVuZ2VycyBhdCBvbmNlIGRvZXMgbm90IGZpdC4gUmV0dXJucyB0aGUgbmV0IGFtb3VudCBjcmVkaXRlZC4AAAAAAAAXY2xhaW1fY2hhbGxlbmdlcl9wYXlvdXQAAAAAAgAAAAAAAAAKY2hhbGxlbmdlcgAAAAAAEwAAAAAAAAAIY2xhaW1faWQAAAAGAAAAAQAAA+kAAAALAAAAAw==",
        "AAAAAAAAAAAAAAAXZ2V0X2NsYWltX21hcmtldF9jb25maWcAAAAAAQAAAAAAAAAIY2xhaW1faWQAAAAGAAAAAQAAA+kAAAfQAAAADE1hcmtldENvbmZpZwAAAAM=",
        "AAAAAAAAAENXaGF0IGBjbGFpbV9jaGFsbGVuZ2VyX3BheW91dGAgd291bGQgcGF5IHRoaXMgY2hhbGxlbmdlciByaWdodCBub3cuAAAAABdxdW90ZV9jaGFsbGVuZ2VyX3BheW91dAAAAAACAAAAAAAAAAhjbGFpbV9pZAAAAAYAAAAAAAAACmNoYWxsZW5nZXIAAAAAABMAAAABAAAD6QAAB9AAAAALUGF5b3V0UXVvdGUAAAAAAw==" ]),
      options
    )
  }
  public readonly fromJSON = {
    get_usdc: this.txFromJSON<Result<string>>,
        withdraw: this.txFromJSON<Result<i128>>,
        get_claim: this.txFromJSON<Result<Claim>>,
        get_owner: this.txFromJSON<Result<string>>,
        claim_fees: this.txFromJSON<Result<i128>>,
        get_oracle: this.txFromJSON<Result<string>>,
        initialize: this.txFromJSON<Result<void>>,
        set_oracle: this.txFromJSON<Result<void>>,
        cancel_claim: this.txFromJSON<Result<void>>,
        create_claim: this.txFromJSON<Result<u64>>,
        resolve_claim: this.txFromJSON<Result<void>>,
        get_claim_fees: this.txFromJSON<Result<ClaimFeeView>>,
        get_fee_policy: this.txFromJSON<Result<FeePolicy>>,
        challenge_claim: this.txFromJSON<Result<void>>,
        get_accrued_fees: this.txFromJSON<i128>,
        get_withdrawable: this.txFromJSON<i128>,
        queue_fee_policy: this.txFromJSON<Result<void>>,
        cancel_fee_policy: this.txFromJSON<Result<void>>,
        execute_fee_policy: this.txFromJSON<Result<void>>,
        get_platform_stats: this.txFromJSON<Result<PlatformStats>>,
        transfer_ownership: this.txFromJSON<Result<void>>,
        get_challenger_list: this.txFromJSON<Array<Challenger>>,
        get_pending_fee_policy: this.txFromJSON<Option<PendingFeePolicy>>,
        claim_challenger_payout: this.txFromJSON<Result<i128>>,
        get_claim_market_config: this.txFromJSON<Result<MarketConfig>>,
        quote_challenger_payout: this.txFromJSON<Result<PayoutQuote>>
  }
}