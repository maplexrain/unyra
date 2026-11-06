/**
 * 视频节点：把**一个学习目标**与**一个视频资源**绑在一起的引用（见 learn/video/nodes）。
 *
 * 画布上从 palette 拖到空白处落地或挂在文档之下，卡上输入视频唯一标识（URL/BV号）；
 * 点击标题打开视频 Tab，确定为视频资源后固化标识输入框，不再提供修改换绑。
 */
import { addEdge, removeEdge } from '../graph'
import { bindVideoNode, updateVideoNode, videoNodeById } from '../video/nodes'
import type { VideoNodeEntity } from '../types'
import { GNode, type ConnectFilter, type NodeHelp, type NodeRelation, type NodeResult } from './base'

export class VideoGNode extends GNode {
  constructor(ctx: ConstructorParameters<typeof GNode>[0], uuid: string) {
    super(ctx, uuid)
  }

  get kind(): 'video' {
    return 'video'
  }

  protected get kindLabel(): string {
    return '视频'
  }

  /** 身后的实体记录（videoNodes 表里的一行） */
  private get entity() {
    return videoNodeById(this.ctx.store(), this.uuid)
  }

  get title(): string {
    const e = this.entity
    if (!e) return '视频 · 已不在'
    if (e.title) return e.title
    if (!e.videoId) return '视频 · 未绑定'
    const video = this.ctx.store().videos?.find((v) => v.id === e.videoId)
    return (video?.title ?? e.videoId) + ' · 视频'
  }

  exists(): boolean {
    return !!this.entity
  }

  get relations(): NodeRelation[] {
    const s = this.ctx.store()
    const out: NodeRelation[] = []
    for (const e of s.edges) {
      if (e.from === this.uuid) {
        out.push({ id: e.to, type: 'down', ...(e.portKey ? { portKey: e.portKey } : {}) })
      } else if (e.to === this.uuid) {
        out.push({ id: e.from, type: 'up', ...(e.portKey ? { portKey: e.portKey } : {}) })
      }
    }
    return out
  }

  get content(): unknown {
    const e = this.entity
    if (!e) return null
    const video = e.videoId ? this.ctx.store().videos?.find((v) => v.id === e.videoId) : undefined
    return {
      id: e.id,
      goalId: e.goalId,
      videoId: e.videoId,
      input: e.input ?? '',
      title: e.title ?? '',
      confirmed: !!e.confirmed,
      ...(video
        ? { videoTitle: video.title, plugin: video.pluginName ?? video.pluginId, selection: video.selection?.title ?? null }
        : {}),
    }
  }

  /**
   * 编辑视频节点内容：
   * - 固化后（confirmed === true）：拒绝修改或换绑；
   * - 未固化：允许修改 input 或 title。
   */
  editContent(next: unknown): NodeResult {
    const e = this.entity
    if (!e) return { error: '这个视频节点已经不在了' }
    let p = next
    if (typeof next === 'string') {
      try {
        p = JSON.parse(next)
      } catch {
        p = { input: next }
      }
    }
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      return { error: '视频节点的内容是对象，包含 videoId、input 或 title' }
    }
    const inputObj = p as Record<string, unknown>
    if (!('videoId' in inputObj) && !('input' in inputObj) && !('title' in inputObj)) {
      return { error: '视频节点只认 videoId、input 或 title 字段' }
    }

    if (e.confirmed && 'input' in inputObj && inputObj.input !== e.input) {
      return { error: '视频节点已确定为视频资源并固化，不再支持修改标识' }
    }

    if ('videoId' in inputObj) {
      const videoId = inputObj.videoId === null ? null : typeof inputObj.videoId === 'string' ? inputObj.videoId : ''
      const r = bindVideoNode(this.ctx.store(), this.uuid, videoId, Date.now())
      if ('error' in r) return { error: r.error }
      this.ctx.commit(r.store)
      return r.entity.videoId
        ? { ok: true, note: '已把「' + r.entity.videoId + '」绑到这个目标' }
        : { ok: true, note: '已解绑' }
    }

    const patch: Partial<Pick<VideoNodeEntity, 'input' | 'title' | 'titleCustomized'>> = {}
    if ('input' in inputObj && typeof inputObj.input === 'string') {
      patch.input = inputObj.input.trim()
    }
    if ('title' in inputObj && typeof inputObj.title === 'string') {
      patch.title = inputObj.title.trim()
      patch.titleCustomized = true
    }
    const r = updateVideoNode(this.ctx.store(), this.uuid, patch, Date.now())
    if ('error' in r) return { error: r.error }
    this.ctx.commit(r.store)
    return { ok: true, note: '已更新视频节点' }
  }

  help(): NodeHelp {
    const e = this.entity
    const video = e?.videoId ? this.ctx.store().videos?.find((v) => v.id === e.videoId) : undefined
    return {
      description:
        '视频节点——把一个学习目标和一个视频资源绑在一起的引用。' +
        (video ? '当前绑着「' + video.title + '」。' : e ? '还没有绑视频。' : ''),
      edit:
        '内容形状：{ videoId } 或 { input }。未固化前可修改 input 或 title；确定为视频资源后标识输入框彻底固化，不再支持修改或换绑。',
      connection:
        '上游允许文档节点，下游可挂文档（如视频总览文档）。删除走 api.node.delete。',
    }
  }

  onDownstream(node: GNode): ConnectFilter {
    if (node.kind === 'doc') return true
    return '视频节点下游只能挂文档（如视频总览文档）'
  }

  onUpstream(node: GNode): ConnectFilter {
    if (node.kind === 'doc') return true
    return '视频节点的上游只能是文档节点'
  }

  protected link(down: GNode): NodeResult {
    const s = this.ctx.store()
    if (!this.entity) return { error: '这个视频节点已经不在了' }
    if (down.kind !== 'doc') return { error: '视频节点下游只能挂文档' }
    const r = addEdge(s, this.uuid, down.uuid)
    if (!r.added) return { error: r.reason ?? '连接失败' }
    this.ctx.commit(r.store)
    return { ok: true, note: '已将文档「' + down.title + '」挂在视频节点之下' }
  }

  protected unlink(target: GNode): NodeResult {
    const s = this.ctx.store()
    const r = removeEdge(s, this.uuid, target.uuid)
    const rRev = removeEdge(r, target.uuid, this.uuid)
    this.ctx.commit(rRev)
    return { ok: true, note: '已断开与「' + target.title + '」的连接' }
  }
}
