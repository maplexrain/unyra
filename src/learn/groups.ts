/**
 * 文档区的**分组与分割**（vscode 的编辑器组那一套）。
 *
 * 从前文档区只有「一排页签 + 一片正文」：一个页签栏、一个激活项，全写在 store 的
 * tabs / activeTab 两个字段里。要能像 vscode 那样拖开、左右上下分屏，这两个字段就不够了——
 * 每一格都得有自己的页签栏、自己的激活项，而格子之间怎么摆又是另一件事。于是拆成两半：
 *
 * - **组**（DocGroup）管「这一格里开着哪些页签、现在看的是哪一个」；
 * - **布局树**（DocLayout）管「这些格子怎么摆」——叶子是一组，内部节点是一次分割，
 *   可以一直往深里分（左半边再上下分，右半边再左右分……），「尽量自由」说的就是它。
 *
 * 布局树里只记组的 id，页签本身住在 groups 里，两边靠 id 对齐；
 * 因此「把已经不存在的组收拾掉」这种动作只要过一遍树就够了（见 closeIds）。
 *
 * 全是纯函数：分割、跨格移动页签、关掉一组之后谁接管焦点，这些算错了在界面上是
 * 「页签跑丢了 / 那一格再也点不动」，而那种错一眼看不出来——所以它们都能被单元测试
 * 钉住（见 tests/groups.test.ts）。
 */

/**
 * 本文件是 barrel：实现按职责拆在 learn/groups/ 下，这里只把原来的导出原样转出去，
 * 调用方的 import 一行都不用改。
 *
 * - groups/types.ts     布局树 / 每格的页签 / 焦点 / 拖动落点的形状（只有类型）
 * - groups/layout.ts    布局树本身：id、空工作区、查找、拆分与合并、占比与落点怎么拆
 * - groups/core.ts      工作区级更新地基：groupOf / withDocs / settle / setSizes
 * - groups/focus.ts     焦点格与「这一格在看哪一份」
 * - groups/tabs.ts      每格的页签列：开关、激活、顺序、常驻名额、跨格拖动
 * - groups/drop.ts      拖动落点的几何（zoneAtPoint）
 * - groups/normalize.ts 读盘：把 state.json 里的那一份认回来
 */

export type {
  DocGroup,
  DocLayout,
  DocSplit,
  DocWorkspace,
  DropZone,
  DropZoneKind,
  SplitDir,
} from './groups/types'

export {
  FIRST_GROUP,
  MIN_SPLIT_FRAC,
  emptyDocs,
  findSplit,
  groupIdsOf,
  newId,
  normalizeSizes,
  resizePair,
  splitSpecOf,
} from './groups/layout'

export { groupOf, setSizes } from './groups/core'

export {
  findTab,
  focusedGroup,
  focusedTab,
  groupIdOfTab,
  setFocus,
} from './groups/focus'

export {
  activateIn,
  activeIdsOf,
  allTabs,
  closeIds,
  closeIn,
  landingAfter,
  moveTab,
  openInGroup,
  patchTab,
  renameTabRef,
  reorderIn,
  splitWith,
} from './groups/tabs'

export { DROP_EDGE, zoneAtPoint } from './groups/drop'

export { normalizeDocs } from './groups/normalize'
