import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 仓库根目录（vite dev 以 apps/frontend 为 cwd 启动，.env 在根目录）
const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // loadEnv 默认只透出 VITE_ 前缀变量，传 '' 以读取全部（后端 SERVER_PORT 无前缀）
  const env = loadEnv(mode, repoRoot, '');
  const serverPort = env.SERVER_PORT ?? '3000';
  const frontendPort = Number(env.FRONTEND_DEV_PORT ?? 5173);

  return {
    plugins: [react()],
    server: {
      port: frontendPort,
      proxy: {
        '/api': {
          target: `http://localhost:${serverPort}`,
          changeOrigin: true,
          // 后端已设置全局前缀 /api，此处不重写路径，直接透传
        },
      },
    },
  };
});
