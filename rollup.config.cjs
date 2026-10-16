const { defineConfig } = require('rollup');
const esbuildModule = require('rollup-plugin-esbuild');
const esbuild =
  typeof esbuildModule === 'function' ? esbuildModule : esbuildModule.default;

const external = (id) =>
  !id.startsWith('.') &&
  !id.startsWith('/') &&
  !/^[A-Za-z]:[\\/]/.test(id);

const plugins = () => [esbuild()];

module.exports = defineConfig([
  {
    input: 'middleware.ts',
    output: {
      file: 'dist/middleware.js',
      format: 'esm',
      inlineDynamicImports: true,
    },
    external,
    plugins: plugins(),
  },
  {
    input: 'src/bot.ts',
    output: {
      dir: 'dist/lib/',
      format: 'esm',
      inlineDynamicImports: false,
    },
    external,
    plugins: [esbuild({ include: 'src/*.ts' })],
  },
  {
    input: 'src/index.ts',
    output: {
      dir: 'dist/',
      format: 'esm',
      inlineDynamicImports: false,
    },
    external,
    plugins: plugins(),
  },
  {
    input: ['api/github/webhooks/index.ts'],
    output: { dir: 'dist/api/github/webhooks', format: 'esm' },
    external,
    plugins: plugins(),
  },
  {
    input: ['api/kawnix/invoke/index.ts'],
    output: { dir: 'dist/api/kawnix/invoke', format: 'esm' },
    external,
    plugins: plugins(),
  },
  {
    input: ['api/kawnix/worker/index.ts'],
    output: { dir: 'dist/api/kawnix/worker', format: 'esm' },
    external,
    plugins: plugins(),
  },
  {
    input: ['api/kawnix/maintenance/index.ts'],
    output: { dir: 'dist/api/kawnix/maintenance', format: 'esm' },
    external,
    plugins: plugins(),
  },
  {
    input: ['src/kawnix-preflight.ts'],
    output: { file: 'dist/kawnix-preflight.js', format: 'esm' },
    external,
    plugins: plugins(),
  },
]);
