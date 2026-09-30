/**
 * 这个文件负责：「存储」分页：用户数据的存放位置（显示与切换）。
 */

import { useEffect, useState } from 'react'
import { FolderOpen, Loader2, RotateCcw } from 'lucide-react'
import { pickRoot, storageInfo } from '../../lib/storage'
import { type StorageInfo } from '../../lib/native'
import { type SwitchRootResult } from '../../lib/boot'
import { pane } from '../Pane'
import { t } from '../../i18n'

/* ---------- 存储位置（全局设置） ---------- */

/**
 * 用户数据的存放位置。
 *
 * 它是**全局设置**：跟这台机器绑定，不属于任何一位用户，所以存在 appdata 里
 * （见 electron/storage.ts），不进用户数据目录——否则「数据放哪儿」这件事本身
 * 就得先知道数据放哪儿。
 */
export function StoragePanel({
  onRootChanged,
  onToast,
}: {
  onRootChanged: (dir?: string) => Promise<SwitchRootResult>
  onToast: (msg: string) => void
}) {
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

  return (
    <div className={pane(5, true)}>
      <section>
        <div className="mb-2 text-ink-soft">{t('用户数据目录')}</div>
        <div className="break-all rounded-lg border border-line bg-card/60 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-ink-strong">
          {info ? info.root : t('读取中…')}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
          {t('用户信息、配置与教学文档都在这里，按 `users/{用户}/` 分目录存放。')}
          {info?.isDefault ? t('当前是应用数据目录下的默认位置。') : ''}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void choose()}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[12.5px] text-ink-soft transition hover:border-line-strong hover:text-ink disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
            {t('更改位置…')}
          </button>
          <button
            type="button"
            disabled={busy || info?.isDefault !== false}
            onClick={() => void apply('')}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[12.5px] text-ink-soft transition hover:border-line-strong hover:text-ink disabled:opacity-40"
          >
            <RotateCcw size={14} />
            {t('恢复默认')}
          </button>
        </div>
      </section>

      <div className="rounded-lg border border-line bg-card/60 px-3 py-2.5 text-[11px] leading-relaxed text-ink-soft">
        {t('换目录就是换一整套数据（用户、配置、教学文档都在其中），切换后会立即按新目录重新载入；')}
        <span className="text-ink-strong">{t('原目录里的文件不会被移动或删除')}</span>
        {t('，想回去的话再选一次即可。')}
      </div>
    </div>
  )
}
