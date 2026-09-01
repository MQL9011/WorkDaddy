import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  // fileURLToPath, not URL.pathname: pathname percent-encodes non-ASCII path
  // segments, so the alias breaks under a directory with non-Latin characters.
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: [
        'electron/main/{browser-downloads,git,jsonl,plugins,process-utils,projects,providers,sessions,settings-schedules,store,terminal,validation}.ts',
        'electron/main/lib/**/*.ts',
        'electron/main/plugins/**/*.ts',
        'electron/main/agent-rpc/**/*.ts',
        'electron/main/browser/**/*.ts',
        'electron/main/sessions/**/*.ts',
        'src/lib/{events,extension-ui,render-bounds,workspace}.ts',
        'src/lib/events/**/*.ts',
        'src/hooks/useProviderCatalog.ts',
        'scripts/release/lib.mjs',
      ],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: {
        statements: 65,
        branches: 50,
        functions: 70,
        lines: 75,
      },
    },
  },
})
