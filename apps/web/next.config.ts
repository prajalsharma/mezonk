import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Database drivers load native/WASM assets at runtime; keep them out of the server bundle.
  serverExternalPackages: ["@electric-sql/pglite", "postgres", "drizzle-orm"],
  poweredByHeader: false,
  webpack(config) {
    // Optional peer modules pulled in by wallet SDK barrels (Coinbase CDP x402, WalletConnect logging).
    // MEZONK uses none of these code paths; stub them so the bundle resolves.
    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries(
        ["@x402/core", "@x402/evm", "@x402/svm", "@x402/express", "@x402/extensions", "@x402/fetch"].map((m) => [m, false]),
      ),
      "pino-pretty": false,
      lokijs: false,
      encoding: false,
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
