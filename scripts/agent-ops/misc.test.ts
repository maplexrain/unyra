/**
 * 探针分组：CSP、代理白名单、快捷键、主题变量（原文件第 7、10 节与 shortcut / themeTokens 两段）。
 *
 * 这一组只用到 ok()：它们对的是常量与纯函数（LOCAL_FILE_CSP / proxy-core / keyCombo / theme.css）。
 */
import { LOCAL_FILE_CSP } from '../../electron/csp'
import { forwardTarget, originSet, parseOrigin, toProxyUrl } from '../../electron/proxy-core'
// 只 import 纯函数那一个文件：它不依赖 React，Node 探针才跑得起来
import { SHORTCUT_DEFS } from '../../src/lib/shortcuts'
import {
  canonicalCombo,
  comboLabel,
  formatCombo,
  keyLabel,
  normalizeKeyName,
  parseCombo,
  type KeyCombo,
} from '../../src/lib/keyCombo'
import { THEME_VAR_NAMES } from '../../src/lib/themeTokens'
import themeCss from '../../src/styles/theme.css?raw'
import { ok } from './harness'

/* ---------- 7. 打包版的 CSP 必须放行沙箱 ---------- */

/**
 * 这一条钉的是一个真实事故：release 版里 execute 工具全废，模型拿到的报错是
 * 「Evaluating a string as JavaScript violates the following Content Security Policy directive
 * because 'unsafe-eval' is not an allowed source of script」——它跟代码写得对不对毫无关系，
 * 而界面上不会当场报错，只在用户说了第一句话、模型第一次调 execute 时才炸。
 *
 * 根因：注入给 file:// 页面的 CSP 里 script-src 没有 'unsafe-eval'，也没放行 blob: Worker，
 * 而宿主侧的 compileBody、沙箱里的 new Function、以及沙箱所在的 blob Worker 正好都要这两样。
 * 实测（打包后连 DevTools 协议，把探针作为页面自己的内联脚本插进去）：worker-src 违规事件两条，
 * blockedURI 分别是 blob 与 data。
 */
export function cspTests() {
  ok(/script-src[^;]*'unsafe-eval'/.test(LOCAL_FILE_CSP), 'CSP 放行 unsafe-eval（compileBody 与沙箱都要 new Function）', LOCAL_FILE_CSP)
  ok(/worker-src[^;]*blob:/.test(LOCAL_FILE_CSP), 'CSP 放行 blob: Worker（沙箱就跑在 blob worker 里）', LOCAL_FILE_CSP)
  // 文档里的远程图片是正经内容（被动资源，不执行脚本）；本地图片不走 CSP——lib/docImages 读字节贴 data URL
  ok(/img-src[^;]*https:/.test(LOCAL_FILE_CSP), 'img-src 放行远程图片', LOCAL_FILE_CSP)
  ok(!/img-src[^;]*file:/.test(LOCAL_FILE_CSP), 'img-src 不放行 file:（本地图片走 data URL 水合，不开读任意本地文件的口子）', LOCAL_FILE_CSP)
  ok(LOCAL_FILE_CSP.includes("connect-src 'self' llm-proxy:"), '网络出口仍只留 llm-proxy', LOCAL_FILE_CSP)
  ok(LOCAL_FILE_CSP.includes("default-src 'self'"), '默认仍只允许本地资源', LOCAL_FILE_CSP)
  ok(!/default-src[^;]*[*]/.test(LOCAL_FILE_CSP), 'CSP 没有被放成通配', LOCAL_FILE_CSP)
}

/* ---------- 10. 代理白名单与转发目标（本地 http 也要能走通） ---------- */

/**
 * 这一段守的是一个**文档写了支持、实际走不通**的组合：本地 Ollama / vLLM 与不少内网网关
 * 都是明文 http，而渲染层改写出来的 `llm-proxy://host/path` 里没有协议，主进程原先一律拼 https
 * ——TLS 握手当场失败，报错还只是一句「转发失败」。
 * 协议现在跟着白名单一起同步过来；判据抽到 electron/proxy-core（不 import electron，Node 里跑得动）。
 */
