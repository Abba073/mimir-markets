/**
 * Barrel **seguro para cualquier contexto** (solo reexporta config sin `@xmtp/browser-sdk`).
 *
 * El **signer** vive en `./signer` — importarlo solo desde `"use client"`:
 * `import { createXmtpSignerForStellarAccount } from "@/lib/xmtp/signer"`.
 * La derivación de la identidad de inbox vive en `./identity` (sin dependencia
 * del SDK, pero pensada para el navegador).
 */
export {
  getXmtpAppVersion,
  getXmtpClientCreateOptions,
  getXmtpEnv,
  isXmtpFeatureEnabled,
  type XmtpNetworkEnv,
} from "./config";
