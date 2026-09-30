/**
 * 生产构建的 Electron 侧：把主进程与 preload 编译进 dist-electron/。
 *
 * 顺序由 package.json 的 build 脚本保证：
 *   tsc -b（类型检查）→ vite build（渲染层 → dist/）→ 本脚本（主进程 → dist-electron/）
 * 主进程生产模式加载 dist/index.html，因此两者都必须先就位。
 */

import { buildElectron } from './electron-compile.mjs'

const release = process.env.MOJI_RELEASE === '1'
console.log('[build] 编译主进程与 preload → dist-electron/' + (release ? '（发布构建：压缩、不带 sourcemap）' : ''))
await buildElectron()
console.log('[build] 完成。用 npm start 运行生产构建。')
