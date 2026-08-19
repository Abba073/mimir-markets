/**
 * Acquire real Circle Testnet USDC for the deployer and oracle accounts.
 *
 * Circle's own testnet faucet (faucet.circle.com) is a captcha-gated web form
 * and cannot be automated. It is also not the only source: the Stellar Testnet
 * SDEX carries genuine XLM/USDC liquidity against Circle's issuer, so a
 * `pathPaymentStrictReceive` from an account to itself converts Friendbot XLM
 * into real USDC in one classic transaction. No mock, no wrapped test asset —
 * the resulting balance is the same `USDC:GBBD47…` the market contract escrows
 * through its SAC.
 *
 * Requires a USDC trustline, which `scripts/stellar-keys.ts` already creates.
 *
 *   npx tsx scripts/stellar-usdc-faucet.ts            # top up to 50 USDC each
 *   npx tsx scripts/stellar-usdc-faucet.ts --target 10
 */
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import {
  ENV_KEYS,
  HORIZON_URL,
  NETWORK_PASSPHRASE,
  USDC_CODE,
  USDC_ISSUER,
  explorerTxUrl,
  requireEnv,
} from "./lib/stellar-env";

const horizon = new Horizon.Server(HORIZON_URL);
const USDC = new Asset(USDC_CODE, USDC_ISSUER);

const targetIndex = process.argv.indexOf("--target");
const TARGET_USDC = targetIndex === -1 ? 50 : Number(process.argv[targetIndex + 1]);
if (!Number.isFinite(TARGET_USDC) || TARGET_USDC <= 0) throw new Error("--target must be > 0");

/** Tolerance over the quoted spot price, so a moving orderbook does not fail us. */
const SLIPPAGE = 1.5;

async function usdcBalance(publicKey: string): Promise<number> {
  const account = await horizon.loadAccount(publicKey);
  const line = account.balances.find(
    (b) =>
      "asset_code" in b && b.asset_code === USDC_CODE && "asset_issuer" in b && b.asset_issuer === USDC_ISSUER,
  );
  if (!line) throw new Error(`${publicKey} has no USDC trustline — run scripts/stellar-keys.ts first`);
  return Number(line.balance);
}

/** Ask Horizon what the SDEX will actually charge in XLM for `amount` USDC. */
async function quoteXlmCost(amount: string): Promise<string> {
  const url = new URL(`${HORIZON_URL}/paths/strict-receive`);
  url.searchParams.set("source_assets", "native");
  url.searchParams.set("destination_asset_type", "credit_alphanum4");
  url.searchParams.set("destination_asset_code", USDC_CODE);
  url.searchParams.set("destination_asset_issuer", USDC_ISSUER);
  url.searchParams.set("destination_amount", amount);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`horizon paths ${response.status}`);
  const body = (await response.json()) as { _embedded?: { records?: Array<{ source_amount: string }> } };
  const best = body._embedded?.records?.[0];
  if (!best) throw new Error(`no XLM→USDC path on testnet for ${amount} USDC`);
  return best.source_amount;
}

async function buyUsdc(keypair: Keypair, amount: string): Promise<void> {
  const spot = await quoteXlmCost(amount);
  const sendMax = (Number(spot) * SLIPPAGE).toFixed(7);
  console.log(`    SDEX quote: ${spot} XLM for ${amount} USDC (sendMax ${sendMax})`);

  const account = await horizon.loadAccount(keypair.publicKey());
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.pathPaymentStrictReceive({
        sendAsset: Asset.native(),
        sendMax,
        destination: keypair.publicKey(),
        destAsset: USDC,
        destAmount: amount,
        path: [],
      }),
    )
    .setTimeout(120)
    .build();
  transaction.sign(keypair);
  const result = await horizon.submitTransaction(transaction);
  console.log(`    ✓ ${explorerTxUrl(result.hash)}`);
}

async function topUp(role: string, secret: string): Promise<void> {
  const keypair = Keypair.fromSecret(secret);
  const before = await usdcBalance(keypair.publicKey());
  console.log(`[${role}] ${keypair.publicKey()} — ${before} USDC`);
  if (before >= TARGET_USDC) {
    console.log(`    already at or above the ${TARGET_USDC} USDC target`);
    return;
  }
  const needed = (TARGET_USDC - before).toFixed(7);
  await buyUsdc(keypair, needed);
  const after = await usdcBalance(keypair.publicKey());
  if (after <= before) throw new Error(`${role} USDC balance did not increase (${before} → ${after})`);
  console.log(`    ✓ ${role} now holds ${after} USDC`);
}

async function main(): Promise<void> {
  console.log("── Real testnet USDC via the Stellar SDEX ──");
  console.log(`  asset : ${USDC_CODE}:${USDC_ISSUER}`);
  console.log(`  target: ${TARGET_USDC} USDC per account\n`);
  await topUp("deployer", requireEnv(ENV_KEYS.deployerSecret));
  await topUp("oracle", requireEnv(ENV_KEYS.oracleSecret));
  console.log("\n✓ USDC funding complete");
}

main().catch((error) => {
  console.error("usdc-faucet FAILED:", error instanceof Error ? error.message : error);
  const extras = (error as { response?: { data?: unknown } })?.response?.data;
  if (extras) console.error(JSON.stringify(extras, null, 2));
  process.exit(1);
});
