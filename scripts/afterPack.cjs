/**
 * electron-builder afterPack：NSIS 打包之前，从 win-unpacked 里移除用不到的大件。
 *
 * - dxcompiler.dll（25MB）/ dxil.dll（2MB）/ vk_swiftshader.dll（6MB）：
 *   WebGPU 的 DirectX 编译器与软件 Vulkan 回退——应用无 navigator.gpu 引用，
 *   Chromium 只在真正初始化 WebGPU 时才按需加载它们，普通渲染（ANGLE/D3D）不经过。
 * - LICENSES.chromium.html（20MB）：Chromium 第三方许可聚合，分发物的替代获取
 *   途径（发布页/仓库）由发布流程提供，包内不再占 20MB。
 *
 * 代价与恢复：删项都在 afterPack 阶段按文件名移除，将来需要 WebGPU 时
 * 从本脚本移除对应行重打即可。
 */

const fs = require('node:fs')
const path = require('node:path')

const REMOVALS = [
  'dxcompiler.dll',
  'dxil.dll',
  'vk_swiftshader.dll',
  'LICENSES.chromium.html',
]

module.exports = async function afterPack(context) {
  let saved = 0
  for (const f of REMOVALS) {
    const p = path.join(context.appOutDir, f)
    if (fs.existsSync(p)) {
      saved += fs.statSync(p).size
      fs.unlinkSync(p)
    }
  }
  if (saved > 0) {
    console.log(`  [afterPack] 移除未使用的分发大件：${(saved / 1024 / 1024).toFixed(1)} MB`)
  }
}
