import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: { name: 'core', root: 'packages/core', include: ['test/**/*.test.ts'] },
  },
  {
    test: { name: 'api', root: 'apps/api', include: ['test/**/*.test.ts'] },
  },
  {
    test: { name: 'extension', root: 'apps/extension', include: ['test/**/*.test.ts'] },
  },
]);
