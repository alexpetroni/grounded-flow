import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import swc from 'unplugin-swc';

const aliases = {
  '@app/config': resolve(__dirname, 'libs/config/src/index.ts'),
  '@app/core': resolve(__dirname, 'libs/core/src/index.ts'),
  '@app/llm': resolve(__dirname, 'libs/llm/src/index.ts'),
  '@app/rag': resolve(__dirname, 'libs/rag/src/index.ts'),
  '@app/database': resolve(__dirname, 'libs/database/src/index.ts'),
  '@app/observability': resolve(__dirname, 'libs/observability/src/index.ts'),
};

const swcPlugin = swc.vite({
  module: { type: 'es6' },
  jsc: {
    parser: { syntax: 'typescript', decorators: true, dynamicImport: true },
    transform: { decoratorMetadata: true, legacyDecorator: true },
    target: 'es2022',
  },
});

export default defineConfig({
  plugins: [swcPlugin],
  esbuild: false,
  resolve: { alias: aliases },
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['libs/core/src/**', 'libs/rag/src/**', 'libs/database/src/**'],
      thresholds: {
        lines: 80,
      },
    },
    projects: [
      {
        plugins: [swcPlugin],
        test: {
          name: 'unit',
          include: ['libs/**/*.spec.ts', 'apps/**/*.spec.ts'],
          exclude: ['**/node_modules/**', '**/*.integration.spec.ts', '**/*.e2e.spec.ts'],
          environment: 'node',
        },
        resolve: { alias: aliases },
      },
      {
        plugins: [swcPlugin],
        test: {
          name: 'integration',
          include: ['libs/**/*.integration.spec.ts', 'apps/**/*.integration.spec.ts'],
          exclude: ['**/node_modules/**'],
          environment: 'node',
          testTimeout: 60000,
        },
        resolve: { alias: aliases },
      },
      {
        plugins: [swcPlugin],
        test: {
          name: 'e2e',
          include: ['test/**/*.e2e.spec.ts'],
          exclude: ['test/setup.ts'],
          environment: 'node',
          testTimeout: 60000,
          setupFiles: ['./test/setup.ts'],
        },
        resolve: { alias: aliases },
      },
    ],
  },
});
