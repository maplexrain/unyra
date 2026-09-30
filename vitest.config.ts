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
  },
})
