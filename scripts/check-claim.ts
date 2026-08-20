/**
 * Quick read of one claim's state on Stellar Testnet.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/check-claim.ts [claimId]
 *
 * Goes through `readClaimRaw` from `lib/contract.ts` rather than a raw invocation:
 * `get_claim` returns a NAMED struct through the generated bindings, so there is no
 * positional tuple to index into and no chance of reading `claim[8]` as the
 * deadline after a field is inserted above it.
 */
import { readClaimRaw } from "../lib/contract";
import { getExplorerContractUrl, requireMarketContractId } from "../lib/stellar";

async function main(): Promise<void> {
  const id = Number(process.argv[2] ?? "1");
  if (!Number.isInteger(id) || id <= 0) throw new Error("claim id must be a positive integer");

  const contractId = requireMarketContractId();
  const claim = await readClaimRaw(id);
  if (!claim) {
    console.log(`Claim #${id} not found on ${contractId}`);
    console.log(getExplorerContractUrl(contractId));
    process.exit(1);
  }

  const now = Math.floor(Date.now() / 1000);
  console.log(`Claim #${id}`);
  console.log(`  question   : ${claim.question}`);
  console.log(`  state      : ${claim.state}`);
  console.log(`  creator    : ${claim.creator}`);
  console.log(`  stake      : ${claim.creator_stake} USDC creator · ${claim.total_challenger_stake} USDC challengers`);
  console.log(`  challengers: ${claim.challenger_count}${claim.max_challengers ? ` / ${claim.max_challengers}` : ""}`);
  console.log(`  deadline   : ${new Date(claim.deadline * 1000).toISOString()}  (in ${claim.deadline - now}s)`);
  console.log(`  expired    : ${now > claim.deadline}`);
  if (claim.state === "resolved") {
    console.log(`  winner     : ${claim.winner_side} (${claim.confidence}% confidence)`);
    console.log(`  escrow left: ${claim.remaining_escrow ?? 0} USDC · ${claim.challenger_claims ?? 0} pulled`);
  }
  console.log(`\n${getExplorerContractUrl(contractId)}`);
}

main().catch((error) => {
  console.error("check-claim failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
