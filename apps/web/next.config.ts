import type { NextConfig } from 'next'

import path from 'path'

import { buildContentSecurityPolicy } from './src/lib/security/csp'

const config: NextConfig = {
  transpilePackages: ['@esite/shared', '@esite/db'],
  // Point Next.js at the monorepo root so file tracing works correctly
  outputFileTracingRoot: path.join(__dirname, '../../'),

  // These libraries have binary-handling internals that Next.js's server
  // bundler mishandles — webpack-bundling corrupts them so they throw at
  // runtime even though the build succeeds. Mark them external so Node
  // resolves them (and their assets) from node_modules at runtime.
  //   • docxtemplater + pizzip — zip-stream internals; loaded by
  //     generateLetterAction (sub-path imported, not in any shared barrel).
  //   • @react-pdf/renderer — yoga-layout (WASM) + fontkit AFM font data;
  //     loaded by the branding-preview route + reports engine
  //     (apps/web/src/lib/reports). Without this, renderToBuffer() fails on
  //     Vercel with "PDF render failed" while unit tests (real node_modules)
  //     pass.
  serverExternalPackages: ['docxtemplater', 'pizzip', '@react-pdf/renderer'],

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
  //
  // `/` no longer redirects — it now renders the public landing page (see
  // apps/web/src/app/(public)/page.tsx). Authed-user redirect to /dashboard
  // happens inside that page so the other public routes don't run auth.
  //
  // The /acceptable-use, /privacy, and /terms legacy paths are aliased to
  // the canonical /legal/* URLs that ship in the Paystack KYC response
  // email. /cookies and /privacy/request remain at their original paths
  // since they live under a different content surface.
  async redirects() {
    return [
      { source: '/acceptable-use', destination: '/legal/acceptable-use-policy', permanent: true },
      { source: '/privacy',        destination: '/legal/privacy',               permanent: true },
      { source: '/terms',          destination: '/legal/terms',                 permanent: true },
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
    // Markup PNG payloads (base64) can exceed the 1 MB default — drawings
    // are typically ~5 MB raster after the canvas flattens at pixelRatio 2.
    serverActions: { bodySizeLimit: '10mb' },
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

  // ─── Vercel file tracing — binary assets read at runtime ─────────────────
  // The generateLetterAction reads .docx templates via readFileSync. Without
  // this, Vercel's file-tracing step omits them from the server bundle.
  outputFileTracingIncludes: {
    '/projects/[id]/jbcc/notice/[code]/new': ['./src/lib/jbcc/templates/**'],
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
            // Built in src/lib/security/csp.ts so the policy is unit-tested —
            // frame-src must permit the preview <iframe> sources (see csp.test.ts).
            value: buildContentSecurityPolicy({ dev: process.env.NODE_ENV !== 'production' }),
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
