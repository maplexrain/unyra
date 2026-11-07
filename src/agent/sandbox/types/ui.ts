/**
 * 这个文件负责什么：沙箱类型契约的**ui（界面操作）**组——toast / point / scroll /
 * screenshot / superdoc 的请求与宿主实现。
 * 原先与其它组同写在 src/agent/sandbox/types.ts，按 API 能力组拆到这里；形状逐字未动，
 * 对外一律经门面 src/agent/sandbox/types.ts 原样转出，调用方 import 路径不变。
 */
import type { MessageImage } from '../../types'
import type { SandboxDocKind } from '../refs'

/* ---------- ui：界面操作 ---------- */

/** ui.point 的定位请求：path 已解析成节点 + 文档，needle 是要在渲染结果里找的文字 */
export interface UiPointRequest {
  nodeId: string
  kind: SandboxDocKind
  /** 笔记名；kind 为 'note' 但省略时由界面取该节点第一份笔记 */
  note?: string
  /** 要定位/选中的文字（源文里按 line 或 regex 算出来的那一段，已折叠空白） */
  needle?: string
  /** 找不到 needle 时的兜底：按比例滚到文档的这个位置（0~1） */
  fallbackRatio?: number
}

/** ui.scroll 的请求：滚到顶/底，或按像素滚动 */
export interface UiScrollRequest {
  to?: 'top' | 'bottom'
  by?: number
}

/** ui.screenshot 的返回：截图已存进资源库，图片挂在 images 上由运行时送进下一跳 */
export type UiCaptureResult =
  | { ok: true; note?: string; images: MessageImage[] }
  | { ok: false; error: string }

export interface UiOps {
  toast?: (message: string) => void
  /** 打开/切换到某节点的文档页签并定位；located 说明定位是否成功 */
  point?: (req: UiPointRequest) => Promise<{ located: boolean }> | { located: boolean }
  scroll?: (req: UiScrollRequest) => void
  capture?: () => Promise<UiCaptureResult>
  /** ui.dom 的根：文档区元素；没有打开的文档时返回 null（会话建立会失败） */
  domRoot?: () => Element | null
  /**
   * 打开/切到一个节点的某份超级文档页签（ui.superdoc）。
   * opened 说明那份超级文档还在不在——删掉的打不开，别静默开一个空页签。
   */
  openSuper?: (req: { nodeId: string; name: string }) => Promise<{ opened: boolean }> | { opened: boolean }
}

