import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 本地开发：/api 代理到 NestJS（默认 localhost:3000）
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
