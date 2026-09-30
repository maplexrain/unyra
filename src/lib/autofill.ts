/**
 * 关闭浏览器与密码管理器的自动填充。
 *
 * 本应用是本地优先的学习笔记工具：昵称、专业背景、API Key 这些内容
 * 都只属于本机，浏览器把它们记成「表单历史」再弹出下拉建议，只会误事——
 * 尤其在 API Key 上，密码管理器还会把登录密码塞进 Key 输入框。
 *
 * 各家的开关并不统一，因此这里叠了几层，属性可以直接展开到 input/textarea 上：
 * - `autoComplete="off"`：标准写法，Chrome 对普通文本框有效；
 * - `autoComplete="new-password"`：密码框上 `off` 会被 Chrome 忽略，
 *   而 `new-password` 表示「这是要新设的密码」，浏览器不会拿已存密码来填，
 *   也不会弹「是否保存密码」——API Key 正属于这类字段；
 * - `data-1p-ignore` / `data-lpignore`：1Password 与 LastPass 的忽略标记；
 * - `data-form-type="other"`：让密码管理器知道这不是登录表单。
 */

/** 普通文本输入框：不记录、不提示曾经填过的内容 */
export const NO_AUTOFILL = {
  autoComplete: 'off',
} as const

/** 密钥 / 令牌输入框：不填已存密码，也不提示保存 */
export const NO_AUTOFILL_SECRET = {
  autoComplete: 'new-password',
  'data-1p-ignore': 'true',
  'data-lpignore': 'true',
  'data-form-type': 'other',
} as const
