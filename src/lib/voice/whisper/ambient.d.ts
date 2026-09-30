/**
 * 只给 TS 看的补丁：whisper.cpp 的 Emscripten 胶水文件没有类型声明。
 *
 * 为什么直接深路径引入而不是从包入口拿：包入口（index.js）只在「自己
 * `import()` 一个 URL 来取胶水」这条路上暴露工厂函数，而那条路要求运行时能
 * 解析出一个真实的脚本 URL —— 本应用以 file:// 加载页面，这条路不可靠。
 * 我们改成用 Vite 把胶水当普通 ES 模块打进产物，再把工厂函数显式交给它
 * （configureWasm({ moduleFactory })），于是整个加载过程不产生任何动态请求。
 */
declare module '@fugood/node-whisper-wasm/wasm/whisper-node.js' {
  /** Emscripten 模块工厂：传入 Module 配置，返回初始化完成的 Module。 */
  const createWhisperNodeModule: (
    options?: Record<string, unknown>,
  ) => Promise<unknown>
  export default createWhisperNodeModule
}
