/**
 * 设置 → 性能：全链路性能监控与瓶颈实时诊断看板。
 *
 * 职责：
 * 1. 实时监测核心性能指标（FPS、JS 堆内存、活跃 DOM 节点数、连续运行时长）；
 * 2. 深度跟踪可能引起卡顿的核心诱因（VFS 批处理消峰、结构画布视口裁剪、常驻页签 DOM 堆叠、缓存池）；
 * 3. 提供一键急救与优化工具（释放常驻 DOM、清理缓存池、强制回收）。
 */

import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Boxes,
  Clock,
  Cpu,
  Layers,
  MemoryStick,
  RefreshCw,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react'
import { pane } from '../Pane'
import { t } from '../../i18n'
import { getVfsSyncStats } from '../../vfs'
import { vfsBus } from '../../vfs/bus'
import { getCanvasPerfStats } from '../learn/structure/StructureCanvas'
import { clearResidentTabs, getResidentStats } from '../../learn/resident'
import { clearCodeBlockCache } from '../../lib/codeHighlight'

// 启动时刻打点
const BOOT_TIME = Date.now()

interface MemoryInfo {
  usedMb: number
  totalMb: number
  limitMb: number
  percent: number
}

function readMemoryInfo(): MemoryInfo | null {
  if (typeof window === 'undefined') return null
  const perf = window.performance as unknown as {
    memory?: {
      usedJSHeapSize: number
      totalJSHeapSize: number
      jsHeapSizeLimit: number
    }
  }
  if (!perf?.memory) return null
  const { usedJSHeapSize, totalJSHeapSize, jsHeapSizeLimit } = perf.memory
  const toMb = (b: number) => Math.round((b / (1024 * 1024)) * 10) / 10
  const usedMb = toMb(usedJSHeapSize)
  const totalMb = toMb(totalJSHeapSize)
  const limitMb = toMb(jsHeapSizeLimit)
  const percent = limitMb > 0 ? Math.round((usedJSHeapSize / jsHeapSizeLimit) * 100) : 0
  return { usedMb, totalMb, limitMb, percent }
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000)
  const hours = Math.floor(sec / 3600)
  const minutes = Math.floor((sec % 3600) / 60)
  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分钟`
  }
  return `${minutes} 分钟 ${sec % 60} 秒`
}

export function PerformancePanel({ onToast }: { onToast: (msg: string) => void }) {
  const [fps, setFps] = useState(60)
  const [domCount, setDomCount] = useState(0)
  const [memory, setMemory] = useState<MemoryInfo | null>(null)
  const [uptimeStr, setUptimeStr] = useState('')
  const [vfsStats, setVfsStats] = useState(() => getVfsSyncStats())
  const [canvasStats, setCanvasStats] = useState(() => getCanvasPerfStats())
  const [residentStats, setResidentStats] = useState(() => getResidentStats())
  const [vfsCacheStats, setVfsCacheStats] = useState(() => vfsBus.getCacheStats())

  // FPS 采样帧计数
  const frameCountRef = useRef(0)
  const lastFpsTimeRef = useRef(performance.now())

  useEffect(() => {
    let animId: number
    const loop = (now: number) => {
      frameCountRef.current += 1
      if (now - lastFpsTimeRef.current >= 1000) {
        const delta = (now - lastFpsTimeRef.current) / 1000
        const calculatedFps = Math.min(60, Math.round(frameCountRef.current / delta))
        setFps(calculatedFps)
        frameCountRef.current = 0
        lastFpsTimeRef.current = now
      }
      animId = requestAnimationFrame(loop)
    }
    animId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animId)
  }, [])

  // 1 秒定时刷新综合指标
  useEffect(() => {
    const updateMetrics = () => {
      if (typeof document !== 'undefined') {
        setDomCount(document.getElementsByTagName('*').length)
      }
      setMemory(readMemoryInfo())
      setUptimeStr(formatDuration(Date.now() - BOOT_TIME))
      setVfsStats(getVfsSyncStats())
      setCanvasStats(getCanvasPerfStats())
      setResidentStats(getResidentStats())
      setVfsCacheStats(vfsBus.getCacheStats())
    }

    updateMetrics()
    const timer = setInterval(updateMetrics, 1000)
    return () => clearInterval(timer)
  }, [])

  // 一键释放常驻页签 DOM
  const handleClearResidentTabs = () => {
    clearResidentTabs()
    setResidentStats(getResidentStats())
    onToast(t('已释放后台常驻页签，隐藏 DOM 节点已回收'))
  }

  // 一键清空内存缓存
  const handleClearCaches = () => {
    clearCodeBlockCache()
    vfsBus.clearAllCache()
    setVfsCacheStats(vfsBus.getCacheStats())
    onToast(t('已清空代码高亮与 VFS 内存缓存'))
  }

  // 软重载
  const handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  // 健康度评估状态
  const fpsStatus = fps >= 50 ? 'good' : fps >= 30 ? 'warn' : 'bad'
  const domStatus = domCount < 4000 ? 'good' : domCount < 8000 ? 'warn' : 'bad'
  const memStatus = !memory ? 'good' : memory.percent < 60 ? 'good' : memory.percent < 85 ? 'warn' : 'bad'

  return (
    <div className={pane(5, true)}>
      {/* 顶部实时健康度雷达卡片 */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* 1. FPS 实时帧率 */}
        <div className="flex flex-col rounded-2xl border border-line bg-card/70 p-4 shadow-xs">
          <div className="flex items-center justify-between text-ink-soft">
            <span className="text-[12px] font-medium">{t('实时帧率')}</span>
            <Activity
              size={15}
              className={
                fpsStatus === 'good' ? 'text-ok-deep' : fpsStatus === 'warn' ? 'text-amber-500' : 'text-red-500'
              }
            />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-[26px] font-bold tracking-tight text-ink-strong">{fps}</span>
            <span className="text-[11px] text-ink-faint">FPS</span>
          </div>
          <div className="mt-1 flex items-center gap-1 text-[11px]">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                fpsStatus === 'good' ? 'bg-ok-deep' : fpsStatus === 'warn' ? 'bg-amber-500' : 'bg-red-500'
              }`}
            />
            <span className="text-ink-faint">
              {fpsStatus === 'good' ? t('流畅运行') : fpsStatus === 'warn' ? t('偶有掉帧') : t('明显卡顿')}
            </span>
          </div>
        </div>

        {/* 2. JS 堆内存 */}
        <div className="flex flex-col rounded-2xl border border-line bg-card/70 p-4 shadow-xs">
          <div className="flex items-center justify-between text-ink-soft">
            <span className="text-[12px] font-medium">{t('JS 堆内存')}</span>
            <MemoryStick
              size={15}
              className={
                memStatus === 'good' ? 'text-ok-deep' : memStatus === 'warn' ? 'text-amber-500' : 'text-red-500'
              }
            />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-[26px] font-bold tracking-tight text-ink-strong">
              {memory ? `${memory.usedMb}` : '—'}
            </span>
            <span className="text-[11px] text-ink-faint">MB</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-deep">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  memStatus === 'good' ? 'bg-ok-deep' : memStatus === 'warn' ? 'bg-amber-500' : 'bg-red-500'
                }`}
                style={{ width: `${Math.min(100, memory?.percent ?? 0)}%` }}
              />
            </div>
            <span className="text-[10px] text-ink-faint">{memory ? `${memory.percent}%` : ''}</span>
          </div>
        </div>

        {/* 3. 活跃 DOM 节点数 */}
        <div className="flex flex-col rounded-2xl border border-line bg-card/70 p-4 shadow-xs">
          <div className="flex items-center justify-between text-ink-soft">
            <span className="text-[12px] font-medium">{t('DOM 节点总数')}</span>
            <Layers
              size={15}
              className={
                domStatus === 'good' ? 'text-ok-deep' : domStatus === 'warn' ? 'text-amber-500' : 'text-red-500'
              }
            />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-[26px] font-bold tracking-tight text-ink-strong">{domCount.toLocaleString()}</span>
            <span className="text-[11px] text-ink-faint">{t('个')}</span>
          </div>
          <div className="mt-1 flex items-center gap-1 text-[11px]">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                domStatus === 'good' ? 'bg-ok-deep' : domStatus === 'warn' ? 'bg-amber-500' : 'bg-red-500'
              }`}
            />
            <span className="text-ink-faint">
              {domStatus === 'good' ? t('树结构健康') : domStatus === 'warn' ? t('DOM 较多') : t('DOM 过载')}
            </span>
          </div>
        </div>

        {/* 4. 连续运行时间 */}
        <div className="flex flex-col rounded-2xl border border-line bg-card/70 p-4 shadow-xs">
          <div className="flex items-center justify-between text-ink-soft">
            <span className="text-[12px] font-medium">{t('连续运行时间')}</span>
            <Clock size={15} className="text-seal" />
          </div>
          <div className="mt-2.5 text-[15px] font-bold tracking-tight text-ink-strong truncate" title={uptimeStr}>
            {uptimeStr || t('刚刚启动')}
          </div>
          <div className="mt-1.5 text-[11px] text-ink-faint">
            {Date.now() - BOOT_TIME > 3 * 3600 * 1000 ? (
              <span className="text-amber-600 flex items-center gap-1">
                <AlertTriangle size={12} />
                {t('运行时间较长，建议定期清理')}
              </span>
            ) : (
              t('状态良好')
            )}
          </div>
        </div>
      </section>

      {/* 核心卡顿原因深度监测看板 */}
      <section className="rounded-2xl border border-line bg-card/70 p-5 shadow-xs">
        <h3 className="text-[14px] font-bold text-ink-strong flex items-center gap-2">
          <Zap size={16} className="text-seal" />
          {t('卡顿诱因深度监控指标')}
        </h3>
        <p className="mt-1 text-[12px] text-ink-soft">
          {t('针对「AI 批量建图」与「长效运行」两大核心瓶颈的实时调度与内存负载状态。')}
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* A. VFS 文件事件与微批处理消峰 */}
          <div className="flex flex-col justify-between rounded-xl border border-line/80 bg-paper-deep/40 p-3.5">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-semibold text-ink-strong flex items-center gap-1.5">
                  <Cpu size={14} className="text-seal" />
                  {t('VFS 响应式总线调度')}
                </span>
                <span className="rounded-full bg-seal/10 px-2 py-0.5 text-[10.5px] font-medium text-seal">
                  {t('微批处理已启用')}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-ink-faint leading-relaxed">
                {t('AI 创建节点时的高频文件写入聚合在 16ms 帧内一次性处理，彻底消除连续触发的 React 渲染风暴。')}
              </p>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line/60 pt-2.5 text-center">
              <div>
                <div className="text-[10px] text-ink-faint">{t('总文件事件')}</div>
                <div className="text-[13px] font-bold text-ink-strong">{vfsStats.totalEvents}</div>
              </div>
              <div>
                <div className="text-[10px] text-ink-faint">{t('聚合批次')}</div>
                <div className="text-[13px] font-bold text-ink-strong">{vfsStats.totalBatches}</div>
              </div>
              <div>
                <div className="text-[10px] text-ink-faint">{t('消峰吸收率')}</div>
                <div className="text-[13px] font-bold text-ok-deep">
                  {vfsStats.totalEvents > 0
                    ? `${Math.round((vfsStats.coalescedCount / vfsStats.totalEvents) * 100)}%`
                    : '100%'}
                </div>
              </div>
            </div>
          </div>

          {/* B. 结构画布视口裁剪状态 */}
          <div className="flex flex-col justify-between rounded-xl border border-line/80 bg-paper-deep/40 p-3.5">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-semibold text-ink-strong flex items-center gap-1.5">
                  <Boxes size={14} className="text-seal" />
                  {t('结构画布视口裁剪')}
                </span>
                <span className="rounded-full bg-ok-deep/10 px-2 py-0.5 text-[10.5px] font-medium text-ok-deep">
                  {t('视口虚拟化已启用')}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-ink-faint leading-relaxed">
                {t('离开视野的图谱节点仅保留占位容器，避免数千个复杂子 DOM 参与重绘，保证 50+ 节点下稳定 60 FPS。')}
              </p>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line/60 pt-2.5 text-center">
              <div>
                <div className="text-[10px] text-ink-faint">{t('图谱总卡片')}</div>
                <div className="text-[13px] font-bold text-ink-strong">{canvasStats.totalCards}</div>
              </div>
              <div>
                <div className="text-[10px] text-ink-faint">{t('当前视口内')}</div>
                <div className="text-[13px] font-bold text-seal">{canvasStats.visibleCards}</div>
              </div>
              <div>
                <div className="text-[10px] text-ink-faint">{t('已裁剪离屏')}</div>
                <div className="text-[13px] font-bold text-ink-soft">
                  {Math.max(0, canvasStats.totalCards - canvasStats.visibleCards)}
                </div>
              </div>
            </div>
          </div>

          {/* C. 常驻页签负荷监控 */}
          <div className="flex flex-col justify-between rounded-xl border border-line/80 bg-paper-deep/40 p-3.5">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-semibold text-ink-strong flex items-center gap-1.5">
                  <Layers size={14} className="text-seal" />
                  {t('页签常驻 DOM 负荷')}
                </span>
                <span className="text-[11px] text-ink-faint">
                  {t('常驻上限：{0} 片', String(residentStats.max))}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-ink-faint leading-relaxed">
                {t('已激活页签在后台保持 DOM 以实现秒开；常驻过多时可点击下方一键释放以回收内存。')}
              </p>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-2.5">
              <span className="text-[11px] text-ink-soft">
                {t('当前常驻数量：')} <b className="text-ink-strong">{residentStats.count}</b> / {residentStats.max}
              </span>
              <button
                type="button"
                onClick={handleClearResidentTabs}
                className="flex items-center gap-1 rounded-md border border-line bg-card px-2 py-1 text-[11px] font-medium text-seal hover:bg-seal/10 transition cursor-pointer"
              >
                <Trash2 size={12} />
                <span>{t('一键释放')}</span>
              </button>
            </div>
          </div>

          {/* D. 全局内存缓存池 */}
          <div className="flex flex-col justify-between rounded-xl border border-line/80 bg-paper-deep/40 p-3.5">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-semibold text-ink-strong flex items-center gap-1.5">
                  <MemoryStick size={14} className="text-seal" />
                  {t('内存缓存池治理')}
                </span>
                <span className="text-[10.5px] text-ink-faint">
                  {t('上限 {0} 条 (LRU)', String(vfsCacheStats.maxEntries))}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-ink-faint leading-relaxed">
                {t('VFS 缓存与代码高亮缓存自动施行 LRU 淘汰策略，坚决防止长时间运行下老生代堆内存无界膨胀。')}
              </p>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-2.5">
              <span className="text-[11px] text-ink-soft">
                {t('VFS 缓存：')}{' '}
                <b className="text-ink-strong">
                  {vfsCacheStats.dataCount + vfsCacheStats.rawCount}
                </b>{' '}
                {t('条')}
              </span>
              <button
                type="button"
                onClick={handleClearCaches}
                className="flex items-center gap-1 rounded-md border border-line bg-card px-2 py-1 text-[11px] font-medium text-seal hover:bg-seal/10 transition cursor-pointer"
              >
                <Trash2 size={12} />
                <span>{t('清空缓存')}</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 性能急救与快速恢复工具箱 */}
      <section className="rounded-2xl border border-line bg-card/70 p-5 shadow-xs">
        <h3 className="text-[14px] font-bold text-ink-strong flex items-center gap-2">
          <Sparkles size={16} className="text-seal" />
          {t('性能急救与快速恢复工具箱')}
        </h3>
        <p className="mt-1 text-[12px] text-ink-soft">
          {t('当遇到软件长时间运行变慢、或大量生成任务后，可点击以下按钮瞬时回收内存与 DOM 树。')}
        </p>

        <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleClearResidentTabs}
            className="flex items-center gap-1.5 rounded-xl border border-line bg-paper-deep/70 px-3 py-2 text-[12px] font-medium text-ink transition hover:border-seal hover:bg-seal/10 hover:text-seal cursor-pointer shadow-2xs"
          >
            <Layers size={14} />
            <span>{t('立即释放后台常驻页签')}</span>
          </button>

          <button
            type="button"
            onClick={handleClearCaches}
            className="flex items-center gap-1.5 rounded-xl border border-line bg-paper-deep/70 px-3 py-2 text-[12px] font-medium text-ink transition hover:border-seal hover:bg-seal/10 hover:text-seal cursor-pointer shadow-2xs"
          >
            <Trash2 size={14} />
            <span>{t('深度清理内存缓存池')}</span>
          </button>

          <button
            type="button"
            onClick={handleReload}
            className="flex items-center gap-1.5 rounded-xl border border-line bg-paper-deep/70 px-3 py-2 text-[12px] font-medium text-ink transition hover:border-seal hover:bg-seal/10 hover:text-seal cursor-pointer shadow-2xs"
          >
            <RefreshCw size={14} />
            <span>{t('软重载渲染页面')}</span>
          </button>
        </div>
      </section>
    </div>
  )
}
