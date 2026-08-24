// @ts-check
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['.next/**', 'node_modules/**', 'src/db/migrations/**', 'playwright-report/**', 'test-results/**'] },
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
  {
    // The client projection is the one serialiser a client contact reaches (INV-1).
    // A non-null assertion here is how an unpublished version leaks.
    files: ['src/domain/projection/client-view.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
