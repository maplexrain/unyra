/*
 * 这个文件负责：**新建文件**那一页的编辑视图——还没有落点、也没有类型的那一份正文。
 *
 * 它为什么单独一个组件、而不是复用 LocalDoc：LocalDoc 的一切都建立在「磁盘上有一个
 * 真实文件」之上——打开时读一次、保存写回原文件、外部改动监听、媒体预览、相对图片解析。
 * 新建文件页签恰恰相反：**磁盘上什么都没有**，正文只活在暂存区里（learn/drafts，
 * 基准是空文档），「存到哪儿」要到保存那一刻才由用户回答。硬塞进 LocalDoc 会让它
 * 到处长 if；而这里真正需要的只有一件东西——一个编辑区。
 *
 * 「未保存」这件事在这一页有两种表现，看起来不一致，其实是**故意的**：
 * - 编辑区左下角一直写「未保存」：这一份确实还没有落到任何文件上；
 * - 页签上那颗圆点只在**用户真的写了字**之后才出现——它跟着暂存区走（见 learn/drafts），
 *   而空白的、一个字都没写的草稿没有「要丢的东西」可言，关它不该弹确认框。
 */

import { FilePlus } from 'lucide-react'
import SourceEditor, { type SaveState } from './SourceEditor'
import { t } from '../../i18n'

interface Props {
  /** 暂存区里这一份的正文（一个字都没写过就是 undefined） */
  draft?: string
  /** 正文字号系数（与其它文档共用同一个设置） */
  scale: number
  /** 改动写进暂存区；传空串表示「又改回没写过」，那一条暂存自己消失 */
  onDraft: (text: string) => void
  saving: boolean
  saveError?: string
  /** 保存：这一步才选路径、文件名与后缀（见 useDocSaveFlow 的 draft 分支） */
  onSave: () => void
}

export default function DraftDoc({ draft, scale, onDraft, saving, saveError, onSave }: Props) {
  const text = draft ?? ''
  /*
   * 状态只有三种：保存中 / 保存失败 / 未保存。
   * 没有「已保存」这一档——这一页存在的前提就是「还没有文件」，一旦存成，它当场
   * 换成指向那个文件的本地文件页签（见 useDocSaveFlow），这个组件也就不在了。
   */
  const state: SaveState = saving ? 'saving' : saveError ? 'error' : 'dirty'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 页头那一句是这一页唯一的说明：它替用户回答「为什么保存还要问我文件名」 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-paper/70 px-3 py-1.5 text-[11.5px] text-ink-soft">
        <FilePlus size={13} className="shrink-0 text-seal" />
        <span className="min-w-0 flex-1 truncate">
          {t('还没保存的新文件：按 Ctrl+S 选路径、文件名与后缀（默认 .txt），保存之后才定下它的类型')}
        </span>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="shrink-0 rounded-md border border-line-strong px-2 py-0.5 text-[11px] text-ink-soft transition hover:border-seal hover:text-seal-deep disabled:opacity-40"
        >
          {saving ? t('保存中…') : t('保存…')}
        </button>
      </div>
      <SourceEditor
        value={text}
        onChange={onDraft}
        state={state}
        error={saveError}
        label={t('未命名')}
        scale={scale}
        // 还没有后缀可认，就是纯文本（保存之后才由文件名决定高亮哪门语言）
        ext=""
        placeholder={t('在这里写点什么…')}
      />
    </div>
  )
}
