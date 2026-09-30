import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

// 版本号只有 package.json 一处真值：构建时注入成常量，界面上的「关于」页要显示它。
// 不走 import：那会把整个 package.json（含依赖清单）打进渲染层产物。
const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }).version

// https://vite.dev/config/
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  // 生产构建由 Electron 以 file:// 加载，资源必须是相对路径：
  // 默认的 base '/' 在 file:// 下会解析到文件系统根目录，JS/CSS 全部 404 → 白屏。
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    // Electron 从 dist/index.html 直接读盘加载，不需要 modulepreload 的
    // 绝对路径（它同样会踩 file:// 的坑），关掉更省心
    modulePreload: false,
  },
  optimizeDeps: {
    // function-plot 是在渲染时才动态 import 的（见 src/lib/plot.ts）。
    // 显式列进来，确保它在 dev server 启动时就预打包好，
    // 不会因为「首次画图时才发现这个依赖」触发重新预打包，
    // 导致当时页面里的动态 import 短暂失效。
    include: ['function-plot'],
  },
  server: {
    watch: {
      /**
       * 别去看编辑器原子保存时留下的临时文件。
       *
       * JetBrains 系 IDE 会在源文件旁边建 `.settings.ts.19720.<uuid>.tmpdir/settings.ts.tmp`
       * 再改名替换。这种目录只存在几毫秒，chokidar 若正好在这时去 watch，Windows 会
       * 返回 EBUSY；Vite 把它抛成 FSWatcher 的 'error' 事件，没人接就一路带走整个
       * dev 进程。（scripts/dev.mjs 里另有一道兜底，这里是从源头不看它们。）
       *
       * 用函数而不是 glob：chokidar 各版本对 glob 的支持不一致，函数一直有效。
       * 这些路径本来也不该触发 HMR。
       */
      ignored: (p: string): boolean =>
        /\.tmpdir([\\/]|$)|\.tmp$|\.swp$|\.swx$|~$|[\\/]\.#/.test(p),
    },
  },
})
