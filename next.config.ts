import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  distDir: process.env.EBA_NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  // OAuth codes/state must never appear in Next's incoming request logs.
  logging: { incomingRequests: { ignore: [/\/api\/google\/callback(?:\?|$)/] } },
  serverExternalPackages: ["chess.js", "google-auth-library"],
  outputFileTracingIncludes: {
    "/api/calendar/sync": ["./node_modules/google-auth-library/**/*"],
    "/dashboard/calendar/api/**": ["./node_modules/google-auth-library/**/*"],
    "/api/google/**": ["./node_modules/google-auth-library/**/*", "./node_modules/gaxios/**/*", "./node_modules/gtoken/**/*"],
    "/dashboard/games": ["./node_modules/chess.js/**/*"],
    "/dashboard/games/**": ["./node_modules/chess.js/**/*"],
  },
  async redirects() {
    return [
      {
        source: "/accept-invitation",
        destination: "/sign-in",
        permanent: false,
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
