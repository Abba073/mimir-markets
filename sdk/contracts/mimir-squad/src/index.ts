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
    contractId: "CBPGVXHXLULUBVZ24D6XNSUX7NH45HYXGWHAJFWTBHXYNO72KDRKCDFY",
  }
} as const

export const Errors = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"ZeroAddress"},
  4: {message:"EmptyQuestion"},
  5: {message:"BadDeadline"},
  6: {message:"FeeCapExceeded"},
  7: {message:"MarketNotFound"},
  8: {message:"MarketClosed"},
  9: {message:"BadSide"},
  10: {message:"ZeroAmount"},
  11: {message:"SideFull"},
  12: {message:"Locked"},
  13: {message:"BadAmount"},
  14: {message:"NotOracle"},
  15: {message:"NotResolvable"},
  16: {message:"BadResult"},
  17: {message:"EmptyWinner"},
  18: {message:"NotClaimable"},
  19: {message:"NotWinner"},
  20: {message:"AlreadyClaimed"},
  21: {message:"NotFeeRecipient"},
  22: {message:"NoFees"},
  23: {message:"UnsupportedToken"},
  24: {message:"Overflow"}
}


export interface Market {
  captain: string;
  deadline: u64;
  fee_bps: u32;
  participants_a: u32;
  participants_b: u32;
  pool_a: i128;
  pool_b: i128;
  remaining_escrow: i128;
  resolved: boolean;
  /**
 * `0` until resolved, then SIDE_A / SIDE_B / RESULT_CANCELLED.
 */
result: u32;
  winner_claims: u32;
}


export interface ClaimResult {
  fee: i128;
  gross: i128;
  net: i128;
}







export type DataKey = {tag: "Init", values: void} | {tag: "Usdc", values: void} | {tag: "Oracle", values: void} | {tag: "FeeRecipient", values: void} | {tag: "MarketCount", values: void} | {tag: "AccruedFees", values: void} | {tag: "Market", values: readonly [u64]} | {tag: "Deposit", values: readonly [u64, u32, string]} | {tag: "Claimed", values: readonly [u64, u32, string]};

