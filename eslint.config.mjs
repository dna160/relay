// @ts-check
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  // The ignore glob matches every `.next` variant, not just the default one,
  // so that it agrees with the `.next-*` line in `.gitignore`.
  //
  // The two lists named the same intent — "this is build output" — and did not
  // name the same paths. A `distDir` of `.next-frontend` is gitignored and was
  // linted, so a second dev server running beside the first put nine thousand
  // errors from generated chunks into `npm run verify` and stopped the gate for
  // everybody. Same shape as DEFECT-6: two lists that must agree, kept by hand.
  { ignores: ['.next*/**', 'node_modules/**', 'src/db/migrations/**', 'playwright-report/**', 'test-results/**', 'next-env.d.ts'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
    },
  },
  {
    /**
     * ADR-019 — `.railway/**` is the file a new production environment is built
     * from, and dot-directories are skipped by tsc and eslint by default. It
     * was the only TypeScript here that nothing checked, which is exactly the
     * wrong file for that. Named explicitly so it is checked like everything
     * else.
     */
    files: ['.railway/**/*.ts'],
    rules: {},
  },
  {
    /**
     * CLAUDE.md: no non-null assertions on database reads. The rule is not in
     * `recommended`, so stating it in prose left it unenforced tree-wide —
     * reported by QA in round 1. Scoped to `src/` deliberately: the hazard is a
     * production row that turns out to be null, and narrowing the type is
     * always available instead (see `isPublished` in the client projection).
     * Test fixtures asserting `arr[0]!` after a length check carry no such
     * hazard, and 53 cosmetic edits there would buy nothing.
     */
    files: ['src/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'error' },
  },
  {
    // INV-9: business logic lives in src/domain and stays framework-free.
    // A domain file that imports Next, React, or the live db client has stopped
    // being domain logic and become a route handler wearing a disguise.
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['next', 'next/*', 'react', 'react-dom', 'server-only'], message: 'INV-9: src/domain must stay framework-free.' },
          { group: ['@/db/client', '@/lib/auth', '@/lib/storage', '@/lib/email'], message: 'INV-9: domain takes its dependencies as arguments; it does not reach for infrastructure.' },
        ],
      }],
    },
  },
);
