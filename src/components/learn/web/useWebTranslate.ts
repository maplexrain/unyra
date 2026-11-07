/**
 * 网页翻译与动态监听机制（拆自 WebTabLayer）：
 * 整页双语翻译、划词翻译、对照开关、译文清除，以及 MutationObserver
 * 动态内容监听（滚动加载 / SPA 跳转后的增量翻译）。「正在翻译」状态与
 * 提示 toast 也在这里；主进程右键菜单发起的翻译指令订阅同样归此。
 * 宿主侧（WebTabLayer）只消费返回的状态与回调。
 */
import { useEffect, useRef, useState } from 'react'
import { isElectron, native, type WebTranslatePayload } from '../../../lib/native'
import { getLocale, t } from '../../../i18n'
import { webviewByWcId, webviewOf } from '../../../learn/web/webviewRegistry'
import { translateBatch, translateSingle, type TranslationEngine } from '../../../learn/web/translator'
import {
  buildClearTranslationsScript,
  buildExtractBlocksScript,
  buildInsertTranslationsScript,
  buildSelectionPopupScript,
  buildStartDomObserverScript,
  buildStopDomObserverScript,
  buildToggleTranslationsScript,
  buildUnmarkTranslatingScript,
} from '../../../learn/web/guestTranslate'
import type { WebTab } from './WebTabLayer'

/** 翻译机制需要的宿主数据：右键翻译指令按 wcId 反查不到元素时，兜底落到当前页签 */
export interface WebTranslateDeps {
  tabs: WebTab[]
  active: WebTab | null
}

