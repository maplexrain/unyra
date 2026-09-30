/**
 * 统一测试入口（package.json 的 test 走它）：一次跑完全部测试。
 *
 * 为什么要多这一层：该跑的东西散在几条命令里（vitest 单元测试 + 两套 Node 探针），
 * 靠人记就会漏，而「这次改的是哪一层、该跑哪几个」本来就不该由人判断。提交前只记一条
 * `npm run test` 即可。
 *
 * 每套各起一个 node 子进程、输出直接继承到当前终端（stdio: 'inherit'，报错原文照旧看得见），
 * 跑完打一行总结；任何一套没过都以非零码退出。这里直接指着入口文件起 node，不走
 * npm/npx——Windows 上那还得穿过一层 .cmd 垫片与 shell。
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

/** 一个入口一套；顺序固定，输出与 package.json 里那几条同名脚本一一对应 */
const STEPS = [
  { name: 'vitest 单元测试', entry: 'node_modules/vitest/vitest.mjs', args: ['run'] },
  { name: 'agent 探针（存储 / 路径寻址 / execute 的 api 面）', entry: 'scripts/run-agent-ops-test.mjs', args: [] },
  { name: 'update 探针（更新链路）', entry: 'scripts/run-update-test.mjs', args: [] },
]

const failed = []
for (const step of STEPS) {
  console.log('\n=== ' + step.name + ' ===')
  const r = spawnSync(process.execPath, [path.join(root, step.entry), ...step.args], { cwd: root, stdio: 'inherit' })
  // 信号终止（被杀）时 status 是 null：同样算没过，不能当成 0。
  // r.error 是「压根没起起来」（例如还没 npm install，vitest 不在 node_modules 里）——
  // 那种情况下光看退出码会一头雾水，把原因一起打出来。
  if (r.error) console.log('起不来：' + r.error.message)
  if (r.status !== 0) failed.push(step.name + '（退出码 ' + (r.status ?? 'null') + '）')
}

if (failed.length) {
  console.log('\n测试未通过：' + failed.join('、'))
  process.exitCode = 1
} else {
  console.log('\nALL OK：' + STEPS.length + ' 套全过（' + STEPS.map((s) => s.name).join(' · ') + '）')
}