export function proxyTests() {
  ok(parseOrigin('api.deepseek.com') === 'https://api.deepseek.com', '白名单项不带协议时按 https 兜底（历史行为）')
  ok(parseOrigin('http://127.0.0.1:11434') === 'http://127.0.0.1:11434', '明文地址：协议、host、端口都保住（本地 Ollama 就是这一条）')
  ok(parseOrigin('https://API.DeepSeek.com') === 'https://api.deepseek.com', '大小写不敏感')
  ok(parseOrigin('http://[::1]:8080') === 'http://[::1]:8080', 'IPv6 带方括号也认')
  ok(parseOrigin('https://api.foo.com/v1') === null, '带路径的整条地址不收（白名单只收目标地址）')
  ok(parseOrigin('ftp://api.foo.com') === null, '非 http(s) 协议不收')
  ok(parseOrigin('') === null && parseOrigin(null) === null, '空值不收')

  const allowed = originSet(['https://api.deepseek.com', 'http://127.0.0.1:11434'])
  ok(allowed.size === 2, '白名单是「目标地址」的集合，同一个 host 两种协议算两条', [...allowed])

  /*
   * 这一段钉的是**端口为什么会丢**：`llm-proxy:` 不是 URL 规范里的 special scheme，
   * Chromium 把它的 authority 当 opaque host 解析——`llm-proxy://127.0.0.1:8799/x` 进去，
   * 出来的 href 只剩 `llm-proxy://127.0.0.1/x`，端口在 fetch 那一刻就没了。
   * 所以目标地址不能放在 authority 里；下面第一条断言守的就是这个形状（Node 的 URL 实现
   * 与 Chromium 不同——它**保留**端口，因此这条坑在 Node 里复现不出来，只能靠形状来守）。
   */
  const proxied = toProxyUrl('http://127.0.0.1:8799/v1/chat/completions') ?? ''
  ok(new URL(proxied).host === 'target', '代理地址的 authority 只放占位 host，不放真实目标', proxied)
  ok(proxied.includes('127.0.0.1%3A8799'), '目标地址连端口一起进查询串，谁也丢不掉它', proxied)
  ok(proxied.endsWith('/v1/chat/completions?__moji_origin=http%3A%2F%2F127.0.0.1%3A8799'), '路径与参数形状稳定', proxied)

  const round = (target: string): string | null => {
    const p = toProxyUrl(target)
    return p ? forwardTarget(allowed, new URL(p)) : null
  }
  ok(
    round('http://127.0.0.1:11434/v1/chat/completions') === 'http://127.0.0.1:11434/v1/chat/completions',
    '明文 + 端口：往返一字不差（这两个原先都留不下来）',
    round('http://127.0.0.1:11434/v1/chat/completions'),
  )
  ok(
    round('https://api.deepseek.com/chat/completions?stream=true') === 'https://api.deepseek.com/chat/completions?stream=true',
    '原有查询串保留，捎带目标地址的那个参数被摘掉',
    round('https://api.deepseek.com/chat/completions?stream=true'),
  )
  ok(round('http://evil.example.com/v1') === null, '白名单外的目标回 null（调用方据此回 403，不做开放代理）')
  ok(forwardTarget(originSet([]), new URL(proxied)) === null, '空名单什么都不放行')
  ok(forwardTarget(allowed, new URL('llm-proxy://target/v1')) === null, '没带目标地址的请求不放行')
  ok(parseOrigin('https://a.com:8443') === 'https://a.com:8443', '非默认端口原样保留')
  ok(parseOrigin('https://a.com:443') === 'https://a.com:443', '显式写的默认端口也收（渲染层不会这么写）')
  ok(toProxyUrl('file:///tmp/x') === null, '非 http(s) 地址不做改写')
  ok(toProxyUrl('llm-proxy://target/x') === null, '已经是代理地址的不再二次包装')
}
/**
 * 快捷键：组合串的解析 / 格式化 / 规范化，以及注册表本身的两条纪律。
 *
 * 这一层错了界面也不会报错——用户按下一个组合什么都不发生，或者改完键存进 setting.yaml
 * 之后读回来变成另一个键。所以把「字符串 ↔ 组合」这条往返钉在这里。
 */
