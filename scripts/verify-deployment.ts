/**
 * Verify the live Soroban deployment on Stellar Testnet.
 *
 * Replaces the previous EVM verifier. That script proved two things:
 * (a) the deployed runtime bytecode matched a fresh solc compile of the source,
 * and (b) the on-chain `owner`/`oracle`/`usdc` matched what was configured. The
 * Soroban equivalents are:
 *
 *   (a) the WASM hash the contract instance points at equals the sha256 of the
 *       locally built `mimir_*.wasm` — the direct analogue of a bytecode match,
 *       and stronger than the EVM version because Soroban stores the hash itself
 *       so there are no immutables to normalize away;
 *   (b) `get_owner` / `get_oracle` / `get_usdc` / `get_fee_policy` read back
 *       through the generated bindings and match `.env.local`.
 *
 * Read-only: submits nothing, spends nothing.
 *
 *   npx tsx scripts/verify-deployment.ts
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { rpc } from "@stellar/stellar-sdk";

import {
  ENV_KEYS,
  MAX_TOTAL_FEE_BPS,
  NETWORK_PASSPHRASE,
  REPO_ROOT,
  SOROBAN_RPC_URL,
  USDC_ASSET,
  envValue,
  explorerContractUrl,
  requireEnv,
} from "./lib/stellar-env";
import { marketClient, squadClient, unwrapResult } from "./lib/stellar-clients";

const WASM_DIR = path.join(REPO_ROOT, "contracts-soroban", "target", "wasm32v1-none", "release");
const server = new rpc.Server(SOROBAN_RPC_URL);

const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = String(actual) === String(expected);
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
  if (!ok) failures.push(`${label}: got ${actual}, expected ${expected}`);
}

function note(label: string, value: unknown): void {
  console.log(`  · ${label}: ${value}`);
}

/**
 * Compare the WASM hash recorded in the contract instance against the sha256 of
 * the local build. Skipped (not failed) when the build output is absent, so the
 * verifier still runs usefully on a machine without the Rust toolchain.
 */
async function verifyWasmHash(label: string, contractId: string, wasmFile: string): Promise<void> {
  const onChainHash = await fetchInstanceWasmHash(contractId);
  if (!onChainHash) {
    failures.push(`${label}: could not read the instance WASM hash from RPC`);
    console.log(`  ✗ ${label} wasm hash: unreadable`);
    return;
  }
  if (!existsSync(wasmFile)) {
    note(`${label} wasm hash (on-chain)`, onChainHash);
    note(`${label} local wasm`, "not built — skipping hash comparison");
    return;
  }
  const localHash = createHash("sha256").update(readFileSync(wasmFile)).digest("hex");
  check(`${label} wasm hash matches local build`, onChainHash, localHash);
}

async function fetchInstanceWasmHash(contractId: string): Promise<string | undefined> {
  // `getContractWasmByContractId` is not available across all SDK minors, so read
  // the instance ledger entry and pull the executable's wasm hash out of it.
  const { Address, xdr } = await import("@stellar/stellar-sdk");
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  const response = await server.getLedgerEntries(key);
  const entry = response.entries?.[0];
  if (!entry) return undefined;
  const instance = entry.val.contractData().val().instance();
  const executable = instance.executable();
  if (executable.switch().name !== "contractExecutableWasm") return undefined;
  return executable.wasmHash().toString("hex");
}

