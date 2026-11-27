/**
 * 外部 TSX 模块的动态编译。
 *
 * 渲染层与“设计预览”内置服务共用这一份：Sucrase 只剥离 TypeScript、把 JSX 转成
 * React 调用、把 import 转成 require；不做类型检查，也不参与 Vite 打包。
 * 允许外部文件 import react / react/jsx-runtime；其余包不注入，避免把应用内部
 * 模块或任意 Node 能力暴露给用户文件。
 */
import { transform } from 'sucrase'
import * as React from 'react'
import * as JSXRuntime from 'react/jsx-runtime'
import * as JSXDevRuntime from 'react/jsx-dev-runtime'

export interface CompiledExternalModule {
  def?: Record<string, unknown>
  error?: string
}

/** 只给外部文件的白名单 require；未知依赖返回 undefined 而不是去探 Node 模块。 */
function externalRequire(id: string): unknown {
  if (id === 'react') return React
  if (id === 'react/jsx-runtime') return JSXRuntime
  if (id === 'react/jsx-dev-runtime') return JSXDevRuntime
  throw new Error(`不支持的外部依赖：${id}（只允许 react / react/jsx-runtime）`)
}

/**
 * 编译并执行一份 TSX。返回的 def 是源文件 `export default` 的对象。
 * 文件名只用于错误信息与 sourceURL，不参与路径拼接。
 */
export function compileExternalTsx(source: string, fileName: string): CompiledExternalModule {
  let code: string
  try {
    code = transform(source, {
      transforms: ['typescript', 'jsx', 'imports'],
      jsxRuntime: 'automatic',
      jsxImportSource: 'react',
      production: true,
    }).code
  } catch (err) {
    return { error: `TSX 编译失败：${err instanceof Error ? err.message : String(err)}` }
  }

  const mod = { exports: {} as Record<string, unknown> }
  try {
    const run = new Function(
      'require',
      'module',
      'exports',
      'React',
      `${code}\n//# sourceURL=unyra-external:///${encodeURI(fileName)}`,
    )
    run(externalRequire, mod, mod.exports, React)
  } catch (err) {
    return { error: `TSX 运行失败：${err instanceof Error ? err.message : String(err)}` }
  }

  const raw = (mod.exports.default ?? mod.exports) as unknown
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: '模块必须 export default 一个对象' }
  }
  return { def: raw as Record<string, unknown> }
}
