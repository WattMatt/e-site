import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // `server-only` is not installed here — Next aliases it at build time.
      // Resolve it to an empty stub so server modules can import it verbatim
      // and tests can vi.mock it. See src/test/server-only-stub.ts.
      'server-only': path.resolve(__dirname, './src/test/server-only-stub.ts'),
    },
  },
})
