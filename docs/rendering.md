# 文档渲染插件与代码块高亮

> 文档里「一种围栏语言对应一种画法」这套东西是怎么插进来的，以及代码块的真高亮。
> 代码块的**编译与运行**是另一回事，见 [code-run.md](code-run.md)。

## 一张表管所有语法

文档里「一种围栏语言对应一种画法」的语法，现在全是插件在管：内置的 **```` ```plot ```` 函数图像** 与
用户自己装的（`{root}/plugins/*.js`）走**同一张表**，区别只在于内置的编译进包、开关跟机器走。

这套东西是插件里的**一类**，叫 **Markdown 文档插件**（见 `src/lib/renderPlugins.ts`）。
宿主（`src/lib/plugins.ts`）只管登记、开关与装载，对类别本身一无所知——将来有别的扩展点
（导出格式、AI 工具……），各自实现一份类别规范接进来即可，不必动宿主。

一个插件可以做三件事，按需组合：**认领围栏语言**（```` ```xxx ```` 画一张图）、**加工正文文字**
（全篇的引号、符号染色）、**挂载 DOM**（真把图画出来）。前两件在解析期，第三件在挂载期。

```js
// {root}/plugins/mermaid.js —— 放进目录，在「设置 → 插件」里启用，重启后生效
register({
  id: 'mermaid',           // 不写就用文件名
  name: '流程图',
  fences: ['mermaid'],     // 认领 ```mermaid
  // ① 解析期：源码 → HTML 占位。**必须同步**（renderNote 是同步纯函数，产物按源文缓存）
  render: (source, ctx) => `<div data-src="${ctx.attr(source)}">画图中…</div>`,
  // ② 挂载期：DOM 提交后执行，返回清理函数。重活（动态加载库、画图）都放这里
  hydrate: async (root, ctx) => {
    const mermaid = await ctx.load('mermaid')
    …
    return () => {/* 取消在途渲染、断开观察者 */}
  },
})
```

- `render` 的产物**照样过 DOMPurify**（与正文同一条管线），插件不享有豁免；
- `hydrate` 拿的是 DOM，宿主拦不住，所以只给两个口子：`ctx.html(el, s)`（消毒）与
  `ctx.raw(el, s)`（明确表示「这是我自己生成的标记」）；
- 插件脚本里**不能 import**（宿主用 `new Function` 编译），要用的重库由宿主白名单代加载：
  `await ctx.load('function-plot')`；
- 没人认领的语法、以及插件抛异常的语法，一律退回普通代码块——不认识的语法不会变成空白；
- `ctx` 其余成员：`escape` / `attr`（转义）、`readAttr`（读回 `attr` 写进属性的源码）、
  `marked`（可选：直接给 marked 的扩展对象，行内语法走这条）。

## 加工正文文字

不是代码块，而是解析之后的正文本身，另有一条路：`text` 规则。它挂在一个 `text` 令牌上跑，
拿到的是**已经解析完的纯文字**，所以引号还是引号、公式与加粗已经是各自的结构，
插件不必和 Markdown 语法打架：

```js
// 引号里的字染个色；箭头换个颜色（两条都是全篇生效，不必写 ``` 围栏）
register({
  id: 'quote-style',
  text: [
    // group: 1 → 只包第一个捕获组，引号本身留在外面
    { match: /“([^”]+)”/g, wrap: 'moji-quote', group: 1 },
    // style → 直接给内联样式，连 CSS 都不用写
    { match: /[→←↑↓]/g, style: 'color:#c0392b' },
  ],
  // 用了 wrap 类名才需要它：注入一次，全局生效（记得加前缀限定作用域）
  css: '.moji-quote{color:#8a6d3b;border-bottom:1px dashed currentColor}',
})
```

- **代码块与行内代码不在里面**（它们是 code / codespan 令牌），示例代码不会被染色；
- 命中的文字**一律转义后包进 span**，这条路上注入不了标记——样式只有类名与内联样式两种给法；
- 多条规则撞上同一段文字时**先注册的赢**，不会套两层 span；
- 没命中时输出与 marked 的默认渲染**逐字节一致**（有用例钉着）；
- 已知边界：规则作用在**一段连续文字**上，跨 `**加粗**` 这类内联标记的匹配（例如
  `“这是**重点**”` 整句）不会命中——那是 marked 的扩展（`marked` 字段）该干的活。

## 为什么是 `new Function` 而不是 `import()`

打包后页面跑在 `file://` 下，CSP 只放行 `'self'` 与 `'unsafe-eval'`（见 `electron/csp.ts`），
blob: 或自定义协议的模块加载都得再开一个口子。代价就是上面那条「不能 import」——
反正装进 asar 的应用也没法让插件自己 npm install。另一个好处是开发与生产行为完全一致
（生产才有 CSP，dev 没有，走 import 的话两边会不一样）。

