import { useState } from 'react'
import { FileCode } from 'lucide-react'
import VimIcon from './VimIcon'
import { t } from '../../i18n'

interface Props {
  enabled: boolean
  onToggle: () => void
  onOpenConfig: () => void
}

export default function VimFloatTip({ enabled, onToggle, onOpenConfig }: Props) {
  const [openingConfig, setOpeningConfig] = useState(false)

  const handleOpen = async () => {
    setOpeningConfig(true)
    try {
      await onOpenConfig()
    } finally {
      setOpeningConfig(false)
    }
  }

  return (
    <div
      role="tooltip"
      className="absolute left-full top-0 ml-2 z-30 w-56 rounded-none border border-line-strong/80 bg-card/95 p-3 shadow-xl backdrop-blur select-none animate-in fade-in zoom-in-95 duration-150"
    >
      {/* 头部：Vim 经典徽标 + 标题 + 开关 Switch */}
      <div className="flex items-center justify-between pb-2 border-b border-line/60">
        <div className="flex items-center gap-1.5">
          <VimIcon size={16} className={enabled ? 'text-[#019833]' : 'text-ink-soft'} />
          <span className="text-[12px] font-semibold text-ink-strong tracking-wide">
            {t('Vim 模式')}
          </span>
        </div>

        {/* 现代极简 Switch 组件 */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={onToggle}
          className={`relative inline-flex h-4 w-8 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
            enabled ? 'bg-[#019833]' : 'bg-line-strong'
          }`}
          title={enabled ? t('点击关闭 Vim 模式') : t('点击开启 Vim 模式')}
        >
          <span
            aria-hidden="true"
            className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
              enabled ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* 说明文案 */}
      <div className="py-2 text-[11px] leading-relaxed text-ink-faint">
        {enabled
          ? t('已激活：支持 Normal、Insert、Visual 等全套按键')
          : t('未激活：标准现代编辑器光标与按键')}
      </div>

      {/* 底部配置按钮 */}
      <button
        type="button"
        disabled={openingConfig}
        onClick={handleOpen}
        className="mt-1 flex w-full items-center justify-between border border-line px-2.5 py-1.5 text-[11.5px] font-medium text-ink-soft transition hover:border-seal/60 hover:bg-seal/10 hover:text-ink-strong disabled:opacity-50 cursor-pointer"
      >
        <span className="flex items-center gap-1.5">
          <FileCode size={13} className="text-seal" />
          <span>{t('配置 (.vimrc)')}</span>
        </span>
        <span className="font-mono text-[10px] text-ink-faint">~/.vimrc</span>
      </button>
    </div>
  )
}
