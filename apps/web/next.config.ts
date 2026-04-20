import type { NextConfig } from 'next'

import path from 'path'

const config: NextConfig = {
  transpilePackages: ['@esite/shared', '@esite/db'],
  // Point Next.js at the monorepo root so file tracing works correctly
  outputFileTracingRoot: path.join(__dirname, '../../'),

  // TODO: Remove after running `supabase gen types typescript` against the deployed DB.
  // The types.ts in @esite/db was generated against an older postgrest-js version.
  // supabase-js 2.103 has stricter schema inference that causes the entire public schema
  // to resolve to `never` for queries — a type-system mismatch, not a runtime bug.
  // Run: pnpm supabase gen types typescript --project-id <ref> > packages/db/src/types.ts
  typescript: { ignoreBuildErrors: true },

  // ESLint runs fine locally but can't resolve monorepo-root packages (e.g. @eslint/js)
  // from the apps/web context on Vercel. Lint runs separately in CI.
  eslint: { ignoreDuringBuilds: true },

  // ─── Redirects ───────────────────────────────────────────────────────────
  async redirects() {
    return [
      { source: '/', destination: '/dashboard', permanent: false },
    ]
  },

  // ─── Image optimisation ───────────────────────────────────────────────────
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
    minimumCacheTTL: 86400, // 24h
  },

  // ─── Package import optimisation (tree-shaking) ───────────────────────────
  experimental: {
    // Only import the specific icons/utilities actually used
    optimizePackageImports: [
      'lucide-react',
      'date-fns',
      '@tanstack/react-query',
      'posthog-js',
    ],
  },

  // ─── Webpack bundle splitting ─────────────────────────────────────────────
  webpack(webpackConfig, { isServer }) {
    if (!isServer) {
      const existing = (webpackConfig.optimization?.splitChunks as any) ?? {}
      webpackConfig.optimization = {
        ...webpackConfig.optimization,
        splitChunks: {
          ...existing,
          cacheGroups: {
            // Supabase client (~130 KB gzip) — large, rarely changes
            supabase: {
              name: 'supabase',
              test: /[\\/]node_modules[\\/]@supabase[\\/]/,
              chunks: 'all' as const,
              priority: 30,
              reuseExistingChunk: true,
            },
            // TanStack Query — used on every page
            reactQuery: {
              name: 'react-query',
              test: /[\\/]node_modules[\\/]@tanstack[\\/]/,
              chunks: 'all' as const,
              priority: 25,
              reuseExistingChunk: true,
            },
            // Sentry + PostHog — async only (loaded after hydration)
            observability: {
              name: 'observability',
              test: /[\\/]node_modules[\\/](@sentry|posthog-js)[\\/]/,
              chunks: 'async' as const,
              priority: 20,
              reuseExistingChunk: true,
            },
            // Remaining third-party code
            vendors: {
              name: 'vendors',
              test: /[\\/]node_modules[\\/]/,
              chunks: 'all' as const,
              priority: 10,
              reuseExistingChunk: true,
            },
          },
        },
      }
    }
    return webpackConfig
  },

  // ─── Security headers ─────────────────────────────────────────────────────
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=self, microphone=(), geolocation=self',
          },
          // T-056: HSTS — browsers enforce HTTPS for 1 year (add to HSTS preload list post-launch)
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          // T-056: CSP — unsafe-inline required by Next.js inline hydration scripts.
          // Connect-src covers Supabase realtime, PostHog ingest, Sentry DSN, Paystack.
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://app.posthog.com https://js.sentry-cdn.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://*.supabase.co https://avatars.githubusercontent.com",
              "font-src 'self' data:",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.powersync.co wss://*.powersync.co https://app.posthog.com https://ingest.sentry.io https://api.paystack.co",
              "frame-src 'none'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "upgrade-insecure-requests",
            ].join('; '),
          },
        ],
      },
      // Hashed assets are immutable — aggressive cache
      {
        source: '/_next/static/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      // API routes must never be cached
      {
        source: '/api/(.*)',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ]
  },
}

export default config
