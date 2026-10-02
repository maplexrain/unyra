/**
 * 内置浏览器（网页页签）的英文分片：键 = 界面里的中文原文（见 src/i18n 的中文键方案）。
 */
const dict: Record<string, string> = {
  '新网页页签': 'New web tab',
  '新建网页页签': 'New web tab',
  '在焦点格里开一个网页页签（内置浏览器）；焦点已经在网页页签上时，把光标挪到它的地址栏':
    'Opens a web tab (built-in browser) in the focused pane; if a web tab is already active, moves the cursor into its address bar',
  '，或': ', or ',
  '打开一个网页': 'open a web page',
  '搜索或输入网址': 'Search or enter address',
  '后退': 'Back',
  '前进': 'Forward',
  '刷新': 'Reload',
  '停止加载': 'Stop loading',
  '在系统浏览器打开': 'Open in system browser',
  '在上方输入网址，回车打开': 'Type an address above and press Enter',
  '无法打开这个地址': 'This page could not be loaded',
  '这个页面崩溃了': 'This page crashed',
  '重试': 'Retry',
}

export default dict
