import { defineConfig } from 'vitest/config'

/**
 * 单元测试（vitest）的配置。
 *
 * 只跑 tests/ 下的用例，环境是 node——这里测的是纯逻辑，不需要 DOM，因此不引 jsdom。
 * 用例里显式 import describe / it / expect（globals: false），tsconfig 也就不用再认一套全局类型。
 * 断言只写「输入什么、得到什么」，时间与随机数不进用例：那种用例要么今天过明天挂，要么什么都没验证。
 *
 * 用例**不放 src/**：tsconfig.app.json 的 include 是 ["src"]、vite 构建也扫那一头，
 * 用例混在业务代码旁边会被打进产物（见 docs/development.md 的「测试」一节）。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    /*
     * 处理 CSS：默认（css: false）下所有 CSS 导入都被换成空串，**连 ?raw 也是空的**。
     * 导出（export.css?raw）与文档 Tailwind（doc-theme.css / theme.css?raw）全靠 ?raw 取文本，
     * 空串会让「导出件里有没有这套样式」的断言全部空转（看着是绿的，其实什么都没测）。
     */
    css: true,
    /*
     * 覆盖率只做报告、不做门禁（npm run test:coverage）：先看数字找盲区。
     * 不定阈值——阈值一旦拦人，就会诱导出凑行数的用例；这里要的是「哪里没测到」的地图。
     * include 收窄到 src/ 的代码文件（tests 与 scripts 不是被测对象）；vitest 5 起
     * 从没被任何用例加载过的文件也会进报告——0% 的那几行才是真正的盲区所在。
     */
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
    },
  },
})
