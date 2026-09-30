/**
 * 示例插件：给正文里的引号与箭头换个样子（见 docs/rendering.md）。
 *
 * 怎么用：把本文件复制到 `{root}/plugins/`（设置 → 插件 → 打开插件目录），
 * 回到设置里启用它，重启应用。之后**所有**文档（教学文档、笔记、AI 回复、试卷）里的
 * 引号内容与箭头都会按这里的样式显示——不必在文档里写任何标记。
 *
 * 想改样式：动 css 里那两行即可；不想写 CSS 的话，把 wrap 换成 style（见下面注释掉的写法）。
 */
register({
  id: 'quote-style',
  name: '引号与符号',
  // category 不写就是 'markdown'（Markdown 文档插件）——目前也只有这一类
  text: [
    // “双引号”里的字：group 1 → 只包引号中间那段，引号本身留在外面
    { match: /“([^”]+)”/g, wrap: 'moji-quote', group: 1 },
    // 直角引号「」也一并认（中文里两种都常见）
    { match: /「([^」]+)」/g, wrap: 'moji-quote', group: 1 },
    // 箭头换颜色：用内联样式，连下面的 css 都不必写
    // { match: /[→←↑↓⇒⇔]/g, style: 'color:#c0392b' },
    { match: /[→←↑↓⇒⇔]/g, wrap: 'moji-arrow' },
  ],
  // 只有用 wrap 类名时才需要它：注入一次，全局生效。前缀是必须的——这里的样式会影响整个界面
  css: [
    '.moji-quote{color:#8a6d3b;border-bottom:1px dashed currentColor}',
    '.moji-arrow{color:#c0392b;font-weight:600}',
  ].join('\n'),
})
