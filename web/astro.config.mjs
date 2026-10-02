import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import node from '@astrojs/node';
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  devToolbar: { enabled: false },
  integrations: [react()],
  vite: {
    define: { __KAJIAN_PROJECT_ROOT__: JSON.stringify(projectRoot) },
    plugins: [tailwindcss(), {
      name: 'watch-study-files',
      configureServer(server) {
        server.watcher.add(['summarize', 'transcript'].map(directory => fileURLToPath(new URL(`../${directory}`, import.meta.url))));
      },
    }],
    server: { fs: { allow: ['..'] } },
  },
});
