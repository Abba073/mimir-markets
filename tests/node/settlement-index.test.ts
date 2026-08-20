import assert from "node:assert/strict";
import test from "node:test";

import { grossVolume, splitFees } from "../../lib/server/settlement-index";

test("fees split by their agent-owner flag", () => {
  const { platformAtomic, agentOwnerAtomic } = splitFees([
    { amount: 30_000n, isAgentOwnerFee: false },
    { amount: 20_000n, isAgentOwnerFee: true },
    { amount: 10_000n, isAgentOwnerFee: false },
  ]);
  assert.equal(platformAtomic, 40_000n);
  assert.equal(agentOwnerAtomic, 20_000n);
});

test("a market with no accruals splits to zero rather than throwing", () => {
  assert.deepEqual(splitFees([]), { platformAtomic: 0n, agentOwnerAtomic: 0n });
});

test("gross volume accounts for every atom the contract moved", () => {
  // 4 USDC staked, settled as 3.94 pushed + 0.05 fees + 0.01 dust and nothing left
  // owed: nothing may be lost between the stake and the buckets, or the dashboard
  // under-reports volume against the chain.
  assert.equal(grossVolume(3_940_000n, 50_000n, 0n, 10_000n), 4_000_000n);
});

test("escrow still owed to challengers counts as volume", () => {
  // The term the EVM version did not need. `resolve_claim` no longer pays the
  // challenger side — it escrows it for them to pull — so at settlement time
  // `owed_to_challengers` is frequently the LARGEST bucket. Omitting it would have
  // reported a freshly settled market as near-zero volume and then quietly grown
  // the figure as pulls landed.
  assert.equal(grossVolume(0n, 0n, 40_000_000n, 0n), 40_000_000n);
  assert.equal(grossVolume(1_000_000n, 400_000n, 38_600_000n, 0n), 40_000_000n);
});
