"use client";

/**
 * The one-time USDC trustline step, and the notice that asks for it.
 *
 * A Stellar account cannot hold USDC until it trusts the issuer, so a brand-new
 * wallet has one signature to get out of the way before its first stake. After
 * that every stake is a single signature — Soroban authorises per invocation, so
 * there is no allowance to grant and nothing to batch. See
 * `lib/stellar-trustline.ts` for why the trustline cannot ride along in the same
 * transaction as the stake (protocol: a Soroban transaction carries exactly one
 * operation).
 *
 * Renders NOTHING in the two states where there is nothing to do — trustline
 * present, or Horizon unreachable. An "add a trustline" prompt shown to someone
 * who already has one, because a read timed out, is worse than silence.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { useWallet } from "@/lib/wallet";
import {
  ensureUsdcTrustline,
  readUsdcTrustline,
  type TrustlineState,
} from "@/lib/stellar-trustline";

export interface UsdcTrustline extends TrustlineState {
  /** True while the first read is in flight. */
  loading: boolean;
  /** Signing is in flight. */
  adding: boolean;
  /** Add the trustline. Resolves true when the account can now hold USDC. */
  add: () => Promise<boolean>;
  refresh: () => void;
}

/**
 * Track the connected wallet's USDC trustline.
 *
 * Starts as `unknown` rather than `missing`: `unknown` renders nothing, so a slow
 * Horizon never flashes a setup prompt at someone who is already set up.
 */
export function useUsdcTrustline(): UsdcTrustline {
  const { address, signer } = useWallet();
  const [state, setState] = useState<TrustlineState>({ status: "unknown", balance: null });
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!address) {
      setState({ status: "unknown", balance: null });
      return;
    }
    let cancelled = false;
    setLoading(true);
    readUsdcTrustline(address)
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  const add = useCallback(async () => {
    if (!signer) return false;
    setAdding(true);
    try {
      await ensureUsdcTrustline(signer);
      const next = await readUsdcTrustline(signer.publicKey);
      setState(next);
      return next.status === "ready";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(
        /reject|denied|cancel/i.test(message)
          ? "Trustline signature rejected in your wallet."
          : message,
      );
      return false;
    } finally {
      setAdding(false);
    }
  }, [signer]);

  return { ...state, loading, adding, add, refresh };
}

export function UsdcTrustlineGate({
  trustline,
  className = "",
}: {
  /** Pass a shared instance when the parent already needs the state. */
  trustline?: UsdcTrustline;
  className?: string;
}) {
  const own = useUsdcTrustline();
  const state = trustline ?? own;

  if (state.status === "ready" || state.status === "unknown") return null;

  if (state.status === "unfunded") {
    return (
      <div
        className={`border border-amber-400/35 bg-amber-400/[0.06] p-4 ${className}`}
        role="status"
      >
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-amber-300">
          Account not funded
        </h3>
        <p className="mt-1 text-[12px] leading-relaxed text-pv-muted">
          This wallet has no account on the Stellar ledger yet. It needs a little XLM
          before it can hold USDC or sign anything — every Stellar account does, and
          Mimir cannot create one on your behalf.
        </p>
      </div>
    );
  }

  return (
    <div className={`border border-pv-emerald/35 bg-pv-emerald/[0.05] p-4 ${className}`}>
      <h3 className="font-mono text-[10px] uppercase tracking-wider text-pv-emerald">
        One-time setup
      </h3>
      <p className="mt-1 text-[12px] leading-relaxed text-pv-muted">
        Stellar accounts hold an asset only once they trust its issuer, so this wallet
        needs a USDC trustline before its first stake. One signature, once. After that
        every stake is a single signature — there is no allowance to approve.
      </p>
      <button
        type="button"
        onClick={() => void state.add()}
        disabled={state.adding}
        className="btn-compact-primary mt-3 px-3.5 py-1.5 text-[12px] disabled:opacity-40"
      >
        {state.adding ? "Confirm in wallet…" : "Add USDC trustline"}
      </button>
    </div>
  );
}
