/**
 * Bootstrap the Stellar Testnet accounts the Soroban deploy needs:
 *
 *   1. Generate a deployer and an oracle keypair, but only if they are not
 *      already configured (`STELLAR_DEPLOYER_SECRET` / `STELLAR_ORACLE_SECRET`
 *      in the environment or in `.env.local`). Existing secrets are never
 *      clobbered.
 *   2. Fund each account from Friendbot (10,000 XLM, free, no auth).
 *   3. Confirm via Horizon that each account exists with a real XLM balance.
 *   4. Add a `changeTrust` trustline to Circle's Testnet USDC on both accounts.
 *
 * Secrets are written to `.env.local` (gitignored via `.env*.local`) and are
 * never printed. Public keys are printed.
 *
 *   npx tsx scripts/stellar-keys.ts
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
  ENV_LOCAL_PATH,
  FRIENDBOT_URL,
  HORIZON_URL,
  NETWORK_PASSPHRASE,
  USDC_CODE,
  USDC_ISSUER,
  envValue,
  writeEnvLocal,
} from "./lib/stellar-env";

const horizon = new Horizon.Server(HORIZON_URL);
const USDC = new Asset(USDC_CODE, USDC_ISSUER);

interface RoleAccount {
  role: "deployer" | "oracle";
  keypair: Keypair;
  generated: boolean;
}

function resolveKeypair(role: RoleAccount["role"], secretEnvKey: string): RoleAccount {
  const existing = envValue(secretEnvKey);
  if (existing) {
    let keypair: Keypair;
    try {
      keypair = Keypair.fromSecret(existing);
    } catch {
      throw new Error(`${secretEnvKey} is set but is not a valid Stellar secret seed (S...)`);
    }
    return { role, keypair, generated: false };
  }
  return { role, keypair: Keypair.random(), generated: true };
}

async function accountExists(publicKey: string): Promise<boolean> {
  try {
    await horizon.loadAccount(publicKey);
    return true;
  } catch (error) {
    if ((error as { response?: { status?: number } })?.response?.status === 404) return false;
    throw error;
  }
}

async function fundWithFriendbot(publicKey: string): Promise<void> {
  const response = await fetch(`${FRIENDBOT_URL}/?addr=${encodeURIComponent(publicKey)}`);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`friendbot ${response.status} for ${publicKey}: ${body.slice(0, 400)}`);
  }
  await response.json().catch(() => undefined);
}

async function nativeBalance(publicKey: string): Promise<string> {
  const account = await horizon.loadAccount(publicKey);
  const native = account.balances.find((balance) => balance.asset_type === "native");
  if (!native) throw new Error(`${publicKey} has no native balance entry`);
  return native.balance;
}

function hasUsdcTrustline(
  balances: Awaited<ReturnType<Horizon.Server["loadAccount"]>>["balances"],
): boolean {
  return balances.some(
    (balance) =>
      "asset_code" in balance &&
      balance.asset_code === USDC_CODE &&
      "asset_issuer" in balance &&
      balance.asset_issuer === USDC_ISSUER,
  );
}

/**
 * Classic `changeTrust`. Does NOT require issuer authorization to submit — the
 * trustline is created either way. Whether it lands `authorized` depends on the
 * issuer's `auth_required` flag, which is reported below.
 */
async function ensureUsdcTrustline(keypair: Keypair): Promise<"created" | "already-present"> {
  const account = await horizon.loadAccount(keypair.publicKey());
  if (hasUsdcTrustline(account.balances)) return "already-present";

  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(60)
    .build();
  transaction.sign(keypair);
  const result = await horizon.submitTransaction(transaction);
  console.log(`    changeTrust tx ${result.hash}`);
  return "created";
}

