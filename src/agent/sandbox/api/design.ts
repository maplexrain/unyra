/**
 * execute 沙箱: design.* api 实现
 *
 * 管理文档排版配方组件：
 * - design.component.list：查询已注册组件（只暴露 id、tag、name 与简短描述以节省 token）
 * - design.component.get：查询组件详细签名（标签、插槽、属性与示例）
 * - design.component.register：注册新的排版配方组件
 * - design.component.update：更新外部注册的排版配方组件
 * - design.component.delete：删除外部注册的排版配方组件
 *
 * 容错别名：同时支持 design.componet.*（兼容错拼）
 */

import {
  listDocumentComponents,
  getDocumentComponent,
  registerDocumentComponent,
  updateDocumentComponent,
  deleteDocumentComponent,
  type DocumentComponentDef,
  type UpdateDocumentComponentPatch,
} from '../../../lib/componentBlock/registry'
import { asRecord, asText } from '../refs'
import { wrapApi } from '../wrap'
import type { SandboxCall, SandboxOptions } from '../types'

export function installDesign(
  api: Record<string, unknown>,
  _opts: SandboxOptions,
  log: SandboxCall[],
): void {
  // 1. 查询已注册组件清单：只暴露 id、tag、name、description
  const handleList = (args: unknown[]) => {
    const o = asRecord(args[0])
    const query = typeof o.query === 'string' ? o.query : undefined
    const source = o.source === 'builtin' || o.source === 'external' ? o.source : undefined
    const all = listDocumentComponents({ query, source })

    // 严控体积：只暴露组件 id、tag、name 与简短 description
    const components = all.map((c) => ({
      id: c.id,
      tag: c.tag,
      name: c.name,
      description: c.description,
      source: c.source,
      file: c.file,
    }))

    return { ok: true, components }
  }

  wrapApi(api, 'design.component.list', handleList, log)

  // 2. 查询组件完整签名（包含 slots, attrs, example）
  const handleGet = (args: unknown[]) => {
    const first = args[0]
    let target = ''
    if (typeof first === 'string') {
      target = first
    } else {
      const o = asRecord(first)
      target = asText(o.id || o.tag || o.name)
    }

    if (!target) {
      return { ok: false, error: '缺少组件 id 或 tag 参数' }
    }

    const component = getDocumentComponent(target)
    if (!component) {
      return { ok: false, error: `未找到组件: ${target}` }
    }
    // component 是运行时函数，不能跨 Worker/IPC 序列化；外部组件告诉调用方文件位置即可。
    const doc = { ...component } as Record<string, unknown>
    delete doc.component
    return { ok: true, component: doc }
  }

  wrapApi(api, 'design.component.get', handleGet, log)

  // 3. 注册新的配方组件
  const handleRegister = (args: unknown[]) => {
    const o = asRecord(args[0])
    const tag = asText(o.tag)
    const name = asText(o.name)
    const description = asText(o.description)
    const example = typeof o.example === 'string' ? o.example : undefined
    const category = typeof o.category === 'string' ? (o.category as DocumentComponentDef['category']) : undefined
    const id = typeof o.id === 'string' ? asText(o.id) : undefined

    const slots = Array.isArray(o.slots) ? (o.slots as DocumentComponentDef['slots']) : undefined
    const attrs = Array.isArray(o.attrs) ? (o.attrs as DocumentComponentDef['attrs']) : undefined
    const source = typeof o.source === 'string' ? o.source : undefined

    return registerDocumentComponent({
      id,
      tag,
      name,
      description,
      category,
      example,
      slots,
      attrs,
      source,
    })
  }

  wrapApi(api, 'design.component.register', handleRegister, log)

  // 4. 更新外部注册的配方组件
  const handleUpdate = (args: unknown[]) => {
    const o = asRecord(args[0])
    const id = asText(o.id)
    if (!id) {
      return { ok: false, error: '缺少组件 id' }
    }

    const patch: UpdateDocumentComponentPatch = {}
    if (typeof o.name === 'string') patch.name = asText(o.name)
    if (typeof o.tag === 'string') patch.tag = asText(o.tag)
    if (typeof o.description === 'string') patch.description = asText(o.description)
    if (typeof o.example === 'string') patch.example = o.example
    if (typeof o.source === 'string') patch.source = o.source
    if (typeof o.category === 'string') patch.category = o.category as DocumentComponentDef['category']
    if (Array.isArray(o.slots)) patch.slots = o.slots as DocumentComponentDef['slots']
    if (Array.isArray(o.attrs)) patch.attrs = o.attrs as DocumentComponentDef['attrs']

    return updateDocumentComponent(id, patch)
  }

  wrapApi(api, 'design.component.update', handleUpdate, log)

  // 5. 删除外部注册的配方组件
  const handleDelete = (args: unknown[]) => {
    const first = args[0]
    let id = ''
    if (typeof first === 'string') {
      id = first
    } else {
      const o = asRecord(first)
      id = asText(o.id)
    }

    if (!id) {
      return { ok: false, error: '缺少组件 id' }
    }

    return deleteDocumentComponent(id)
  }

  wrapApi(api, 'design.component.delete', handleDelete, log)

  // 容错别名：同时支持 api.design.componet.*（兼容错拼）
  const designObj = api.design as Record<string, unknown> | undefined
  if (designObj && designObj.component) {
    designObj.componet = designObj.component
  }
}
