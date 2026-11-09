import { createRoot, type Root } from 'react-dom/client'
import { decodeAttr } from '../renderPlugins'
import { aiqaBlockHost } from './host'
import AiqaCard from './AiqaCard'

/**
 * 挂载 root 内所有 aiqa 占位容器为可交互卡片组件；返回清理函数。
 */
export function hydrateAiqa(root: HTMLElement): () => void {
  const elements = root.querySelectorAll<HTMLElement>('.moji-aiqa[data-aiqa-id]')
  const mountedRoots: Root[] = []

  for (const el of Array.from(elements)) {
    const id = decodeAttr(el.dataset.aiqaId)
    const question = decodeAttr(el.dataset.aiqaQuestion)
    const system = decodeAttr(el.dataset.aiqaSystem)
    if (!id) continue

    const nodeId =
      el.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId ??
      aiqaBlockHost()?.getActiveNodeId() ??
      undefined

    try {
      const reactRoot = createRoot(el)
      reactRoot.render(
        <AiqaCard
          id={id}
          question={question}
          system={system}
          nodeId={nodeId}
        />,
      )
      mountedRoots.push(reactRoot)
    } catch (err) {
      console.warn('[aiqaBlock] hydrate error', err)
    }
  }

  return () => {
    for (const r of mountedRoots) {
      try {
        r.unmount()
      } catch (err) {
        console.warn('[aiqaBlock] unmount error', err)
      }
    }
  }
}
