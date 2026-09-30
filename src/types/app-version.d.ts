/**
 * vite.config.ts 的 define 注入的常量：package.json 里的 version。
 *
 * 为什么走注入而不是 import package.json：把 package.json 打进渲染层会把依赖清单
 * 一起带进产物；而版本号只有 package.json 一处真值，注入既单一又零成本。
 * 界面上显示它的地方：设置 → 关于。
 */
declare const __APP_VERSION__: string
