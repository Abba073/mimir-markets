const createNextIntlPlugin = require("next-intl/plugin");
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        // frame-src is listed explicitly. Without it these fall back to
        // default-src 'self', which blocks the frames the hosted Stellar signers
        // open — the connect flow then fails with a generic "could not connect"
        // and nothing in the network tab, because the frame never loaded. Named
        // origins rather than https:, so a compromised third-party script still
        // cannot frame anything.
        //
        // Only two entries are needed now, and neither is a relay: xBull signs in
        // an iframe it serves from wallet.xbull.app, and Albedo signs in a popup
        // at albedo.link (a popup is governed by Cross-Origin-Opener-Policy
        // below, but it is listed here too because Albedo falls back to an iframe
        // when popups are blocked). Freighter, Lobstr and Hana are browser
        // extensions and frame nothing.
        { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https: wss:; frame-src 'self' https://wallet.xbull.app https://albedo.link; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests" },
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
      ],
    }];
  },
  // Pin Turbopack's workspace root. A stray ~/package-lock.json makes Next infer
  // the wrong root (C:\Users\enliven) and serve an empty app dir → every route
  // 404s. Anchoring to this file's dir fixes dev and prod builds alike.
  turbopack: {
    root: __dirname,
    // No resolveAlias entries. Both stubs that used to live here existed to
    // satisfy a dynamic import inside the embedded-wallet SDK's dependency tree —
    // an unreachable Solana branch and a card-funding onramp — and that SDK is
    // gone. Mimir's own x402 scheme (lib/x402/stellar-scheme.ts) imports only
    // @x402/core and @stellar/stellar-sdk, neither of which lazily resolves a
    // chain module Turbopack cannot find.
  },
};

module.exports = withNextIntl(nextConfig);
