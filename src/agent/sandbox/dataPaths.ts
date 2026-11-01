/**
 * 这个文件负责什么：**应用数据与通用文件的分界**。
 *
 * 从这一版起，应用数据（教学文档、笔记、大纲、meta、试卷、超级文档、会话、工作流、
 * 函数、阅读账、画像）只能走对应的 `api.<组>.*`；`files.*` 只服务四类路径：
 * `workspace/`、`static/`、`skills/`、以及数据根之外用户放行的外部文件。
 *
 * 为什么要有这道闸：文件能表达的东西太少——同一个 `.meta.json` 里哪些字段会回灌 store、
 * 哪些不会，只能靠文档说；而文档会漂。把路径分类写死在代码里，模型拿 files.* 碰到
 * 应用数据时当场得到「该用哪一组 api」的准确提示，比事后发现「写了但没生效」便宜得多。
 */
import { storageRoot, userAbsPrefix } from '../../lib/storage'

export type DataPathKind = 'app-data' | 'workspace' | 'static' | 'skills' | 'external'

export interface DataPathVerdict {
  kind: DataPathKind
  /** 应用数据对应的 api 组（不含 `.*`），如 `doc` / `state` / `exam` */
  api?: string
  /** 给人看的一句话：为什么归到这一类 */
  note?: string
}

/** 把各种写法归一成「相对当前用户」的路径；外部绝对路径保持原样 */
function normalizePath(raw: string): string {
  let p = (raw ?? '').trim().replace(/\\/g, '/')
  while (p.startsWith('./')) p = p.slice(2)
  p = p.replace(/\/{2,}/g, '/')

  const userPrefix = userAbsPrefix()?.replace(/\\/g, '/').replace(/\/+$/, '')
  if (userPrefix && p.startsWith(userPrefix + '/')) {
    p = p.slice(userPrefix.length + 1)
  }
  const root = storageRoot()?.replace(/\\/g, '/').replace(/\/+$/, '')
  if (root && p.startsWith(root + '/')) {
    p = p.slice(root.length + 1)
  }
  // {root}/users/{uid}/... 的写法（没有走到 userAbsPath 时）
  if (p.startsWith('users/')) {
    const segs = p.split('/')
    if (segs.length >= 3) p = segs.slice(2).join('/')
  }
  return p
}

/**
 * 路径分类。顺序就是优先级：workspace/static 先于「docs 下都是应用数据」，
 * 因为它们虽然住在 docs 里，却是用户可自由读写的交付物。
 */
export function classifyDataPath(raw: string): DataPathVerdict {
  const p = normalizePath(raw)
  if (!p) return { kind: 'external', note: '空路径按数据根处理' }

  if (p === 'skills' || p.startsWith('skills/')) {
    return { kind: 'skills', note: '技能目录' }
  }

  if (p === 'docs' || p.startsWith('docs/')) {
    const rest = p.slice('docs/'.length)
    // docs/{目标}/.../{节点}/workspace/**
    if (/(^|\/)workspace(\/|$)/.test(rest)) {
      return { kind: 'workspace', note: '节点工作区（用户交付物）' }
    }
    // docs/{目标}/static/** 与旧的 images/**
    if (/(^|\/)static(\/|$)/.test(rest) || /(^|\/)images(\/|$)/.test(rest)) {
      return { kind: 'static', note: '目标静态资源' }
    }
    // 余下全部是应用数据。按文件名/目录名给出该用哪一组 api：
    // 节点的所有内容（正文 / 大纲 / 笔记 / 试卷 / 超级文档）都归节点宇宙——api.node 拿对象，editContent 写。
    if (/(^|\/)superdocs\/[^/]+\.html$/i.test(rest)) {
      return { kind: 'app-data', api: 'node', note: '超级文档' }
    }
    if (/(^|\/)exams\/[^/]+\.json$/i.test(rest)) {
      return { kind: 'app-data', api: 'node', note: '试卷（作答侧的读卷 / 阅卷在 api.exam）' }
    }
    if (/\.notes\/[^/]+\.md$/i.test(rest)) {
      return { kind: 'app-data', api: 'node', note: '笔记' }
    }
    if (/\.outline\.json$/i.test(rest)) {
      return { kind: 'app-data', api: 'node', note: '节点大纲' }
    }
    if (/\.meta\.json$/i.test(rest)) {
      return { kind: 'app-data', api: 'node', note: '节点元数据（最近打开等）——动节点数据走 api.node' }
    }
    if (/\.node\.json$/i.test(rest)) {
      return {
        kind: 'app-data',
        api: 'node',
        note: '节点文件：正文 / 大纲 / 笔记 / 试卷 / 超级文档全在里面',
      }
    }
    if (/(^|\/)chat\.json$/i.test(rest)) {
      return { kind: 'app-data', note: '目标会话（宿主管理，agent 不能直接读写）' }
    }
    if (/(^|\/)tmp\.json$/i.test(rest)) {
      return { kind: 'app-data', api: 'tmp', note: '临时变量' }
    }
    if (/(^|\/)workflow\.json$/i.test(rest)) {
      return { kind: 'app-data', api: 'wf', note: '目标工作流登记' }
    }
    if (/(^|\/)method\.json$/i.test(rest)) {
      return { kind: 'app-data', api: 'method', note: '目标持久化函数' }
    }
    if (/(^|\/)essay\.json$/i.test(rest)) {
      return { kind: 'app-data', note: '随笔（由随笔窗口管理）' }
    }
    if (/(^|\/)mind\.json$/i.test(rest)) {
      return { kind: 'app-data', note: '长期事实' }
    }
    if (/\.md$/i.test(rest)) {
      return { kind: 'app-data', api: 'node', note: '教学文档' }
    }
    // 兜底：docs 下的其余东西都是应用数据，多半是节点自己的家当——指去节点宇宙。
    return { kind: 'app-data', api: 'node', note: '节点数据' }
  }

  // 用户配置/界面状态：不是 agent 的数据面
  if (p === 'user.yaml') return { kind: 'app-data', api: 'userInfo', note: '学习者画像' }
  if (p === 'state.json') return { kind: 'app-data', note: '界面状态（宿主管理，agent 不能直接读写）' }
  if (p === 'setting.yaml' || p === 'global.yaml') {
    return { kind: 'app-data', note: '应用配置（agent 不能直接读写）' }
  }
  if (p === 'chat.json' || p.endsWith('/chat.json')) {
    return { kind: 'app-data', note: '会话状态（宿主管理，agent 不能直接读写）' }
  }

  return { kind: 'external', note: '数据根之外或未归类的路径' }
}

/**
 * `files.*` 的准入检查：应用数据一律拒绝，并告诉模型该走哪一组 api。
 * 返回 null 表示放行。
 */
export function filesAccessError(raw: string, op: string): { ok: false; error: string } | null {
  const v = classifyDataPath(raw)
  if (v.kind !== 'app-data') return null
  const api = v.api ? 'api.' + v.api + '.*' : ''
  const guide = api
    ? '请改用 ' + api + '（先 await api.' + v.api + '.__help() 看用法）'
    : '它由应用宿主管理，agent 不能直接读写'
  return {
    ok: false,
    error:
      '「' + raw + '」是应用数据，files.' + op + ' 不能直接操作它。' +
      guide +
      (v.note ? '（' + v.note + '）' : '') +
      '。files.* 只用于 workspace/、static/、skills/ 与数据根之外已放行的文件。',
  }
}
