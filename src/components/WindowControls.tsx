/**
 * 自绘窗口控制按钮（最小化 / 最大化 / 关闭）。
 *
 * 应用是无边框窗口（见 electron/main.ts 的 frame:false），系统标题栏没有了，
 * 这三颗按钮由渲染层负责。它们只出现在 Electron 里——`native()` 在非 Electron
 * 环境会抛错，因此这里先探测再渲染，避免浏览器里出现点不动的假按钮。
 *
 * 注意：这几颗按钮必须标 `-webkit-app-region: no-drag`，
 * 否则它们落在可拖拽区域里，点击会被当成拖窗口而不是点按钮。
 */

import { useEffect, useState } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'
import { isElectron, native } from '../ai/http'
import { t } from '../i18n'

export default function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!isElectron()) return
    const w = native().window
    let alive = true
    void w.isMaximized().then((v) => {
      if (alive) setMaximized(v)
    })
    // 订阅返回取消函数，卸载时必须调用，否则重挂载会累积监听
    const off = w.onMaximizeChange(setMaximized)
    return () => {
      alive = false
      off()
    }
  }, [])

  if (!isElectron()) return null
  const w = native().window

  const btn =
    'no-drag flex h-8 w-8 items-center justify-center rounded-md text-ink-soft transition hover:bg-line/70 hover:text-ink'

  return (
    <div className="no-drag ml-1 flex shrink-0 items-center gap-0.5">
      <button type="button" title={t('最小化')} onClick={() => w.minimize()} className={btn}>
        <Minus size={14} />
      </button>
      <button
        type="button"
        title={maximized ? t('还原') : t('最大化')}
        onClick={() => w.toggleMaximize()}
        className={btn}
      >
        {maximized ? <Copy size={12} /> : <Square size={12} />}
      </button>
      <button
        type="button"
        title={t('关闭')}
        onClick={() => w.close()}
        className="no-drag flex h-8 w-8 items-center justify-center rounded-md text-ink-soft transition hover:bg-seal hover:text-paper"
      >
        <X size={15} />
      </button>
    </div>
  )
}