async function main(): Promise<void> {
  const marketId = requireEnv(ENV_KEYS.marketId, "run: npx tsx deploy/deploy.ts");
  const squadId = requireEnv(ENV_KEYS.squadId, "run: npx tsx deploy/deploy.ts");
  const usdcSac = requireEnv(ENV_KEYS.usdcSac, "run: npx tsx deploy/deploy.ts");
  const deployer = requireEnv(ENV_KEYS.deployerPublic, "run: npx tsx scripts/stellar-keys.ts");
  const oracle = requireEnv(ENV_KEYS.oraclePublic, "run: npx tsx scripts/stellar-keys.ts");
  const expectedPlatformFeeBps = Number(envValue(ENV_KEYS.platformFeeBps) ?? 200);
  const expectedAgentFeeBps = Number(envValue(ENV_KEYS.agentOwnerFeeBps) ?? 0);

  console.log("── Verify Mimir Soroban deployment ──");
  console.log(`  network    : ${NETWORK_PASSPHRASE}`);
  console.log(`  rpc        : ${SOROBAN_RPC_URL}`);
  console.log(`  usdc asset : ${USDC_ASSET}`);
  console.log(`  usdc SAC   : ${usdcSac}`);

  const health = await server.getHealth();
  check("rpc health", health.status, "healthy");
  const network = await server.getNetwork();
  check("rpc network passphrase", network.passphrase, NETWORK_PASSPHRASE);

  // ── mimir-market ──────────────────────────────────────────────────────────
  console.log(`\n[mimir-market] ${marketId}`);
  console.log(`  ${explorerContractUrl(marketId)}`);
  await verifyWasmHash("mimir-market", marketId, path.join(WASM_DIR, "mimir_market.wasm"));

  const market = marketClient();
  check("get_owner", unwrapResult("get_owner", (await market.get_owner()).result), deployer);
  check("get_oracle", unwrapResult("get_oracle", (await market.get_oracle()).result), oracle);
  check("get_usdc", unwrapResult("get_usdc", (await market.get_usdc()).result), usdcSac);

  const feePolicy = unwrapResult<{
    platform_fee_bps: number;
    agent_owner_fee_bps: number;
    platform_recipient?: string;
  }>("get_fee_policy", (await market.get_fee_policy()).result);
  check("fee_policy.platform_fee_bps", feePolicy.platform_fee_bps, expectedPlatformFeeBps);
  check("fee_policy.agent_owner_fee_bps", feePolicy.agent_owner_fee_bps, expectedAgentFeeBps);
  check("fee_policy.platform_recipient", feePolicy.platform_recipient, deployer);

  const totalFeeBps = feePolicy.platform_fee_bps + feePolicy.agent_owner_fee_bps;
  check(
    `fee_policy total <= MAX_TOTAL_FEE_BPS (${MAX_TOTAL_FEE_BPS})`,
    totalFeeBps <= MAX_TOTAL_FEE_BPS,
    true,
  );

  const pending = (await market.get_pending_fee_policy()).result;
  check("get_pending_fee_policy is empty", pending === undefined || pending === null, true);

  const stats = unwrapResult<{
    total_claims: bigint;
    resolved: bigint;
    balance: bigint;
    fees_accrued: bigint;
    fees_claimed: bigint;
  }>("get_platform_stats", (await market.get_platform_stats()).result);
  note("platform_stats.total_claims", stats.total_claims);
  note("platform_stats.resolved", stats.resolved);
  note("platform_stats.balance (atomic USDC)", stats.balance);
  note("platform_stats.fees_accrued", stats.fees_accrued);
  note("platform_stats.fees_claimed", stats.fees_claimed);

  // ── mimir-squad ───────────────────────────────────────────────────────────
  console.log(`\n[mimir-squad] ${squadId}`);
  console.log(`  ${explorerContractUrl(squadId)}`);
  await verifyWasmHash("mimir-squad", squadId, path.join(WASM_DIR, "mimir_squad.wasm"));

  const squad = squadClient();
  check("get_usdc", unwrapResult("get_usdc", (await squad.get_usdc()).result), usdcSac);
  check("get_oracle", unwrapResult("get_oracle", (await squad.get_oracle()).result), oracle);
  check(
    "get_fee_recipient",
    unwrapResult("get_fee_recipient", (await squad.get_fee_recipient()).result),
    deployer,
  );
  note("get_market_count", (await squad.get_market_count()).result);
  note("get_accrued_fees", (await squad.get_accrued_fees()).result);
  note(
    "get_escrow_balance",
    unwrapResult("get_escrow_balance", (await squad.get_escrow_balance()).result),
  );

  console.log("");
  if (failures.length > 0) {
    console.error(`✗ VERIFY FAILED — ${failures.length} mismatch(es):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log("✓ DEPLOYMENT VERIFIED — every on-chain value matches .env.local");
}

main().catch((error) => {
  console.error("verify-deployment FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
