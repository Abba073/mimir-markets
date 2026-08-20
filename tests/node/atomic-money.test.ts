import assert from "node:assert/strict";
import test from "node:test";
import { authorizeAction, defaultLimits, type AgentRecord } from "../../lib/agents/registry";
import { formatAtomicUsdc, parseUsdcAtomic } from "../../lib/usdc";

test("USDC parsing and rendering is exact at seven decimals", () => {
  // SEVEN, not six: Mimir moved to USDC's Stellar Asset Contract, and a SAC exposes
  // a classic asset with 7 decimals (verified by invoking `decimals()` on the live
  // Testnet SAC). This is also what `types.rs::MIN_STAKE = 2_0000000` assumes.
  assert.equal(parseUsdcAtomic("9007199254740993.1234567"), 90071992547409931234567n);
  assert.equal(formatAtomicUsdc(90071992547409931234567n), "9007199254740993.1234567");
  assert.throws(() => parseUsdcAtomic("1.00000001"), "an eighth decimal is not representable");
  assert.throws(() => parseUsdcAtomic("1e7"));
});

test("agent budget arithmetic stays atomic beyond Number.MAX_SAFE_INTEGER", () => {
  const limits = { ...defaultLimits(), maxPositionAtomic: "9007199254740993123456", maxDailyExposureAtomic: "9007199254740994123456" };
  const agent: AgentRecord = { schemaVersion: 1, agentId: "atomic", ownerWallet: "0x1", operatorWallet: "0x2", payoutWallet: "0x1", displayName: "Atomic", description: "", capabilities: ["council_juror"], authorityLevel: 3, limits, status: "active", reputationBps: 0, createdAt: 1, updatedAt: 1 };
  assert.equal(authorizeAction(agent, { capability: "council_juror", positionAtomic: "9007199254740993123456", exposureTodayAtomic: "1000000" }).allowed, true);
  assert.equal(authorizeAction(agent, { capability: "council_juror", positionAtomic: "9007199254740993123457" }).reason, "position_too_large");
});
