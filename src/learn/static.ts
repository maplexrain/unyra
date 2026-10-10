/**
 * 目标级资源库：\`{目标}/static/\` 下的文件，外加一份清单 \`manifest.json\`。
 *
 * 为什么要有它：附件、插图、外部素材以前只有「聊天气泡里那一份」（见 learn/images），
 * 只能跟着某条消息走，文档里引用不了、复用不了，删了消息就没了。资源库把文件从
 * 「某条消息的附件」提升为**目标级别的资产**：
 *
 * \`\`\`
 * {目标}/static/
 *   manifest.json              资源清单（uuid/名称/后缀/类型/描述/日期/大小）
 *   3f2a1b…-….png              文件本体，文件名就是 uuid（保留原后缀）
 * \`\`\`
 *
 * 几个决定：
 * - **文件名用 uuid，不用原标题**。同名文件互相覆盖、重名要加序号、改名要动文件——
 *   这些麻烦全部消失；展示名放在清单里，改名只是改一行 JSON。后缀保留是为了
 *   「在资源管理器里能双击打开」，这与数据目录一贯的取舍一致。
 * - **清单在磁盘上、也在内存里**。落盘路径与 chat.json / tmp.json 同一条（见 files.ts
 *   的 buildDocs）：写入是差异比对、关窗前能同步兜底，读回来走 parseDocs。
 * - **本模块里的路径一律「相对当前用户」**（`docs/{目标}/static/…`），落盘时由
 *   lib/storage 的 `*User*` 那一组补上 `users/{uid}/` 前缀。直接调 storage 的裸函数
 *   会把文件写到数据根下的 `docs/`，与走 buildDocs 的清单**分家**——这正是修过的那件事。
 *   内存里存一份是为了渲染时**同步**拿得到类型与展示名——异步查清单会让文档渲染闪一下。
 * - **清单不进上下文，也不该被模型整份读进去**。资源是给文档和模型按需取用的。
 * - 被引用的资源不允许静默删除：引用扫描能说出「谁在引用它」（见 scanRefs），
 *   删除时若还有引用，要求显式 force（见 agent 的 res.delete）。
 */

/**
 * 本文件是 barrel：实现按职责拆在 learn/static/ 下，这里只把原来的导出原样转出去，
 * 调用方的 import 一行都不用改。
 *
 * - static/types.ts     数据形状：一条资源、它属于文本还是二进制、谁引用了它
 * - static/ext.ts       后缀 / 类型 / mime 的推导与展示名
 * - static/manifest.ts  清单（序列化）：manifestText 写出、parseManifest 读回
 * - static/location.ts  位置：目标目录、资源目录与文件本体在数据根下的相对路径
 * - static/ops.ts       清单的纯函数读写（增删改查，一律返回新 store）
 * - static/hash.ts      内容指纹：SHA-256，取不到时退回 FNV-1a
 * - static/refs.ts      引用扫描：moji:static/ 的写法与「谁引用了它」
 * - static/read.ts      读文件：文本内容、图片字节（与聊天气泡共用缓存）、游离文件
 * - static/write.ts     落盘与清理：附件转存、写正文、删文件、在资源管理器里定位
 */

export type { ResourceRef, ResourceType, StaticResource } from './static/types'

export {
  baseNameOf,
  extOf,
  fileNameOf,
  isImageExt,
  mimeOfExt,
  shortUuid,
  typeOfExt,
} from './static/ext'

export { MANIFEST_VERSION, manifestText, normalizeResourceList, parseManifest } from './static/manifest'

export { goalDirOf, goalStaticDir, manifestPathOf, resourceRel, retargetStaticRefs } from './static/location'

export {
  addResource,
  dropResource,
  findResource,
  makeResource,
  patchResource,
  resourcesOf,
  withResources,
} from './static/ops'

export { findByHash, hashBytes, hashOfText, shortHash } from './static/hash'

export {
  STATIC_SCHEME,
  refCountOf,
  scanRefs,
  staticToken,
  uuidsIn,
  uuidFromHref,
} from './static/refs'

export {
  cachedResourceUrl,
  listUntracked,
  loadImageByRel,
  loadResourceImage,
  readResourceText,
  subscribeResources,
} from './static/read'

export type { SaveResourceResult } from './static/write'
export {
  MAX_RESOURCE_BYTES,
  formatBytes,
  messageFileOf,
  removeResourceFile,
  revealResource,
  saveStaticImage,
  saveStaticText,
  writeResourceText,
} from './static/write'
