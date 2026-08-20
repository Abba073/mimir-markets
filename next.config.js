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
    resolveAlias: {
      // The x402 payment stack lazily imports its Solana scheme. Mimir does not
      // settle on Solana, so that branch never runs — but Turbopack resolves the
      // dynamic import statically and fails the build. Stub it instead of
      // installing a whole extra chain SDK for dead code. (The x402 layer itself
      // is ported in a separate phase; this alias stays until then.)
      "@x402/svm/exact/client": { browser: "./lib/x402/svm-stub.ts", default: "./lib/x402/svm-stub.ts" },
      // The former card-funding onramp stub is gone with the embedded-wallet
      // provider that pulled in a payments SDK. No alias needed: no Stellar wallet
      // module here imports one.
    },
  },
};

module.exports = withNextIntl(nextConfig);