## 三件必须知道的事

1. **开关**：设置 → 插件里按类别列着全部插件，**内置的也能关**（plot 默认开——它是文档能力的一部分；
   关掉之后 ```` ```plot ```` 就退回普通代码块）。用户插件默认**关**，要在那一页点一次：
   它是个能读到你全部笔记的脚本。清单分两处存：用户插件的在数据目录（`plugins/enabled.json`，
   跟着数据走），内置插件的在 appdata（`global.yaml`，跟机器走）。启用了却装不上
   （语法错、id 撞车、内置插件带了 marked 扩展）会在那一页显示原因，不影响启动。
2. **启用即同权**：插件和宿主一个权限——读得到正文 DOM，也拿得到 `window.mojiNative`
   （数据目录里的东西它都读得到）。出网出口只有 `llm-proxy:`，但别把这当成沙箱。
3. **改了要重启**：插件在启动时注册一次，而 marked 的扩展装上去摘不下来、渲染结果又按
   「插件版本 + 源文」缓存（见 `lib/markdown`）。热改只会换来一半新一半旧的界面。

现成例子：[`plugin-examples/quote-style.js`](plugin-examples/quote-style.js)（引号描边 + 箭头换色），
复制到 `{root}/plugins/` 启用即可。

## 代码块语法高亮（TextMate）

带语言的围栏代码块会被**真正解析**成 VS Code 那套高亮：

```text
围栏 ──→ languageId（js → javascript，见 src/syntax/LanguageAliases.ts）
     ──→ 按需下载那份 TextMate 语法（@shikijs/langs：VS Code 生态里那份，40 门语言）
     ──→ vscode-textmate + oniguruma(wasm) 逐行 tokenize → tokens / scopes
     ──→ scope 归成十来个令牌类型（src/syntax/Theme.ts）
     ──→ <span class="tok tok-keyword">…</span>，颜色由 CSS 变量给
```

- **一行高亮正则都不写**：语法本体是现成的 TextMate 语法，加一门语言 = 在语言表里加一行 +
  在加载表里加一行（用例会盯着这两边一致）。
- **按需加载**：每门语言是独立分包，oniguruma 的 wasm（473 KB）也一样——**第一次真的出现代码块**
  时才下载；同一个语言只加载一次，tokenize 结果也按「语言 + 源码」缓存。
- **解析期不出颜色**：tokenize 是异步的，而 renderNote 是同步纯函数、产物还按源文缓存。
  所以正文里先落 marked 默认的 `<pre><code>`，DOM 提交之后由内置插件 **代码块高亮**补颜色——
  与 ```` ```plot ```` 同一套路（见 lib/codeHighlight）。
- **换主题不重新解析**：令牌只带类名，颜色全在 `--color-code-*` 这组变量上（index.css 里浅色一套、
  深色族一套）。切浅色/深色是纯 CSS 的事；自定义主题＝给一份 `CodeTheme`，
  它被写成那块代码上的内联变量，一个 token 都不用重算。
- **代码块不会被正文规则染色**：上面那套 `text` 规则只管正文的 text 令牌，代码是 code / codespan 令牌。
- 导出件（HTML / PDF）里也有颜色：exportDoc 在序列化之前等一次高亮，export.css 自带同一套 `--color-code-*`。
- 已知边界：单块超过 3000 行或 15 万字符不高亮（不拿主线程去赌一段日志）；
  超级文档 iframe 里那份 markdown 是同步合成的，暂不着色。

它是一个**内置插件**（设置 → 插件 → Markdown 文档插件 → 代码块高亮），默认开、可以关。

## 代码分布

| 文件 | 是什么 |
| --- | --- |
| `src/lib/renderPlugins.ts` | 注册表：围栏查表、正文文字规则、hydrate 派发、版本号 |
| `src/lib/builtinPlugins.ts` | 内置的 plot，也是这套接口的样板 |
| `src/lib/plugins.ts` | 宿主：类别、注册表、开关与装载 |
| `electron/plugins.ts` | 主进程的目录扫描与启用清单 |
| `src/lib/sanitize.ts` | 正文与插件共用的消毒白名单 |
| `src/syntax/` | 高亮里与渲染无关的那一半（语言表、语法加载、tokenize、主题） |
| `src/lib/codeHighlight.ts` | 高亮的 DOM 那一层：找块、认语言、写回颜色；正文与导出共用 |