async function reportIssuerFlags(): Promise<void> {
  const issuer = await horizon.loadAccount(USDC_ISSUER);
  const flags = issuer.flags;
  console.log("\n── USDC issuer (Circle, testnet) ──");
  console.log(`  issuer      : ${USDC_ISSUER}`);
  console.log(`  home_domain : ${issuer.home_domain ?? "(none)"}`);
  console.log(`  auth_required        : ${flags.auth_required}`);
  console.log(`  auth_revocable       : ${flags.auth_revocable}`);
  console.log(`  auth_immutable       : ${flags.auth_immutable}`);
  console.log(`  auth_clawback_enabled: ${flags.auth_clawback_enabled}`);
  console.log(
    flags.auth_required
      ? "  → AUTH_REQUIRED is ON: the trustline exists but stays unauthorized until\n" +
          "    Circle authorizes it. Receiving USDC needs that manual Circle step."
      : "  → AUTH_REQUIRED is OFF: the trustline is authorized on creation, so the\n" +
          "    account can receive USDC as soon as it is sent (Circle faucet).",
  );
  if (flags.auth_revocable) {
    console.log(
      "  → AUTH_REVOCABLE is ON: Circle can freeze a trustline later. The market\n" +
        "    contract's push_or_park fallback already covers a frozen recipient.",
    );
  }
}

async function main(): Promise<void> {
  const accounts: RoleAccount[] = [
    resolveKeypair("deployer", ENV_KEYS.deployerSecret),
    resolveKeypair("oracle", ENV_KEYS.oracleSecret),
  ];

  console.log("── Stellar Testnet account bootstrap ──");
  console.log(`  horizon : ${HORIZON_URL}`);
  console.log(`  env file: ${ENV_LOCAL_PATH}\n`);

  for (const account of accounts) {
    const publicKey = account.keypair.publicKey();
    console.log(
      `[${account.role}] ${publicKey} (${account.generated ? "newly generated" : "reused from env"})`,
    );

    if (await accountExists(publicKey)) {
      console.log("    already funded on testnet");
    } else {
      console.log("    funding via friendbot…");
      await fundWithFriendbot(publicKey);
    }

    const balance = await nativeBalance(publicKey);
    if (Number(balance) <= 0) throw new Error(`${account.role} ${publicKey} has zero XLM`);
    console.log(`    ✓ horizon confirms account exists, ${balance} XLM`);

    const trustline = await ensureUsdcTrustline(account.keypair);
    const refreshed = await horizon.loadAccount(publicKey);
    const usdcLine = refreshed.balances.find(
      (b) => "asset_code" in b && b.asset_code === USDC_CODE && "asset_issuer" in b && b.asset_issuer === USDC_ISSUER,
    );
    if (!usdcLine) throw new Error(`${account.role} USDC trustline not visible after ${trustline}`);
    const authorized =
      "is_authorized" in usdcLine ? (usdcLine.is_authorized as boolean | undefined) : undefined;
    console.log(
      `    ✓ USDC trustline ${trustline} — balance ${usdcLine.balance}, authorized=${authorized ?? "n/a"}`,
    );
  }

  const [deployer, oracle] = accounts;
  writeEnvLocal(
    {
      [ENV_KEYS.deployerSecret]: deployer.keypair.secret(),
      [ENV_KEYS.deployerPublic]: deployer.keypair.publicKey(),
      [ENV_KEYS.oracleSecret]: oracle.keypair.secret(),
      [ENV_KEYS.oraclePublic]: oracle.keypair.publicKey(),
      [ENV_KEYS.network]: "testnet",
      [ENV_KEYS.networkPassphrase]: NETWORK_PASSPHRASE,
      [ENV_KEYS.rpcUrl]: "https://soroban-testnet.stellar.org",
      [ENV_KEYS.horizonUrl]: HORIZON_URL,
      [ENV_KEYS.usdcIssuer]: USDC_ISSUER,
    },
    { header: "# ── Stellar Testnet (written by scripts/stellar-keys.ts) ──" },
  );
  console.log("\n  secrets + public keys written to .env.local (gitignored)");

  await reportIssuerFlags();

  console.log("\n── Public keys ──");
  console.log(`  STELLAR_DEPLOYER_PUBLIC=${deployer.keypair.publicKey()}`);
  console.log(`  STELLAR_ORACLE_PUBLIC=${oracle.keypair.publicKey()}`);
  console.log("\n✓ account bootstrap complete");
}

main().catch((error) => {
  console.error("stellar-keys FAILED:", error instanceof Error ? error.message : error);
  const extras = (error as { response?: { data?: unknown } })?.response?.data;
  if (extras) console.error(JSON.stringify(extras, null, 2));
  process.exit(1);
});
