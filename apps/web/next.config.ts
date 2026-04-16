import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@esite/shared', '@esite/db'],

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
    // Partial pre-rendering: page shells render at build time; data streams in
    ppr: 'incremental',
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
