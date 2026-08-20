/**
 * Live proof that the Stellar x402 scheme works against real Testnet data.
 *
 * Not a unit test with fixtures: this generates a wallet, funds it from
 * Friendbot, buys real Circle Testnet USDC on the SDEX (the same
 * `pathPaymentStrictReceive` route `scripts/stellar-usdc-faucet.ts` uses), makes
 * a real USDC payment to the seller, and then runs the seller's own verify/settle
 * against the resulting transaction hash by reading Horizon.
 *
 * Every failure case is exercised against the SAME real transaction, so a passing
 * negative case cannot be a "the tx didn't exist either" false positive.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/x402-stellar-smoke.ts
 *
 * Needs: STELLAR_ORACLE_SECRET (the seller — it must already hold a USDC
 * trustline) and the NEXT_PUBLIC_STELLAR_* block. Costs a fraction of a cent.
 */

import { Asset, BASE_FEE, Horizon, Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

import {
  ExactStellarClient,
  ExactStellarFacilitator,
  ExactStellarScheme,
  LocalStellarFacilitatorClient,
  paymentProofMessage,
  parsePaymentProof,
  type StellarPaymentProof,
} from "../lib/x402/stellar-scheme";
import { PRICES, X402_ASSET, X402_NETWORK, X402_SCHEME } from "../lib/x402/config";
import { ensureFunded, walletFromKeypair } from "../lib/agent-wallets";
import { ensureUsdcTrustline, readUsdcTrustline } from "../lib/stellar-trustline";
import { NETWORK_PASSPHRASE, getExplorerTxUrl, getHorizonUrl } from "../lib/stellar";
import { USDC_CODE, USDC_ISSUER, formatAtomicUsdc } from "../lib/usdc";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";

const horizon = new Horizon.Server(getHorizonUrl());
const USDC = new Asset(USDC_CODE, USDC_ISSUER);

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

/** Buy USDC on the SDEX so the fresh buyer has something to spend. */
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
  if (!spot) throw new Error(`no XLM→USDC path on testnet for ${amount} USDC`);

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
  const sellerSecret = (process.env.STELLAR_ORACLE_SECRET ?? "").split(/\s+#/)[0].trim();
  if (!sellerSecret) throw new Error("STELLAR_ORACLE_SECRET is required (the seller)");
  const seller = Keypair.fromSecret(sellerSecret).publicKey();

  console.log("── Stellar x402 scheme, live against Testnet ──");
  console.log(`  network : ${X402_NETWORK}`);
  console.log(`  scheme  : ${X402_SCHEME}`);
  console.log(`  asset   : ${X402_ASSET}`);
  console.log(`  horizon : ${getHorizonUrl()}`);
  console.log(`  seller  : ${seller}\n`);

  const sellerLine = await readUsdcTrustline(seller);
  if (sellerLine.status !== "ready") {
    throw new Error(`seller ${seller} trustline is "${sellerLine.status}" — it cannot be paid USDC`);
  }

  // ── 1. Requirements, built exactly the way the resource server builds them ──
  const scheme = new ExactStellarScheme();
  const priced = await scheme.parsePrice(PRICES.premiumPrice, X402_NETWORK);
  const requirements: PaymentRequirements = {
    scheme: X402_SCHEME,
    network: X402_NETWORK,
    asset: priced.asset,
    amount: priced.amount,
    payTo: seller,
    maxTimeoutSeconds: 300,
    extra: priced.extra ?? {},
  };
  console.log("[1] price parsing");
  check("$0.001 → 7-decimal atomic units", priced.amount === "10000", `${priced.amount} (${formatAtomicUsdc(BigInt(priced.amount))} USDC)`);
  check("asset is the classic CODE:ISSUER id", priced.asset === X402_ASSET, priced.asset);
  check("decimals reported as 7", scheme.getAssetDecimals(priced.asset, X402_NETWORK) === 7);

  const supported = await new LocalStellarFacilitatorClient([X402_NETWORK]).getSupported();
  check(
    "local facilitator advertises the kind the server needs",
    supported.kinds.some((k) => k.x402Version === 2 && k.scheme === X402_SCHEME && k.network === X402_NETWORK),
    JSON.stringify(supported.kinds[0]),
  );

  // ── 2. A fresh, funded buyer ────────────────────────────────────────────────
  console.log("\n[2] provisioning a fresh buyer");
  const buyerKeypair = Keypair.random();
  const buyer = walletFromKeypair(buyerKeypair);
  console.log(`  buyer   : ${buyer.address}`);
  const funded = await ensureFunded(buyer.address);
  check("friendbot funded the account", funded.created, `${funded.xlm} XLM`);
  const trust = await ensureUsdcTrustline(buyer.signer);
  check("USDC trustline added", trust.added, trust.hash ?? "");
  await buyUsdc(buyerKeypair, "1");
  const buyerLine = await readUsdcTrustline(buyer.address);
  check("buyer holds real Circle testnet USDC", (buyerLine.balance ?? 0) >= 1, `${buyerLine.balance} USDC`);

  // ── 3. The buyer pays, for real ─────────────────────────────────────────────
  console.log("\n[3] buyer submits a real Stellar payment");
  const client = new ExactStellarClient(buyer);
  const created = await client.createPaymentPayload(2, requirements);
  const proof = parsePaymentProof(created.payload);
  if (!proof) throw new Error("the client produced a payload its own parser rejects");
  console.log(`  tx      : ${getExplorerTxUrl(proof.transaction)}`);
  check("payload is a well-formed proof", true, proof.kind);
  check("payer is the buyer", proof.payer === buyer.address);

  const payload = (p: StellarPaymentProof): PaymentPayload => ({
    x402Version: 2,
    accepted: requirements,
    payload: p as unknown as Record<string, unknown>,
  });

  // ── 4. The seller verifies it against Horizon ───────────────────────────────
  console.log("\n[4] seller verify() against live Horizon");
  const facilitator = new ExactStellarFacilitator();
  const verified = await facilitator.verify(payload(proof), requirements);
  check("verify accepts the real payment", verified.isValid, verified.invalidReason ?? "");
  check("verify reports the payer", verified.payer === buyer.address, verified.payer ?? "");

  // ── 5. Negative cases, all against the SAME real transaction ────────────────
  console.log("\n[5] verify() refusals");

  const tampered = { ...proof, signature: Buffer.alloc(64, 7).toString("base64") };
  check(
    "a forged signature is refused",
    (await facilitator.verify(payload(tampered), requirements)).invalidReason === "invalid_signature",
  );

  const stolen = { ...proof, payer: Keypair.random().publicKey() };
  check(
    "another account cannot claim this payment",
    (await facilitator.verify(payload(stolen), requirements)).invalidReason === "invalid_signature",
  );

  const dearer: PaymentRequirements = { ...requirements, amount: "1000000" };
  const dearerProof: StellarPaymentProof = {
    ...proof,
    signature: buyerKeypair
      .sign(
        Buffer.from(
          paymentProofMessage({
            network: dearer.network,
            transaction: proof.transaction,
            payTo: dearer.payTo,
            amount: dearer.amount,
            asset: dearer.asset,
          }),
          "utf8",
        ),
      )
      .toString("base64"),
  };
  check(
    "a payment cannot satisfy a dearer quote",
    (await facilitator.verify(payload(dearerProof), dearer)).invalidReason === "insufficient_amount",
  );

  const elsewhere: PaymentRequirements = { ...requirements, payTo: Keypair.random().publicKey() };
  const elsewhereProof: StellarPaymentProof = {
    ...proof,
    signature: buyerKeypair
      .sign(
        Buffer.from(
          paymentProofMessage({
            network: elsewhere.network,
            transaction: proof.transaction,
            payTo: elsewhere.payTo,
            amount: elsewhere.amount,
            asset: elsewhere.asset,
          }),
          "utf8",
        ),
      )
      .toString("base64"),
  };
  check(
    "a payment to someone else does not pay this seller",
    (await facilitator.verify(payload(elsewhereProof), elsewhere)).invalidReason === "no_matching_payment",
  );

  const ghost = { ...proof, transaction: "f".repeat(64) };
  check(
    "an invented transaction hash is refused",
    (await facilitator.verify(payload(ghost), requirements)).invalidReason === "invalid_signature",
    "signature binds the hash, so it fails before Horizon is even asked",
  );

  const stale = await facilitator.verify(payload(proof), requirements);
  check("the fresh payment is still inside the window", stale.isValid);
  const expired = await import("../lib/x402/stellar-scheme").then((m) =>
    m.verifyStellarPayment(proof as unknown as Record<string, unknown>, requirements, { maxAgeMs: 1, now: Date.now() + 60_000 }),
  );
  check("an out-of-window payment is refused", !expired.ok && expired.reason === "payment_too_old");

  const wrongNetwork = { ...proof, network: "stellar:pubnet" };
  const wrongNetworkResult = await facilitator.verify(payload(wrongNetwork), requirements);
  check("a proof for another network is refused", wrongNetworkResult.invalidReason === "network_mismatch");

  // ── 6. Settlement, and replay ───────────────────────────────────────────────
  console.log("\n[6] settle() and replay");
  const settled = await facilitator.settle(payload(proof), requirements);
  check("settle succeeds", settled.success, settled.errorReason ?? "");
  check("settle returns the tx hash as the identifier", settled.transaction === proof.transaction);
  check("settle books the quoted amount", settled.amount === requirements.amount, settled.amount ?? "");
  check("settle reports the payer", settled.payer === buyer.address);

  const replay = await facilitator.settle(payload(proof), requirements);
  check("the same proof cannot settle twice", !replay.success && replay.errorReason === "already_settled");
  const replayVerify = await facilitator.verify(payload(proof), requirements);
  check("and verify now refuses it too", replayVerify.invalidReason === "already_settled");

  console.log(
    failures === 0
      ? `\n✓ all checks passed against live Testnet data (tx ${proof.transaction})`
      : `\n✗ ${failures} check(s) failed`,
  );
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error("\nx402 stellar smoke FAILED:", error instanceof Error ? error.message : error);
  const extras = (error as { response?: { data?: unknown } })?.response?.data;
  if (extras) console.error(JSON.stringify(extras, null, 2));
  process.exit(1);
});