export interface Client {
  /**
   * Construct and simulate a claim transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Pull-based payout. Solidity used `msg.sender`; Soroban has no equivalent
   * for a top-level call, so the claimant is an explicit argument that must
   * authorize. Returns the net amount transferred.
   */
  claim: ({participant, market_id, side}: {participant: string, market_id: u64, side: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  deposit: ({participant, market_id, side, amount}: {participant: string, market_id: u64, side: u32, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a resolve transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  resolve: ({market_id, result}: {market_id: u64, result: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_usdc transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_usdc: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a claim_fees transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  claim_fees: (options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a get_market transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_market: ({market_id}: {market_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Market>>>

  /**
   * Construct and simulate a get_oracle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_oracle: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Constructor equivalent, callable once.
   */
  initialize: ({usdc, oracle, fee_recipient}: {usdc: string, oracle: string, fee_recipient: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_deposit: ({market_id, side, who}: {market_id: u64, side: u32, who: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a has_claimed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  has_claimed: ({market_id, side, who}: {market_id: u64, side: u32, who: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a create_market transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  create_market: ({captain, question, deadline, fee_bps}: {captain: string, question: string, deadline: u64, fee_bps: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a preview_claim transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  preview_claim: ({market_id, side, who}: {market_id: u64, side: u32, who: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<ClaimResult>>>

  /**
   * Construct and simulate a get_accrued_fees transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_accrued_fees: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a get_market_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_market_count: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a get_fee_recipient transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_fee_recipient: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a get_escrow_balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_escrow_balance: (options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a withdraw_before_deadline transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  withdraw_before_deadline: ({participant, market_id, side, amount}: {participant: string, market_id: u64, side: u32, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
      new ContractSpec([ "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",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAACQAAAAAAAAAAAAAABEluaXQAAAAAAAAAAAAAAARVc2RjAAAAAAAAAAAAAAAGT3JhY2xlAAAAAAAAAAAAAAAAAAxGZWVSZWNpcGllbnQAAAAAAAAAAAAAAAtNYXJrZXRDb3VudAAAAAAAAAAAAAAAAAtBY2NydWVkRmVlcwAAAAABAAAAAAAAAAZNYXJrZXQAAAAAAAEAAAAGAAAAAQAAAEMobWFya2V0LCBzaWRlLCBwYXJ0aWNpcGFudCkgLT4gZGVwb3NpdGVkIHVuaXRzLiBTaGFyZXMgZXF1YWwgdW5pdHMuAAAAAAdEZXBvc2l0AAAAAAMAAAAGAAAABAAAABMAAAABAAAALyhtYXJrZXQsIHNpZGUsIHBhcnRpY2lwYW50KSAtPiBhbHJlYWR5IGNsYWltZWQuAAAAAAdDbGFpbWVkAAAAAAMAAAAGAAAABAAAABM=",
        "AAAAAAAAAL9QdWxsLWJhc2VkIHBheW91dC4gU29saWRpdHkgdXNlZCBgbXNnLnNlbmRlcmA7IFNvcm9iYW4gaGFzIG5vIGVxdWl2YWxlbnQKZm9yIGEgdG9wLWxldmVsIGNhbGwsIHNvIHRoZSBjbGFpbWFudCBpcyBhbiBleHBsaWNpdCBhcmd1bWVudCB0aGF0IG11c3QKYXV0aG9yaXplLiBSZXR1cm5zIHRoZSBuZXQgYW1vdW50IHRyYW5zZmVycmVkLgAAAAAFY2xhaW0AAAAAAAADAAAAAAAAAAtwYXJ0aWNpcGFudAAAAAATAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAGAAAAAAAAAARzaWRlAAAABAAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAAAAAAAHZGVwb3NpdAAAAAAEAAAAAAAAAAtwYXJ0aWNpcGFudAAAAAATAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAGAAAAAAAAAARzaWRlAAAABAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAHcmVzb2x2ZQAAAAACAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAGAAAAAAAAAAZyZXN1bHQAAAAAAAQAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAIZ2V0X3VzZGMAAAAAAAAAAQAAA+kAAAATAAAAAw==",
        "AAAAAAAAAAAAAAAKY2xhaW1fZmVlcwAAAAAAAAAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAAAAAAAKZ2V0X21hcmtldAAAAAAAAQAAAAAAAAAJbWFya2V0X2lkAAAAAAAABgAAAAEAAAPpAAAH0AAAAAZNYXJrZXQAAAAAAAM=",
        "AAAAAAAAAAAAAAAKZ2V0X29yYWNsZQAAAAAAAAAAAAEAAAPpAAAAEwAAAAM=",
        "AAAAAAAAACZDb25zdHJ1Y3RvciBlcXVpdmFsZW50LCBjYWxsYWJsZSBvbmNlLgAAAAAACmluaXRpYWxpemUAAAAAAAMAAAAAAAAABHVzZGMAAAATAAAAAAAAAAZvcmFjbGUAAAAAABMAAAAAAAAADWZlZV9yZWNpcGllbnQAAAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAALZ2V0X2RlcG9zaXQAAAAAAwAAAAAAAAAJbWFya2V0X2lkAAAAAAAABgAAAAAAAAAEc2lkZQAAAAQAAAAAAAAAA3dobwAAAAATAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAALaGFzX2NsYWltZWQAAAAAAwAAAAAAAAAJbWFya2V0X2lkAAAAAAAABgAAAAAAAAAEc2lkZQAAAAQAAAAAAAAAA3dobwAAAAATAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAANY3JlYXRlX21hcmtldAAAAAAAAAQAAAAAAAAAB2NhcHRhaW4AAAAAEwAAAAAAAAAIcXVlc3Rpb24AAAAQAAAAAAAAAAhkZWFkbGluZQAAAAYAAAAAAAAAB2ZlZV9icHMAAAAABAAAAAEAAAPpAAAABgAAAAM=",
        "AAAAAAAAAAAAAAANcHJldmlld19jbGFpbQAAAAAAAAMAAAAAAAAACW1hcmtldF9pZAAAAAAAAAYAAAAAAAAABHNpZGUAAAAEAAAAAAAAAAN3aG8AAAAAEwAAAAEAAAPpAAAH0AAAAAtDbGFpbVJlc3VsdAAAAAAD",
        "AAAAAAAAAAAAAAAQZ2V0X2FjY3J1ZWRfZmVlcwAAAAAAAAABAAAACw==",
        "AAAAAAAAAAAAAAAQZ2V0X21hcmtldF9jb3VudAAAAAAAAAABAAAABg==",
        "AAAAAAAAAAAAAAARZ2V0X2ZlZV9yZWNpcGllbnQAAAAAAAAAAAAAAQAAA+kAAAATAAAAAw==",
        "AAAAAAAAAAAAAAASZ2V0X2VzY3Jvd19iYWxhbmNlAAAAAAAAAAAAAQAAA+kAAAALAAAAAw==",
        "AAAAAAAAAAAAAAAYd2l0aGRyYXdfYmVmb3JlX2RlYWRsaW5lAAAABAAAAAAAAAALcGFydGljaXBhbnQAAAAAEwAAAAAAAAAJbWFya2V0X2lkAAAAAAAABgAAAAAAAAAEc2lkZQAAAAQAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAPpAAAAAgAAAAM=" ]),
      options
    )
  }
  public readonly fromJSON = {
    claim: this.txFromJSON<Result<i128>>,
        deposit: this.txFromJSON<Result<void>>,
        resolve: this.txFromJSON<Result<void>>,
        get_usdc: this.txFromJSON<Result<string>>,
        claim_fees: this.txFromJSON<Result<i128>>,
        get_market: this.txFromJSON<Result<Market>>,
        get_oracle: this.txFromJSON<Result<string>>,
        initialize: this.txFromJSON<Result<void>>,
        get_deposit: this.txFromJSON<i128>,
        has_claimed: this.txFromJSON<boolean>,
        create_market: this.txFromJSON<Result<u64>>,
        preview_claim: this.txFromJSON<Result<ClaimResult>>,
        get_accrued_fees: this.txFromJSON<i128>,
        get_market_count: this.txFromJSON<u64>,
        get_fee_recipient: this.txFromJSON<Result<string>>,
        get_escrow_balance: this.txFromJSON<Result<i128>>,
        withdraw_before_deadline: this.txFromJSON<Result<void>>
  }
}