export function useWebTranslate({ tabs, active }: WebTranslateDeps) {
  const [translatingTabId, setTranslatingTabId] = useState<string | null>(null)
  const [transToast, setTransToast] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 记录开启动态内容变动监听的页签及所使用的翻译引擎
  const observingMapRef = useRef<Map<string, { engine: TranslationEngine }>>(new Map())
  const [observingTabIds, setObservingTabIds] = useState<Set<string>>(new Set())

  const showToast = (msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setTransToast(msg)
    toastTimerRef.current = setTimeout(() => {
      setTransToast(null)
    }, 3500)
  }

  /** 当页面 DOM 发生变动（滚动加载、SPA 跳转、动态渲染等）时触发增量翻译 */
  const handleDomMutation = async (tabId: string) => {
    const state = observingMapRef.current.get(tabId)
    if (!state) return
    const wv = webviewOf(tabId)
    if (!wv) return

    const targetLang = getLocale() === 'zh' ? 'zh-CN' : getLocale()
    try {
      const extractRes = (await wv.executeJavaScript(buildExtractBlocksScript(targetLang))) as {
        ok?: boolean
        candidates?: Array<{ id: string; text: string }>
      }
      const candidates = extractRes?.candidates || []
      if (candidates.length > 0) {
        // 出多少，翻多少，独立并发派送，无需统计进度
        void translateBatch(candidates, state.engine, {
          targetLang,
          onChunkReady: (batch) => {
            if (batch.length > 0) {
              void wv.executeJavaScript(buildInsertTranslationsScript(batch)).catch(() => {})
            }
          },
          onFailed: (failedIds) => {
            if (failedIds.length > 0) {
              void wv.executeJavaScript(buildUnmarkTranslatingScript(failedIds)).catch(() => {})
            }
          },
        })
      }
    } catch {
      // 增量动态翻译静默容错
    }
  }

  const handlePageTranslate = async (tabId: string, engine: TranslationEngine) => {
    const wv = webviewOf(tabId)
    if (!wv) return
    try {
      setTranslatingTabId(tabId)
      // 若当前页面此前已存在译文或状态残留，先清除旧译文及标记，确保换引擎或重译时能完整扫描整页
      await wv.executeJavaScript(buildClearTranslationsScript()).catch(() => {})

      const targetLang = getLocale() === 'zh' ? 'zh-CN' : getLocale()

      const extractRes = (await wv.executeJavaScript(buildExtractBlocksScript(targetLang))) as {
        ok?: boolean
        candidates?: Array<{ id: string; text: string }>
        error?: string
      }

      if (!extractRes || !extractRes.ok) {
        showToast(t('提取网页内容失败：{0}', extractRes?.error || '未知原因'))
        setTranslatingTabId(null)
        return
      }

      const candidates = extractRes.candidates || []
      if (candidates.length === 0) {
        showToast(t('未检测到需要翻译的外文内容'))
      } else {
        // 全并发立即发出翻译任务，哪个好了就立刻挂载，不显示统计计数
        void translateBatch(candidates, engine, {
          targetLang,
          onChunkReady: (batch) => {
            if (batch.length > 0) {
              void wv.executeJavaScript(buildInsertTranslationsScript(batch)).catch(() => {})
            }
          },
          onFailed: (failedIds) => {
            if (failedIds.length > 0) {
              void wv.executeJavaScript(buildUnmarkTranslatingScript(failedIds)).catch(() => {})
            }
          },
        })
      }

      // 自动开启动态内容变动监听（MutationObserver）
      await wv.executeJavaScript(buildStartDomObserverScript()).catch(() => {})
      observingMapRef.current.set(tabId, { engine })
      setObservingTabIds(new Set(observingMapRef.current.keys()))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast(t('翻译失败：{0}', msg))
    } finally {
      setTranslatingTabId(null)
    }
  }

  const handleSelectionTranslate = async (
    tabId: string,
    text: string,
    engine: TranslationEngine,
    x?: number,
    y?: number,
  ) => {
    const wv = webviewOf(tabId)
    if (!wv || !text.trim()) return
    try {
      const targetLang = getLocale() === 'zh' ? 'zh-CN' : getLocale()
      const translation = await translateSingle(text, engine, targetLang)
      if (!translation) {
        showToast(t('未能获得译文'))
        return
      }
      await wv.executeJavaScript(
        buildSelectionPopupScript({
          original: text,
          translation,
          engine,
          x: x ?? 120,
          y: y ?? 120,
        }),
      )
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast(t('翻译失败：{0}', msg))
    }
  }

  const handleToggleTranslate = async (tabId: string) => {
    const wv = webviewOf(tabId)
    if (!wv) return
    const res = await wv.executeJavaScript(buildToggleTranslationsScript())
    if (res === 'hidden') {
      showToast(t('已隐藏双语对照'))
    } else {
      showToast(t('已恢复显示双语对照'))
    }
  }

  const handleClearTranslate = async (tabId: string) => {
    const wv = webviewOf(tabId)
    if (!wv) return
    observingMapRef.current.delete(tabId)
    setObservingTabIds(new Set(observingMapRef.current.keys()))
    await wv.executeJavaScript(buildStopDomObserverScript()).catch(() => {})
    const count = await wv.executeJavaScript(buildClearTranslationsScript())
    showToast(t('已清除 {0} 处译文并停止动态监听', count || 0))
  }

  const handleToggleObserver = async (tabId: string) => {
    const wv = webviewOf(tabId)
    if (!wv) return
    if (observingMapRef.current.has(tabId)) {
      observingMapRef.current.delete(tabId)
      setObservingTabIds(new Set(observingMapRef.current.keys()))
      await wv.executeJavaScript(buildStopDomObserverScript()).catch(() => {})
      showToast(t('已停止动态内容监听'))
    } else {
      observingMapRef.current.set(tabId, { engine: 'fast' })
      setObservingTabIds(new Set(observingMapRef.current.keys()))
      await wv.executeJavaScript(buildStartDomObserverScript()).catch(() => {})
      showToast(t('已开启动态内容监听'))
    }
  }

  /*
    订阅主进程右键菜单发起的翻译指令
  */
  useEffect(() => {
    if (!isElectron()) return
    return native().browser.onTranslate((payload: WebTranslatePayload) => {
      const wv = webviewByWcId(payload.wcId) ?? (active ? webviewOf(active.id) : undefined)
      if (!wv) return
      const targetTab = tabs.find((t) => webviewOf(t.id) === wv) ?? active
      if (!targetTab) return

      if (payload.mode === 'toggle') {
        void handleToggleTranslate(targetTab.id)
      } else if (payload.mode === 'clear') {
        void handleClearTranslate(targetTab.id)
      } else if (payload.mode === 'selection' && payload.text) {
        void handleSelectionTranslate(
          targetTab.id,
          payload.text,
          payload.engine ?? 'fast',
          payload.x,
          payload.y,
        )
      } else if (payload.mode === 'page') {
        void handlePageTranslate(targetTab.id, payload.engine ?? 'fast')
      }
    })
  }, [active, tabs])

  /** 页签重新导航（WebPage 的 did-start-loading / did-navigate 回调注入）：
   *  清掉该页签的动态监听记录，新页面的 DOM 要重新开始观察 */
  const resetObserving = (tid: string) => {
    observingMapRef.current.delete(tid)
    setObservingTabIds(new Set(observingMapRef.current.keys()))
  }

  return {
    translatingTabId,
    transToast,
    observingTabIds,
    showToast,
    handleDomMutation,
    handlePageTranslate,
    handleToggleTranslate,
    handleClearTranslate,
    handleToggleObserver,
    resetObserving,
  }
}
