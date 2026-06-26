import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Force ASCII-only output. Some environments emit the bundle in an
  // encoding Chrome rejects ("not UTF-8") when raw non-ASCII bytes (→, ×,
  // Cyrillic, the Dexie U+FFFF constant) are present. Escaping them as \uXXXX
  // sidesteps the whole problem.
  vite: () => ({
    esbuild: { charset: 'ascii' },
    build: { target: 'es2021' },
  }),
  manifest: {
    name: 'VocabFlow',
    description: 'Learn vocabulary from the pages you read.',
    // We need to read selections and show review cards on any page.
    // This triggers a broader permission prompt and a stricter store
    // review — it is the price of the in-page tooltip + review overlay.
    permissions: ['storage', 'alarms', 'tabs'],
    host_permissions: ['<all_urls>'],
  },
});
