/**
 * Queue Mimir's fee policy on chain, then execute it once the timelock elapses.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/queue-fee-policy.ts
 *   npx tsx --env-file-if-exists=.env.local scripts/queue-fee-policy.ts --execute
 *   npx tsx --env-file-if-exists=.env.local scripts/queue-fee-policy.ts --status
 *   npx tsx --env-file-if-exists=.env.local scripts/queue-fee-policy.ts --cancel
 *
 * The contract enforces a notice period between queueing and executing, so this is
 * deliberately two runs rather than one. Execution is permissionless afterwards —
 * a lost owner key must not be able to strand a change that was already announced.
 *
 * Rates come from FEE_SCHEDULE so the published number, the accounting module and
 * the chain cannot drift apart.
 *
 * ── What changed ────────────────────────────────────────────────────────────
 *
 *  - The hand-written `parseAbi([...])` block is gone. The four calls go through
 *    the generated bindings via `lib/contract.ts`, so a contract signature change
 *    is a type error here rather than a runtime decode failure.
 *  - `executableAt` is a UNIX SECOND from `env.ledger().timestamp()`, not a block
 *    number, so readiness is a wall-clock comparison — `lib/contract.ts` returns
 *    `ready` alongside it rather than leaving each caller to redo the arithmetic.
 *  - The owner signs with the Stellar keypair from `ORACLE_SECRET`; there is no
 *    receipt to wait for, because a Stellar transaction is final on inclusion.
 */

import {
  cancelFeePolicy,
  executeFeePolicy,
  getFeePolicy,
  getPendingFeePolicy,
  queueFeePolicy,
} from "../lib/contract";
import { loadAgentWallet } from "../lib/agent-wallets";
import { FEE_SCHEDULE } from "../lib/fees";
import { isAccountAddress, isContractAddress } from "../lib/stellar";
import { envValue } from "./lib/stellar-env";

function recipient(): string {
  const raw = envValue("PLATFORM_FEE_RECIPIENT");
  if (!raw || !(isAccountAddress(raw) || isContractAddress(raw))) {
    throw new Error("PLATFORM_FEE_RECIPIENT must be a valid Stellar address (G… or C…)");
  }
  return raw;
}

async function main(): Promise<void> {
  const mode = process.argv.includes("--execute")
    ? "execute"
    : process.argv.includes("--cancel")
      ? "cancel"
      : process.argv.includes("--status")
        ? "status"
        : "queue";

  const [active, pending] = await Promise.all([getFeePolicy(), getPendingFeePolicy()]);

  console.log(
    "Active   :",
    active
      ? `platform ${active.platform_fee_bps}bps · agentOwner ${active.agent_owner_fee_bps}bps · ${active.platform_recipient ?? "(none)"}`
      : "(unreadable — is the market contract id set?)",
  );
  if (pending) {
    const at = new Date(pending.executable_at * 1000);
    console.log(
      "Pending  :",
      `platform ${pending.platform_fee_bps}bps · agentOwner ${pending.agent_owner_fee_bps}bps · ${pending.platform_recipient ?? "(none)"}`,
    );
    console.log(
      "Executable:",
      at.toISOString(),
      pending.ready ? "(ready now)" : "(timelock still running)",
    );
  } else {
    console.log("Pending  : none");
  }
  if (mode === "status") return;

  const owner = loadAgentWallet("ORACLE_SECRET");
  console.log(`\nSigner   : ${owner.address}`);

  if (mode === "cancel") {
    if (!pending) throw new Error("nothing queued to cancel");
    const result = await cancelFeePolicy(owner.signer);
    console.log("Cancelled:", result.explorerUrl ?? result.txHash);
    return;
  }

  if (mode === "execute") {
    if (!pending) throw new Error("nothing queued to execute");
    if (!pending.ready) {
      throw new Error(
        `timelock has not elapsed — executable at ${new Date(pending.executable_at * 1000).toISOString()}`,
      );
    }
    const result = await executeFeePolicy(owner.signer);
    console.log("Executed:", result.explorerUrl ?? result.txHash);
    return;
  }

  const platformRecipient = recipient();
  console.log(
    `\nQueueing platform ${FEE_SCHEDULE.platformBps}bps + agentOwner ${FEE_SCHEDULE.agentOwnerBps}bps → ${platformRecipient}`,
  );
  const result = await queueFeePolicy(owner.signer, {
    platform_fee_bps: FEE_SCHEDULE.platformBps,
    agent_owner_fee_bps: FEE_SCHEDULE.agentOwnerBps,
    platform_recipient: platformRecipient,
  });
  console.log("Queued:", result.explorerUrl ?? result.txHash);
  console.log("Run again with --execute once the timelock has elapsed (--status to check).");
}

main().catch((error) => {
  console.error("queue-fee-policy failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
