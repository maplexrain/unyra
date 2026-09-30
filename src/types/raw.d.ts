/**
 * esbuild / vite 的 ?raw 导入：拿到文件原文的字符串。
 * 只声明用到的这一种形状，避免把整个 vite/client 的类型拉进来。
 */
declare module '*?raw' {
  const content: string
  export default content
}

/**
 * 资源导入：`?url` 拿到的是**打包后的地址**（开发时指向 dev server，打包后指向 assets/…）。
 * 目前只有 oniguruma 的 wasm 用（见 src/syntax/GrammarRegistry.ts），
 * 与 lib/voice/whisper/runtime.ts 里那份 wasm 的取法一致。
 */
declare module '*?url' {
  const url: string
  export default url
}
