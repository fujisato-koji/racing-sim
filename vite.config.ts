import { defineConfig } from 'vite';

// Pages はサブパス（/racing-sim/）で配信されるので、相対パスで出力する
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
