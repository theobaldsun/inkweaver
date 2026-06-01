import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/images/index.ts', 'src/fonts/index.ts', 'src/styles/index.ts'],
  format: ['esm', 'cjs'],
  outExtension({ format }) {
    return {
      js: format === 'esm' ? '.mjs' : '.cjs',
    };
  },
  dts: true,
  clean: true,
});