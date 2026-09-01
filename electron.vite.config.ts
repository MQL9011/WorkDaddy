import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // Compact production syntax while retaining names and line-oriented output for diagnostics.
    esbuild: { minifyIdentifiers: false, minifySyntax: true, minifyWhitespace: false },
    build: { lib: { entry: 'electron/main/index.ts' }, minify: 'esbuild' },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: 'electron/preload/index.ts', formats: ['cjs'] },
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.js' } },
    },
  },
  renderer: {
    root: '.',
    plugins: [react()],
    // fileURLToPath, not URL.pathname: pathname percent-encodes non-ASCII path
    // segments, so the alias breaks under a directory with non-Latin characters.
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    build: {
      rollupOptions: {
        input: resolve('index.html'),
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            if (id.includes('/@xterm/')) return 'terminal-vendor'
            if (id.includes('/react-markdown/') || id.includes('/remark-') || id.includes('/unified/')) return 'markdown-vendor'
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react-vendor'
            if (id.includes('/lucide-react/')) return 'icons-vendor'
            return undefined
          },
        },
      },
    },
  },
})
