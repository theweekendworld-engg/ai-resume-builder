import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import path from 'node:path';
import manifest from './manifest.config';

export default defineConfig({
    plugins: [react(), crx({ manifest })],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
        },
    },
    build: {
        outDir: 'dist',
        sourcemap: true,
        emptyOutDir: true,
        target: 'es2022',
    },
    server: {
        port: 5173,
        strictPort: false,
        hmr: { port: 5173 },
    },
});
