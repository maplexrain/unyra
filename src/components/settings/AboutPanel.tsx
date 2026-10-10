/**
 * 设置 → 关于：版本号、核心理念与本地数据说明。
 */

import { BookOpen, Copy, Cpu, Info, ShieldCheck } from 'lucide-react'
import Logo from '../Logo'
import { pane } from '../Pane'
import { t } from '../../i18n'

export function AboutPanel({ onToast }: { onToast: (msg: string) => void }) {
  const copy = (text: string, label: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => onToast(t('{0}已复制', label)))
      .catch(() => onToast(t('复制失败，请手动选中后复制')))
  }

  return (
    <div className={pane(5, true)}>
      {/* 品牌 Hero 卡片 */}
      <section className="flex flex-col items-center justify-center rounded-2xl border border-line bg-card/70 p-6 text-center shadow-xs">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-line-strong/40 bg-paper-deep p-2 shadow-xs">
          <Logo size={48} />
        </div>

        <h1 className="mt-3 text-[17px] font-bold text-ink-strong tracking-tight">
          {t('归一 Unyra · 探索式学习')}
        </h1>
        <p className="mt-1 text-[12px] text-ink-soft">
          {t('基于纸墨美学的本地优先探索式笔记与 AI 学习环境')}
        </p>

        {/* 版本号复制条 */}
        <div className="mt-4 flex items-center gap-2 rounded-full border border-line-strong/60 bg-paper px-3 py-1 text-[11.5px]">
          <span className="text-ink-faint">{t('当前版本')}</span>
          <code className="font-mono font-semibold text-ink-strong">v{__APP_VERSION__}</code>
          <button
            type="button"
            onClick={() => copy(__APP_VERSION__, t('版本号'))}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium text-seal hover:bg-seal/10 transition"
            title={t('复制版本号')}
          >
            <Copy size={11} />
            <span>{t('复制')}</span>
          </button>
        </div>
      </section>

      {/* 核心特性与架构理念微卡片 */}
      <section className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <div className="flex flex-col justify-between rounded-xl border border-line bg-card/60 p-3.5">
          <div className="flex items-center gap-2 text-seal">
            <ShieldCheck size={16} />
            <span className="text-[12.5px] font-semibold text-ink-strong">{t('本地优先')}</span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
            {t('笔记、个人画像与历史对话完整存放在你的个人电脑中，离线可用，绝不上传云端。')}
          </p>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-line bg-card/60 p-3.5">
          <div className="flex items-center gap-2 text-seal">
            <Cpu size={16} />
            <span className="text-[12.5px] font-semibold text-ink-strong">{t('多模型接入')}</span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
            {t('支持 DeepSeek、OpenAI、Claude、Ollama 等任意主流提供商与本地私有大模型自由组合。')}
          </p>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-line bg-card/60 p-3.5">
          <div className="flex items-center gap-2 text-seal">
            <BookOpen size={16} />
            <span className="text-[12.5px] font-semibold text-ink-strong">{t('纸墨美学')}</span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
            {t('专为沉浸式深度阅读调校的仿古纸与温润墨韵排版，视力友好，专注思考。')}
          </p>
        </div>
      </section>

      {/* 反馈与升级提示 */}
      <div className="rounded-xl border border-line bg-card/60 p-3.5 text-[11px] leading-relaxed text-ink-soft">
        <div className="flex items-center gap-1.5 font-medium text-ink-strong">
          <Info size={13} className="text-seal" />
          <span>{t('关于反馈与升级')}</span>
        </div>
        <p className="mt-1">
          {t('遇到异常或反馈问题时，请带上上方复制的版本号。升级时数据目录完全不受影响，新旧版本可以无缝混用。')}
        </p>
      </div>
    </div>
  )
}
