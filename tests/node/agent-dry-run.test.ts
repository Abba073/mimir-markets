import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentDryRun } from "../../lib/agents/dry-run";
import { USDC_UNIT } from "../../lib/usdc";

// G… strkeys: the only address form a fee can be paid to.
const PLATFORM = "GB5DLP3MNPUXXJ6P67XGD3OV3ZVIMZN3NZDLVDIYQN6JSC2M7QMMBL4E";
const OWNER = "GDYJ7GZ4WDGYFE6R3HFBUK2GYMFIFP3JHFYSYAME6XISG5BEKZDJVGHN";

test("dry-run exposes policy, allowance, payout and both fee lines before signing", () => {
  const preview = buildAgentDryRun({ principalUsdc: 10, grossPayoutUsdc: 20,
    outcome: "creator_wins", allowanceAtomic: 10n * USDC_UNIT, requiredAtomic: 10n * USDC_UNIT,
    platformFeeBps: 300, agentOwnerFeeBps: 100,
    platformRecipient: PLATFORM,
    ownerRecipient: OWNER,
    policy: { allowed: true } });
  assert.equal(preview.allowed, true);
  assert.equal(preview.allowance.sufficient, true);
  assert.equal(preview.payout.platformFeeUsdc, 0.3);
  assert.equal(preview.payout.agentOwnerFeeUsdc, 0.1);
  assert.equal(preview.payout.totalReturnUsdc, 19.6);
});

test("dry-run refuses insufficient allowance even when registry policy allows", () => {
  const preview = buildAgentDryRun({ principalUsdc: 2, grossPayoutUsdc: 4,
    outcome: "challengers_win", allowanceAtomic: 0n, requiredAtomic: 2n * USDC_UNIT,
    platformFeeBps: 0, agentOwnerFeeBps: 0, platformRecipient: "", ownerRecipient: "",
    policy: { allowed: true } });
  assert.equal(preview.allowed, false);
  assert.equal(preview.allowance.sufficient, false);
});
