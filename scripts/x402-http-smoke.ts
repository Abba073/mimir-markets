/**
 * End-to-end HTTP proof: a real agent wallet buys a real 402-guarded route.
 *
 * Where `scripts/x402-stellar-smoke.ts` exercises the scheme's verify/settle
 * directly, this one goes through the whole transport: `fetchWithBudget` hits the
 * paywall, reads the `PAYMENT-REQUIRED` quote, pays on Stellar, retries with
 * `PAYMENT-SIGNATURE`, and the server settles and writes a payments-ledger row.
 *
 * Needs a dev server already running, with a seller configured:
 *
 *   SELLER_ADDRESS=G… PASS_SECRET=… npx next dev -p 3021
 *   npx tsx --env-file-if-exists=.env.local scripts/x402-http-smoke.ts --base http://localhost:3021
 *
 * Costs a fraction of a cent per run.
 */

import { Asset, BASE_FEE, Horizon, Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

import { fetchWithBudget, payingWalletFor, PaymentBudgetExceeded } from "../lib/x402/buyer";
import { PRICES, priceToUsdcUnits } from "../lib/x402/config";
import { ensureFunded, walletFromKeypair } from "../lib/agent-wallets";
import { ensureUsdcTrustline, readUsdcTrustline } from "../lib/stellar-trustline";
import { NETWORK_PASSPHRASE, getExplorerTxUrl, getHorizonUrl } from "../lib/stellar";
import { USDC_CODE, USDC_ISSUER } from "../lib/usdc";

const baseIndex = process.argv.indexOf("--base");
const BASE = baseIndex === -1 ? "http://localhost:3021" : process.argv[baseIndex + 1];
const RESOURCE = `${BASE}/api/premium/price?symbol=bitcoin`;

const horizon = new Horizon.Server(getHorizonUrl());
const USDC = new Asset(USDC_CODE, USDC_ISSUER);

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function buyUsdc(keypair: Keypair, amount: string): Promise<void> {
  const url = new URL(`${getHorizonUrl()}/paths/strict-receive`);
  url.searchParams.set("source_assets", "native");
  url.searchParams.set("destination_asset_type", "credit_alphanum4");
  url.searchParams.set("destination_asset_code", USDC_CODE);
  url.searchParams.set("destination_asset_issuer", USDC_ISSUER);
  url.searchParams.set("destination_amount", amount);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`horizon paths ${response.status}`);
  const body = (await response.json()) as { _embedded?: { records?: Array<{ source_amount: string }> } };
  const spot = body._embedded?.records?.[0]?.source_amount;
  if (!spot) throw new Error(`no XLM→USDC path for ${amount} USDC`);

  const account = await horizon.loadAccount(keypair.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(
      Operation.pathPaymentStrictReceive({
        sendAsset: Asset.native(),
        sendMax: (Number(spot) * 1.5).toFixed(7),
        destination: keypair.publicKey(),
        destAsset: USDC,
        destAmount: amount,
        path: [],
      }),
    )
    .setTimeout(120)
    .build();
  tx.sign(keypair);
  await horizon.submitTransaction(tx);
}

async function main(): Promise<void> {
  console.log("── x402 over HTTP, live against Testnet ──");
  console.log(`  resource: ${RESOURCE}\n`);

  console.log("[1] the paywall refuses an unpaid request");
  const unpaid = await fetch(RESOURCE);
  check("status is 402", unpaid.status === 402, String(unpaid.status));
  const quoteHeader = unpaid.headers.get("payment-required");
  check("PAYMENT-REQUIRED header is present", Boolean(quoteHeader));
  const quote = quoteHeader
    ? (JSON.parse(Buffer.from(quoteHeader, "base64").toString("utf8")) as {
        accepts: Array<{ scheme: string; network: string; asset: string; amount: string; payTo: string }>;
      })
    : null;
  const accept = quote?.accepts?.[0];
  console.log(`  quote   : ${JSON.stringify(accept)}`);
  check("quote is exact/stellar", accept?.scheme === "exact" && accept?.network.startsWith("stellar:"));
  check("quote is denominated in classic USDC", accept?.asset.startsWith(`${USDC_CODE}:`) ?? false);
  check("quote is 7-decimal atomic units", accept?.amount === "10000", accept?.amount ?? "");

  console.log("\n[2] provisioning a fresh buyer");
  const keypair = Keypair.random();
  const wallet = walletFromKeypair(keypair);
  console.log(`  buyer   : ${wallet.address}`);
  await ensureFunded(wallet.address);
  await ensureUsdcTrustline(wallet.signer);
  await buyUsdc(keypair, "1");
  const before = (await readUsdcTrustline(wallet.address)).balance ?? 0;
  check("buyer holds USDC", before >= 1, `${before} USDC`);

  console.log("\n[3] the budget cap refuses to pay before any money moves");
  const payer = payingWalletFor(wallet);
  let walkedAway = false;
  try {
    await fetchWithBudget(RESOURCE, payer, 1n);
  } catch (error) {
    walkedAway = error instanceof PaymentBudgetExceeded;
  }
  check("an over-budget quote throws PaymentBudgetExceeded", walkedAway);
  check(
    "and no USDC left the wallet",
    ((await readUsdcTrustline(wallet.address)).balance ?? 0) === before,
  );

  console.log("\n[4] a budgeted purchase goes through");
  const cap = priceToUsdcUnits(PRICES.premiumPrice) * 2n;
  const { response, payment } = await fetchWithBudget(RESOURCE, payer, cap);
  check("the paid retry returned 200", response.status === 200, String(response.status));
  const body = (await response.json()) as Record<string, unknown>;
  check("the paid body is the premium price snapshot", typeof body.price_usd === "number", JSON.stringify(body).slice(0, 120));
  check("PAYMENT-RESPONSE reports a settlement", payment !== null);
  if (payment) {
    console.log(`  tx      : ${getExplorerTxUrl(payment.txHash)}`);
    check("settled amount matches the quote", payment.priceUnits === priceToUsdcUnits(PRICES.premiumPrice), payment.priceUnits.toString());
    check("settlement carries a Stellar tx hash", /^[0-9a-f]{64}$/.test(payment.txHash), payment.txHash);
  }
  const after = (await readUsdcTrustline(wallet.address)).balance ?? 0;
  check("the buyer's USDC actually decreased", after < before, `${before} → ${after} USDC`);

  console.log("\n[5] the payments ledger recorded it");
  const revenue = (await (await fetch(`${BASE}/api/payments/revenue`)).json()) as {
    recent?: Array<{ resource: string; payer: string | null; transactionHash: string | null; amountUsdc: number }>;
  };
  const row = revenue.recent?.find((r) => r.transactionHash === payment?.txHash);
  check("a row exists for this transaction", Boolean(row), JSON.stringify(row));
  check("the row names the resource", row?.resource === "/api/premium/price", row?.resource ?? "");
  check("the row books 0.001 USDC", row?.amountUsdc === 0.001, String(row?.amountUsdc));

  console.log("\n[6] the same proof cannot be replayed");
  const replay = await fetch(RESOURCE, {
    headers: { "payment-signature": replayHeader(payment?.txHash ?? "", wallet.address) },
  });
  check("a hand-rolled replay is refused", replay.status === 402, String(replay.status));

  // The council pass route is the one that reads the payer back out of the
  // verified PAYMENT-SIGNATURE header (paymentPayer), so it proves that path too.
  console.log("\n[7] a paid POST, and the handler can read the payer");
  const pass = await fetchWithBudget(`${BASE}/api/council/subscribe`, payer, priceToUsdcUnits(PRICES.councilSubscribe) * 2n, {
    method: "POST",
  });
  check("the pass route returned 200", pass.response.status === 200, String(pass.response.status));
  // text() then parse, so an empty or non-JSON body is a readable failure rather
  // than "Unexpected end of JSON input" with no clue which step produced it.
  const passText = await pass.response.text();
  console.log(`  tx      : ${pass.payment ? getExplorerTxUrl(pass.payment.txHash) : "(none)"}`);
  const passBody = (passText ? JSON.parse(passText) : {}) as { payer?: string; pass?: string };
  check("paymentPayer() recovered the G… payer verbatim", passBody.payer === wallet.address, passBody.payer ?? "");
  check("a pass was issued", typeof passBody.pass === "string" && passBody.pass.length > 0);

  console.log(failures === 0 ? "\n✓ all HTTP checks passed" : `\n✗ ${failures} check(s) failed`);
  if (failures > 0) process.exit(1);
}

/**
 * A payload reusing an already-settled transaction hash. The signature is
 * garbage on purpose: the point is that the server refuses it, and a valid
 * signature over the same hash is refused for `already_settled` anyway.
 */
function replayHeader(transaction: string, payer: string): string {
  const payload = {
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "stellar:testnet",
      asset: `${USDC_CODE}:${USDC_ISSUER}`,
      amount: "10000",
      payTo: process.env.SELLER_ADDRESS ?? "",
      maxTimeoutSeconds: 300,
      extra: {},
    },
    payload: {
      kind: "stellar-payment-v1",
      network: "stellar:testnet",
      transaction,
      payer,
      signature: Buffer.alloc(64, 1).toString("base64"),
    },
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

main().catch((error) => {
  console.error("\nx402 http smoke FAILED:", error instanceof Error ? error.message : error);
  const extras = (error as { response?: { data?: unknown } })?.response?.data;
  if (extras) console.error(JSON.stringify(extras, null, 2));
  process.exit(1);
});
