/**
 * Fund one external account — the social/"yapper" bot — from the oracle.
 *
 *   YAPPER_PUBLIC=G… npx tsx --env-file-if-exists=.env.local scripts/fund-yapper.ts
 *   YAPPER_PUBLIC=G… YAPPER_FUND_USDC=30 npx tsx ... scripts/fund-yapper.ts
 *
 * The recipient is an account Mimir does not hold the seed for, which is the whole
 * reason this script is separate from `fund-agents.ts`: that one provisions
 * accounts by having them buy their own USDC, and it can only do that for wallets
 * whose seed is in the env. Here the oracle has to send.
 *
 * ── The address is no longer hard-coded, and the gas leg is gone ─────────────
 *
 * The EVM version had the recipient address as a literal in the source and split
 * its work between "send ETH for gas" and "send USDC for stakes". Both are fixed:
 *
 *   address  now `YAPPER_PUBLIC` (or `YAPPER_ADDRESS`). A funding target baked
 *            into a committed file is a footgun the moment the bot is rotated.
 *   gas      an account that already exists needs no XLM top-up — a Stellar fee is
 *            ~0.00001 XLM. If the account does NOT exist, no amount of USDC can be
 *            sent to it (there is nothing to hold a trustline), so this reports
 *            that as the actionable problem instead of paying a fee to discover it.
 */

import { loadAgentWallet, transferUsdc } from "../lib/agent-wallets";
import { isAccountAddress } from "../lib/stellar";
import { envValue, explorerTxUrl } from "./lib/stellar-env";
import { readAccount } from "./lib/stellar-funding";

const TARGET_USDC = Number(process.env.YAPPER_FUND_USDC ?? "30");

async function main(): Promise<void> {
  const recipient = (envValue("YAPPER_PUBLIC") ?? envValue("YAPPER_ADDRESS") ?? "").trim();
  if (!isAccountAddress(recipient)) {
    throw new Error("set YAPPER_PUBLIC to the yapper's Stellar account (G…)");
  }

  const funder = loadAgentWallet("ORACLE_SECRET");
  const funderState = await readAccount(funder.address);
  console.log(
    `oracle ${funder.address}  ${funderState.xlm.toFixed(4)} XLM  ` +
      `${funderState.usdc === null ? "no USDC trustline" : `${funderState.usdc.toFixed(4)} USDC`}`,
  );

  const target = await readAccount(recipient);
  if (!target.exists) {
    throw new Error(
      `${recipient} does not exist on the ledger. Fund it with XLM first (friendbot on testnet), ` +
        `then it can add a USDC trustline and receive USDC.`,
    );
  }
  if (target.usdc === null) {
    throw new Error(
      `${recipient} holds no USDC trustline, so it cannot receive USDC. ` +
        `The yapper must add one itself — only the account holder can sign changeTrust.`,
    );
  }
  console.log(`yapper ${recipient}  ${target.xlm.toFixed(4)} XLM  ${target.usdc.toFixed(4)} USDC`);

  if (target.usdc >= TARGET_USDC) {
    console.log(`yapper USDC ok (${target.usdc.toFixed(4)} ≥ ${TARGET_USDC} target)`);
    return;
  }
  if (funderState.usdc === null) {
    throw new Error("the oracle holds no USDC trustline — run npm run agents:fund first");
  }

  const need = TARGET_USDC - target.usdc;
  if (funderState.usdc < need) {
    throw new Error(
      `oracle holds ${funderState.usdc.toFixed(4)} USDC but ${need.toFixed(4)} is needed — ` +
        `run npm run stellar:usdc to buy more on the SDEX.`,
    );
  }

  const hash = await transferUsdc({
    wallet: funder,
    to: recipient,
    amountUsdc: need.toFixed(7),
  });
  console.log(`yapper +${need.toFixed(4)} USDC  ${explorerTxUrl(hash)}`);
}

main().catch((error) => {
  console.error("fund-yapper failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
