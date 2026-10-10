/**
 * 设置 → 存储：用户数据存放位置（展示、切换与恢复默认）。
 */

import { useEffect, useState } from 'react'
import {
  Copy,
  FolderOpen,
  HardDrive,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { pickRoot, storageInfo } from '../../lib/storage'
import { type StorageInfo } from '../../lib/native'
import { type SwitchRootResult } from '../../lib/boot'
import { pane } from '../Pane'
import { t } from '../../i18n'

interface Props {
  onRootChanged: (dir?: string) => Promise<SwitchRootResult>
  onToast: (msg: string) => void
}

export function StoragePanel({ onRootChanged, onToast }: Props) {
  const [info, setInfo] = useState<StorageInfo | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void storageInfo()
      .then(setInfo)
      .catch(() => setInfo(null))
  }, [])

  const apply = async (dir?: string) => {
    setBusy(true)
    try {
      const res = await onRootChanged(dir)
      if (!res.ok) {
        onToast(t('切换失败：{0}', res.error))
        return
      }
      setInfo(await storageInfo())
      onToast(t('数据存储位置已切换'))
    } catch (err) {
      onToast(err instanceof Error ? err.message : t('切换失败'))
    } finally {
      setBusy(false)
    }
  }

  const choose = async () => {
    const picked = await pickRoot()
    if (!picked.ok || !picked.root) return
    await apply(picked.root)
  }

  const copyPath = () => {
    if (!info?.root) return
    void navigator.clipboard
      .writeText(info.root)
      .then(() => onToast(t('路径已复制到剪贴板')))
      .catch(() => onToast(t('复制失败，请手动选取')))
  }

  return (
    <div className={pane(5, true)}>
      {/* 头部简介 */}
      <div className="flex flex-col gap-2 border-b border-line pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <HardDrive size={16} className="text-seal" />
            <h2 className="text-[14px] font-semibold text-ink-strong">{t('数据存储')}</h2>
          </div>
          <p className="mt-1 text-[11.5px] text-ink-soft">
            {t('管理个人画像、文档笔记、对话记录与学习图谱的物理存储位置。')}
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-ok/40 bg-ok/10 px-2.5 py-1 text-[11px] text-ok-deep">
          <Sparkles size={11} />
          <span>{t('本地优先 · 离线安全')}</span>
        </div>
      </div>

      {/* 当前存储根目录卡片 */}
      <section className="rounded-xl border border-line bg-card/60 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderOpen size={15} className="text-seal" />
            <span className="text-[13px] font-medium text-ink-strong">{t('当前存储目录')}</span>
          </div>
          {info && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
                info.isDefault
                  ? 'border border-ok/40 bg-ok/10 text-ok-deep'
                  : 'border border-seal/30 bg-seal/10 text-seal-deep'
              }`}
            >
              {info.isDefault ? t('系统默认位置') : t('自定义工作空间')}
            </span>
          )}
        </div>

        {/* 路径展示条 */}
        <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-line bg-paper-deep/70 px-3 py-2">
          <span className="min-w-0 flex-1 break-all font-mono text-[11.5px] text-ink-strong">
            {info ? info.root : t('正在读取存储路径…')}
          </span>
          {info?.root && (
            <button
              type="button"
              onClick={copyPath}
              className="flex shrink-0 items-center gap-1 rounded-md border border-line-strong/60 bg-card px-2 py-1 text-[11px] text-ink-soft transition hover:border-line-strong hover:text-ink"
              title={t('复制路径')}
            >
              <Copy size={11} />
              <span>{t('复制')}</span>
            </button>
          )}
        </div>

        {/* 操作按钮组 */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void choose()}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[12px] font-medium text-ink transition hover:border-line-strong hover:bg-card/80 disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <FolderOpen size={13} className="text-seal" />}
            <span>{t('更改存储位置…')}</span>
          </button>
          <button
            type="button"
            disabled={busy || info?.isDefault !== false}
            onClick={() => void apply('')}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[12px] text-ink-soft transition hover:border-line-strong hover:text-ink disabled:opacity-40"
          >
            <RotateCcw size={12} />
            <span>{t('恢复为默认位置')}</span>
          </button>
        </div>
      </section>

      {/* 存储结构说明卡片 */}
      <section className="flex flex-col gap-2">
        <div className="text-[12.5px] font-medium text-ink-strong">{t('目录数据结构')}</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-line bg-card p-3">
            <div className="font-mono text-[12px] font-medium text-seal-deep">users/{'{用户}'}/</div>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
              {t('用户偏好配置、个人画像与专属学习记录。')}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-card p-3">
            <div className="font-mono text-[12px] font-medium text-seal-deep">docs/</div>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
              {t('教学文档源文件、Markdown 笔记与知识拓扑。')}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-card p-3">
            <div className="font-mono text-[12px] font-medium text-seal-deep">plugins/</div>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
              {t('本地安装的自定义扩展插件与伪编译缓存产物。')}
            </p>
          </div>
        </div>
      </section>

      {/* 数据安全保证说明 */}
      <div className="rounded-xl border border-line bg-card/60 p-3.5 text-[11px] leading-relaxed text-ink-soft">
        <div className="flex items-center gap-1.5 font-medium text-ink-strong">
          <ShieldCheck size={14} className="text-seal" />
          <span>{t('安全换盘保证')}</span>
        </div>
        <p className="mt-1">
          {t('切换存储目录相当于开启另一套独立的工作空间；')}
          <span className="font-medium text-ink-strong">
            {t('原目录中的全部文件绝对不会被移动、修改或删除')}
          </span>
          {t('。若想回到原有数据，只需再次选择原路径即可无缝切换回原内容。')}
        </p>
      </div>
    </div>
  )
}
