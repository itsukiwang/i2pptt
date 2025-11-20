import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 从环境变量读取 base 路径
// 优先使用项目特定的环境变量 I2PPTT_VITE_BASE_PATH，避免与其他 Vite 应用冲突
// 如果未设置，则使用通用变量 VITE_BASE_PATH（向后兼容）
// 默认使用根目录 '/'
const basePath = process.env.I2PPTT_VITE_BASE_PATH || process.env.VITE_BASE_PATH || '/';

export default defineConfig({
  base: basePath,
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true, // 如果端口被占用，报错而不是使用其他端口
    host: '0.0.0.0', // 允许外部访问
    allowedHosts: [
      'toolkit.vmlchina.com',
      'localhost',
      '.vmlchina.com', // 允许所有 vmlchina.com 的子域名
    ],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
});


