/*
 * 这个文件负责：**一片常驻的正文**（memo 化的单格文档视图，含滚动位置）。
 *
 * 为什么要常驻：切页签时贵的是**重建 DOM**——把 markdown 产出的那几千个元素重新塞进页面、
 * 四类 hydrate 再扫一遍、几处强制排版再量一遍（解析本身有缓存，切回来是 0.00 ms，
 * 读数见 tests/markdownPerf.test.ts）。DOM 留着，这些活儿就只剩「切一下显示」。
 *
 * 隐藏用 hidden 属性（display:none）：它不参与样式重算、排版与绘制，留着几乎不花每帧的钱。
 * 相邻的几处「对着眼前这份文档做的事」也一并按显示的那一片收了口：
 * 查找、滚动定位、ui.dom、导出抓图，见 lib/docDom 的 visibleDocBody。
 */

import { memo, useEffect, type ComponentProps } from 'react'
import type { KnowledgeNode } from '../../../learn/types'
import type { OutlineHandle } from '../../../lib/outline'
import { touchRecent } from '../../../learn/resident'
import NodeNote from '../NodeNote'
import type { DocSource } from '../NodeNote'
import { useLocale } from '../../../i18n'

export interface DocPaneProps {
  tabId: string
  /** 在眼前吗。注意不等于「当前页签」：源码视图下当前页签也不显示预览那一份 */
  active: boolean
  node: KnowledgeNode
  source: DocSource
  pending: boolean
  knownConceptKeys?: Set<string>
  readingPaused: boolean
  /** 文档栏在不在中间主位（导师栏占着主位时为 false）：有效阅读据此停表 */
  mainPane: boolean
  /** 大纲句柄槽（见 lib/outline 的 OutlineHandle）：悬浮大纲按钮据此取「眼前这份」的大纲 */
  outlineSlot: { current: OutlineHandle | null }
  /** 上一次读到哪儿 / 报到哪儿（见 lib/docScroll）；比较时**不参与**：它只影响恢复 */
  scrollTop?: number
  onScrollTop?: (top: number) => void
  /** 已绑到本片页签节点上的回调（父组件按节点现造） */
  note: Omit<
    ComponentProps<typeof NodeNote>,
    'node' | 'doc' | 'pending' | 'knownConceptKeys' | 'active' | 'mainPane'
  >
}

/**
 * 隐藏的那几片要不要跟着 store 重渲染。
 *
 * React 不认识 display:none：不冻住的话，学习区每次 store 变化（发消息、agent 逐字写、
 * 存注解、时钟 tick）都要把 N 片正文一起重渲染一遍——那是把「切换卡」换成「平时卡」，
 * 比原来更糟。所以：
 * - 在眼前的那一片**永远**重渲染（待写提示、注解、链接外观都可能刚变）；
 * - 隐藏的那几片只在「换了一片页签」或「正文真的被改了」时才重渲染。
 *   动作回调的身份不参与比较：它们是父组件每次渲染现造的闭包，且一律走 getLatest()
 *   读最新数据（见 useLearnStore），冻住一份旧闭包不会读到过期数据。
 */
function samePane(prev: DocPaneProps, next: DocPaneProps): boolean {
  if (prev.active !== next.active || prev.tabId !== next.tabId) return false
  if (next.active) return false
  return prev.source.content === next.source.content && prev.node === next.node
}

export const DocPane = memo(function DocPane({
  tabId,
  active,
  node,
  source,
  pending,
  knownConceptKeys,
  readingPaused,
  mainPane,
  outlineSlot,
  scrollTop,
  onScrollTop,
  note,
}: DocPaneProps) {
  // memo（samePane）挡住了无关重渲染：界面语言变化要自己订阅才跟得上
  useLocale()
  // 登记「这一片在用」：常驻名额按它排（见 learn/resident）。
  // 写在 effect 里是因为它是外部状态，不是渲染结果；只有真的显示出来时才记。
  useEffect(() => {
    if (active) touchRecent(tabId)
  }, [active, tabId])

  return (
    /*
      隐藏用 hidden 属性 + **不给任何 className**：Tailwind 的 .flex/.hidden 都是普通工具类，
      与 preflight 的 [hidden] 规则同优先级——隐藏的那一片若还带着 .flex，它就会照旧显示。
      干脆不给类：UA 样式表的 [hidden] { display: none } 说了算，也不会白算一遍样式。
      对外能认出来「哪一片在显示」靠 data-doc-pane + hidden 这两个属性（见 lib/docDom）。
    */
    <div
      data-doc-pane={active ? 'active' : 'idle'}
      {...(active ? { className: 'print-flat relative flex min-h-0 flex-1 flex-col' } : { hidden: true })}
    >
      <NodeNote
        // key 绑「节点 + 文档」：两者任一变化都卸载重挂，注解窗口、选中菜单等
        // 浮层状态自然清空——换了一份文档之后，原来那个选区已经不在眼前了
        key={tabId + ':' + source.kind + ':' + (source.note ?? '')}
        active={active}
        node={node}
        doc={source}
        pending={pending}
        knownConceptKeys={knownConceptKeys}
        readingPaused={readingPaused}
        mainPane={mainPane}
        outlineSlot={outlineSlot}
        scrollTop={scrollTop}
        onScrollTop={onScrollTop}
        {...note}
      />
    </div>
  )
}, samePane)
