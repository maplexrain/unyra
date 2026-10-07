import { Check, Drama } from 'lucide-react'
import { PERSONAS, personaOf, type PersonaId } from '../../agent/persona'
import { useHoverMenu } from '../../lib/hoverMenu'
import { t } from '../../i18n'

/**
 * 导师人格选择器：输入框底行的那颗按钮（子代理按钮右侧），点开换人格。
 *
 * **点击开合**（不悬停展开——与 ModelPicker 同一颗按钮的脾气：这种带选择的菜单
 * 误展开一次就够烦了）。面板的骨架——宽度、圆角、描边、投影、行距、选中勾——
 * 与提供商选择 tip 完全同一套，读起来才是同一族菜单；人格行只留名字，
 * 角色与口号那两行描述撤掉（选人格靠名字就够，描述只会把菜单撑高）。
 */

/** 退场时长，与 index.css 的 .moji-bloom-up-out 对齐（略长一点，动画播完才卸载） */
const PANEL_EXIT_MS = 170
/** 面板内容最高这么高，再高就在面板内部滚动（与 ModelPicker 同一条线） */
const PANEL_MAX_H = 300

export default function PersonaPicker({
  persona,
  onPick,
}: {
  persona: PersonaId
  onPick: (id: PersonaId) => void
}) {
  // 与 ModelPicker 同款：外点 / Esc 监听挂在 document 上，按钮自己管开合
  const { open, setOpen, mounted, wrapProps, panelProps } = useHoverMenu({
    exitMs: PANEL_EXIT_MS,
    outsideClick: true,
    listenOn: 'document',
  })
  const current = personaOf(persona)

  return (
    <div className="relative" {...wrapProps}>
      <button
        type="button"
        aria-label={t('导师人格：{0}，点击切换', t(current.label))}
        aria-expanded={open}
        title={t(current.label) + ' · ' + t(current.role)}
        onClick={() => setOpen(!open)}
        className={
          'flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] transition ' +
          (open ? 'bg-line/60 text-ink' : 'text-ink-soft hover:text-ink')
        }
      >
        {/* 面具（Drama）：人格的隐喻——「现在跟谁在说话」；颜色跟按钮文字走 */}
        <Drama size={12} className="shrink-0 text-ink-faint" aria-hidden="true" />
        <span className="min-w-0 truncate">{t(current.short)}</span>
      </button>

      {mounted && (
        <div
          className={`absolute right-0 bottom-full z-30 mb-2 w-[260px] overflow-hidden rounded-xl border border-line-strong bg-card shadow-[0_16px_44px_rgba(31,27,23,0.22)] ${
            // 从面板底边中点向上、向左右展开（与 ModelPicker 同一个入场；它已贴近窗口底缘，向上展开）
            panelProps.className
          }`}
        >
          <div className="px-2.5 pb-1 pt-2 text-[10.5px] tracking-wide text-ink-faint">{t('导师人格')}</div>
          <div className="max-h-[300px] overflow-y-auto py-1" style={{ maxHeight: PANEL_MAX_H }}>
            {PERSONAS.map((p) => {
              const on = p.id === current.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    if (!on) onPick(p.id)
                  }}
                  className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition hover:bg-line/50"
                >
                  <Drama size={13} className="shrink-0 text-ink-faint" aria-hidden="true" />
                  <span className={'min-w-0 flex-1 truncate text-[12.5px] ' + (on ? 'text-ink-strong' : 'text-ink')}>
                    {t(p.label)}
                  </span>
                  {on && <Check size={13} className="shrink-0 text-seal" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