export function shortcutTests(): void {
  ok(canonicalCombo('ctrl+shift+k') === 'Ctrl+Shift+K', '小写、乱序都归一到规范写法', canonicalCombo('ctrl+shift+k'))
  ok(canonicalCombo('Shift+Ctrl+K') === 'Ctrl+Shift+K', '修饰键的顺序是固定的（写进文件的必须收敛成一种）')
  ok(canonicalCombo('⌘+K') === 'Win+K', 'mac 的 ⌘ 折成 Win（同一套存储格式）')
  ok(canonicalCombo('⌘K') === '⌘K', '不写 + 的 mac 写法当成一个未知主键原样留着（不猜、不乱折）')
  ok(parseCombo('Alt+S')?.alt === true && parseCombo('Alt+S')?.key === 'S', 'Alt+S 解析成 alt + S')
  ok(parseCombo('K')?.key === 'K' && parseCombo('K')?.ctrl === false, '光一个字母也能解析（拦不拦是 setShortcut 的事）')
  ok(parseCombo('Ctrl+') === null, '缺主键的串不认')
  ok(parseCombo('Ctrl+K+L') === null, '两个主键的串不认')
  ok(parseCombo('') === null, '空串不认')
  ok(formatCombo(parseCombo('Ctrl+Space') as KeyCombo) === 'Ctrl+Space', '空格键统一写成 Space（不写成一个看不见的空格）')
  ok(parseCombo('Ctrl+ ') === null, '只有修饰键、主键是空白的串不认（解析时会把空白 token 滤掉）')
  ok(keyLabel('Space') === '空格' && keyLabel('ArrowUp') === '↑', '显示名：空格与方向键给人看的写法')
  ok(comboLabel('Ctrl+Shift+K') === 'Ctrl + Shift + K', '显示时修饰键之间留空格', comboLabel('Ctrl+Shift+K'))
  ok(normalizeKeyName('Control') === null, '纯修饰键不算主键（半截组合不该触发）')
  const ids = SHORTCUT_DEFS.map((d) => d.id)
  ok(new Set(ids).size === ids.length, 'id 不重复（重复会让改键改到另一条上）')
  ok(SHORTCUT_DEFS.every((d) => parseCombo(d.def) !== null), '每条默认组合都解析得出来')
  // 语音输入 2026-11 从「按住 Ctrl+T 说话」改成了输入框上的话筒按钮（录完再识别，空格结束），
  // 那条绑定随之取消：**它不该再挂在任何组合上**——留着只会让人按下去什么都不发生。
  ok(!ids.includes('voice.input'), '语音输入不再占快捷键（入口是输入框上的话筒）')
  ok(SHORTCUT_DEFS.map((d) => d.def).length === new Set(SHORTCUT_DEFS.map((d) => d.def)).size, '默认组合之间不撞')
}

/**
 * 超级文档的主题变量名单（lib/themeTokens）与样式表对账。
 *
 * 对的是 src/styles/theme.css 而不是 src/index.css：样式表按功能域拆开之后
 * （见 docs/refactor-plan.md），@theme 那一块住在 theme.css 里，index.css 只剩 @import。
 *
 * 这份名单要手工维护（CSSOM 现数在打包版里会撞跨源限制），漏跟的后果很安静：
 * 主题里新加的变量超级文档拿不到、名单里多余的注入一个空值——都不报错。
 * 逐条比对让两边当场变红：加了变量忘了名单、或删了变量留着名单，都是失败。
 */
export function themeTokensTests(): void {
  const inCss = new Set([...themeCss.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]))
  ok(inCss.size > 20, '前置：从 theme.css 里数出了成建制的主题变量', inCss.size)
  for (const name of THEME_VAR_NAMES) {
    ok(inCss.has(name), '名单里的 ' + name + ' 在 theme.css 里真的存在')
    inCss.delete(name)
  }
  ok(inCss.size === 0, 'theme.css 里的主题变量全部进了名单（新加变量记得同步 themeTokens）', [...inCss])
}
