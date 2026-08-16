import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Redirige tout import de `lib/supabase` vers le mock, sans toucher aux pages.
 * C'est ce qui garantit que la preview montre les vrais composants.
 */
function mockSupabase(): Plugin {
  return {
    name: 'mock-supabase',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!source.includes('lib/supabase') || source.includes('.mock')) return null
      const resolved = await this.resolve(source, importer, { skipSelf: true })
      if (resolved?.id.endsWith('/lib/supabase.ts')) {
        return resolved.id.replace(/supabase\.ts$/, 'supabase.mock.ts')
      }
      return null
    },
  }
}

/** Inline le CSS et le JS dans le HTML : l'aperçu doit tenir en un seul fichier. */
function inlineEverything(outDir: string): Plugin {
  return {
    name: 'inline-everything',
    closeBundle() {
      const htmlPath = resolve(outDir, 'demo.html')
      let html = readFileSync(htmlPath, 'utf8')

      html = html.replace(
        /<script type="module"[^>]*src="\/?([^"]+)"[^>]*><\/script>/g,
        (_m, src) =>
          `<script type="module">${readFileSync(resolve(outDir, src), 'utf8')}</script>`,
      )
      html = html.replace(
        /<link rel="stylesheet"[^>]*href="\/?([^"]+)"[^>]*>/g,
        (_m, href) => `<style>${readFileSync(resolve(outDir, href), 'utf8')}</style>`,
      )

      writeFileSync(resolve(outDir, 'index.html'), html)
      rmSync(resolve(outDir, 'assets'), { recursive: true, force: true })
      rmSync(htmlPath, { force: true })
    },
  }
}

const outDir = 'dist-demo'

export default defineConfig({
  plugins: [mockSupabase(), react(), tailwindcss(), inlineEverything(outDir)],
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: { input: resolve(__dirname, 'demo.html') },
  },
})
