/**
 * Move a surplus XLM balance from the market-creator to the oracle.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/topup-oracle-from-creator.ts
 *   TOPUP_LEAVE_XLM=200 npx tsx ... scripts/topup-oracle-from-creator.ts
 *
 * ── Almost certainly not a script you need ──────────────────────────────────
 *
 * On the EVM chain this was routine: gas was scarce, the market-creator's
 * `createClaim` calls were the most expensive writes in the fleet, and the oracle
 * settling markets could genuinely run dry — so shuffling ETH between agents was a
 * regular chore, capped and reserved so neither side stranded itself.
 *
 * On Stellar the numbers make the chore pointless. Friendbot funds each account
 * with 10,000 XLM and an operation costs 100 stroops (0.00001 XLM), so an agent
 * would have to submit on the order of a billion operations before its balance
 * mattered. If the oracle is short of XLM, `npm run agents:fund` (Friendbot) is the
 * answer, not a transfer from another agent.
 *
 * It is kept, rewritten, for the two cases where moving a real balance is still the
 * right move:
 *
 *   1. A non-testnet deployment, where there is no Friendbot and XLM has to come
 *      from somewhere that already has it.
 *   2. Consolidating before rotating a key, so a retired account is not left
 *      holding a balance.
 *
 * It only ever moves XLM. USDC is the stake currency and belongs to whichever
 * agent earned it — `fund-from-oracle.ts` is the deliberate path for that.
 */

import { loadAgentWallet, transferXlm } from "../lib/agent-wallets";
import { STELLAR_NETWORK } from "../lib/stellar";
import { explorerTxUrl } from "./lib/stellar-env";
import { readAccount } from "./lib/stellar-funding";

/** Left on the creator so it keeps its base reserve and plenty of fee headroom. */
const LEAVE_XLM = Number(process.env.TOPUP_LEAVE_XLM ?? "100");
/** Below this there is nothing worth a transaction. */
const MIN_SEND_XLM = 1;

async function main(): Promise<void> {
  const creator = loadAgentWallet("CREATOR_SECRET");
  const oracle = loadAgentWallet("ORACLE_SECRET");

  const [creatorState, oracleState] = await Promise.all([
    readAccount(creator.address),
    readAccount(oracle.address),
  ]);

  console.log(`network : ${STELLAR_NETWORK}`);
  console.log(
    `creator ${creator.address}  ${creatorState.exists ? `${creatorState.xlm.toFixed(4)} XLM` : "does not exist"}`,
  );
  console.log(
    `oracle  ${oracle.address}  ${oracleState.exists ? `${oracleState.xlm.toFixed(4)} XLM` : "does not exist"}`,
  );

  if (!creatorState.exists) throw new Error("the market-creator account does not exist yet");
  if (!oracleState.exists) {
    // A payment to a non-existent account fails with `op_no_destination`; on
    // testnet the fix is Friendbot, not a transfer, so say so rather than trying.
    throw new Error(
      "the oracle account does not exist yet — run npm run agents:fund (friendbot creates it)",
    );
  }

  const send = Math.max(0, creatorState.xlm - LEAVE_XLM);
  if (send < MIN_SEND_XLM) {
    console.log(
      `\nNothing meaningful to send: the creator holds ${creatorState.xlm.toFixed(4)} XLM and ` +
        `${LEAVE_XLM} is reserved. At 0.00001 XLM per operation this is not a shortage — ` +
        `if the oracle needs XLM, run npm run agents:fund.`,
    );
    return;
  }

  const hash = await transferXlm({ wallet: creator, to: oracle.address, amountXlm: send.toFixed(7) });
  console.log(`\n✓ sent ${send.toFixed(4)} XLM → oracle  ${explorerTxUrl(hash)}`);

  const [afterCreator, afterOracle] = await Promise.all([
    readAccount(creator.address),
    readAccount(oracle.address),
  ]);
  console.log(`creator now ${afterCreator.xlm.toFixed(4)} XLM`);
  console.log(`oracle  now ${afterOracle.xlm.toFixed(4)} XLM`);
}

main().catch((error) => {
  console.error(
    "topup-oracle-from-creator failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
