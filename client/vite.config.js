import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(async ({ mode, command }) => {
  const env = loadEnv(mode, __dirname, '');
  const plugins = [react()];
  let enableSourcemaps = false;

  const hasSentryEnv =
    !!env.VITE_SENTRY_ORG && !!env.VITE_SENTRY_PROJECT && !!env.SENTRY_AUTH_TOKEN;

  if (command === 'build' && hasSentryEnv) {
    try {
      const { sentryVitePlugin } = await import('@sentry/vite-plugin');
      plugins.push(
        sentryVitePlugin({
          org: env.VITE_SENTRY_ORG,
          project: env.VITE_SENTRY_PROJECT,
          authToken: env.SENTRY_AUTH_TOKEN,
          release:
            env.VITE_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || undefined,
          sourcemaps: { assets: './dist/**' },
          telemetry: false,
        })
      );
      enableSourcemaps = true;
    } catch {
      console.warn('[vite] @sentry/vite-plugin not installed; skipping Sentry upload.');
    }
  }

  const apiTarget = env.VITE_API_BASE_URL || 'http://localhost:5002';

  return {
    plugins,
    envDir: __dirname,

    json: { stringify: true },

    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@emoji-mart/data/sets/15/native.json': '@emoji-mart/data',
      },
      dedupe: [
        'react',
        'react-dom',
        '@mantine/core',
        '@mantine/hooks',
        '@mantine/notifications',
        '@mantine/dates',
      ],
    },

    build: {
      sourcemap: enableSourcemaps,
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id) return;

            // --- node_modules package-based splitting (aggressive) ---
            if (id.includes('node_modules')) {
              // normalize path after node_modules/
              const after = id.split('node_modules/')[1] || id;
              const parts = after.split('/');
              // scoped packages like @mantine/core -> ['@mantine','core',...]
              const pkgName = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];

              // A curated list of heavy or important packages to force into named chunks
              const dedicated = [
                'react',
                'react-dom',
                'react-router',
                'react-router-dom',
                '@mantine/core',
                '@mantine/hooks',
                '@mantine/notifications',
                '@mantine/dates',
                '@tabler/icons-react',
                '@emotion/react',
                '@emotion/styled',
                '@floating-ui',
                '@radix-ui',
                '@sentry/react',
                '@sentry/browser',
                '@amplitude/analytics-browser',
                'socket.io-client',
                'axios',
                'lodash',
                'date-fns',
                'dayjs',
                'moment',
                'recharts',
                'chart.js',
                'd3',
                'tweetnacl',
                'tweetnacl-util',
                'libsodium-wrappers',
                'emoji-mart',
                '@emoji-mart',
                'prismjs',
                'quill',
                'draft-js',
                '@tanstack/react-query',
                'zustand',
                'recoil',
              ];

              if (dedicated.includes(pkgName)) {
                const safe = pkgName.replace('@', '').replace('/', '-');
                return `vendor-${safe}`;
              }

              // Generic: create a chunk per package name (sanitized)
              const safePkg = pkgName.replace('@', '').replace('/', '-').replace(/[^a-zA-Z0-9_\-]/g, '');
              return `vendor-${safePkg}`;
            }

            // --- local big module split: encryption client (explicit) ---
            if (id.includes('/src/utils/encryptionClient') || id.match(/src\/utils\/encryptionClient/)) {
              return 'encryption-client';
            }

            // --- split heavy pages / routes into named chunks if present ---
            if (id.match(/src\/pages\/settings|src\/routes\/settings|SettingsBackups/)) {
              return 'page-settings';
            }
            if (id.match(/src\/pages\/admin|src\/routes\/admin/)) {
              return 'page-admin';
            }
            if (id.match(/src\/pages\/wireless|src\/routes\/wireless/)) {
              return 'page-wireless';
            }
            if (id.match(/src\/pages\/backup|ChatBackupManager/)) {
              return 'page-backup';
            }

            // otherwise let Rollup/Vite decide (fallthrough)
          },
        },
      },
    },

    server: {
      host: true,
      port: 5173,
      cors: true,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true, secure: false },
        '/socket.io': { target: apiTarget, ws: true, changeOrigin: true, secure: false },
        '/tokens': { target: apiTarget, changeOrigin: true, secure: false },
        '/billing': { target: apiTarget, changeOrigin: true, secure: false },
      },
    },

    preview: { port: 5174 },
  };
});
