import assert from "node:assert/strict";
import test from "node:test";
import {
  assertWalletAdapter,
  authorizeWalletCall,
  type StellarAgentWalletAdapter,
  type WalletBudgetPolicy,
} from "../../lib/agents/wallet-adapter";

/**
 * The budget policy is chain-agnostic arithmetic over atomic USDC, so these
 * assertions are unchanged in substance from the EVM version. Two things went with
 * the chain, and their tests went with them:
 *
 *   `native_value_forbidden`         there is no payable call on Soroban. XLM is
 *                                    the fee, never an argument, so the rejection
 *                                    had nothing left to reject.
 *   `gas_sponsorship_not_allowed`    sponsorship is dropped as a product decision;
 *                                    agents self-fund their own sub-cent fees.
 *
 * `baseSpendPermission` is gone too — Base Account spend permissions are an EVM
 * mechanism. The Stellar equivalent (the USDC SAC's own `approve`) is covered by
 * tests/node/agent-spend-permissions.test.ts.
 */

/** Real contract ids — the market contract, and an unrelated one. */
const MIMIR = "CDV6JXIJCALSXQELCS6YUEWJWG5DFXQK5PJ5I7MWI6KVMQJBC5DLPKZI";
const OTHER = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const ACCOUNT = "GBMGZBFKUNOS7JWPRPF5IMZR27DCR6BEP6SQVFV2I354UPY35FZTIR2Y";

const call = (exposureAtomic = 1n) => ({ contractId: MIMIR, exposureAtomic });
const policy = (overrides: Partial<WalletBudgetPolicy> = {}): WalletBudgetPolicy => ({
  maxPerCallAtomic: 5n,
  maxPerSessionAtomic: 10n,
  maxPerDayAtomic: 20n,
  maxTotalOpenExposureAtomic: 30n,
  allowedTargets: [MIMIR],
  paused: false,
  ...overrides,
});
const usage = { sessionAtomic: 0n, dayAtomic: 0n, totalOpenExposureAtomic: 0n };
const reason = (result: ReturnType<typeof authorizeWalletCall>) => "reason" in result ? result.reason : null;

test("wallet budget enforces call, session, day and total exposure independently", () => {
  assert.equal(reason(authorizeWalletCall({ call: call(6n), policy: policy(), usage })), "per_call_exceeded");
  assert.equal(reason(authorizeWalletCall({ call: call(3n), policy: policy(), usage: { ...usage, sessionAtomic: 8n } })), "session_exceeded");
  assert.equal(reason(authorizeWalletCall({ call: call(3n), policy: policy(), usage: { ...usage, dayAtomic: 19n } })), "day_exceeded");
  assert.equal(reason(authorizeWalletCall({ call: call(3n), policy: policy(), usage: { ...usage, totalOpenExposureAtomic: 29n } })), "total_exposure_exceeded");
});

test("a call inside every ceiling is admitted", () => {
  assert.deepEqual(authorizeWalletCall({ call: call(5n), policy: policy(), usage }), { allowed: true });
});

test("pause and the target allowlist cannot be bypassed", () => {
  assert.equal(reason(authorizeWalletCall({ call: call(), policy: policy({ paused: true }), usage })), "paused");
  assert.equal(
    reason(authorizeWalletCall({ call: { contractId: OTHER, exposureAtomic: 1n }, policy: policy(), usage })),
    "target_not_allowed",
  );
});

test("the target allowlist is case-SENSITIVE", () => {
  // A Soroban contract id is case-sensitive base32. The EVM version compared
  // `toLowerCase()` on both sides, which was right for hex and would here admit a
  // string that is not a valid contract id at all.
  assert.equal(
    reason(authorizeWalletCall({ call: { contractId: MIMIR.toLowerCase(), exposureAtomic: 1n }, policy: policy(), usage })),
    "target_not_allowed",
  );
});

test("an adapter must carry a real Stellar address", () => {
  const adapter = (address: string): StellarAgentWalletAdapter => ({
    kind: "keypair",
    address,
    verifySignature: async () => false,
    simulate: async () => ({ ok: true }),
    send: async () => "",
  });
  // Both forms are legitimate: a `G…` keypair account and a `C…` contract account.
  assert.equal(assertWalletAdapter(adapter(ACCOUNT)).address, ACCOUNT);
  assert.equal(assertWalletAdapter(adapter(MIMIR)).address, MIMIR);
  assert.throws(() => assertWalletAdapter(adapter("0x1111111111111111111111111111111111111111")), /invalid adapter address/);
  assert.throws(() => assertWalletAdapter(adapter(ACCOUNT.toLowerCase())), /invalid adapter address/);
});
