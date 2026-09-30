/**
 * 新架构的回归探针：在 Node 里直接跑，不需要浏览器、不需要 Electron。
 *
 * 为什么值得单独留一份：这次改动动的都是「看不见的那一层」——一个节点两份文档怎么落盘、
 * 旧数据怎么迁、path 怎么解析、execute 的每个 api 到底有没有真的注册。这些错了界面不会当场报错，
 * 只会在用户写了一大段之后才以「改了个寂寞」的形式暴露出来。
 *
 * 覆盖五块：
 * 1. 存储：一节点两文档的落盘/读回，以及旧布局（content 字段 + 节点级 chat.json）的迁移；
 * 2. 路径寻址：path 的各种写法与报错里的候选清单；
 * 3. execute：用假的沙箱执行器把 buildApi + learn/agentOps 整条路跑通，并核对
 *    「沙箱注入的 api 名单」与「真的注册了的 api」是否一致——名单里有、实现里没有，
 *    就是模型照着提示词调用却拿到「沙箱里没有这个 api」的那种事故；
 * 4. 跟随与脱离（lib/scrollFollow）：滚轮折算与两个阈值的边界；
 * 5. 图片输入：中立片段翻译成三家协议的字段、带图历史的逐字节稳定（前缀缓存的前提）、
 *    图片引用在 chat.json 里的往返、以及「模型不收图时该不该放行」。
 *
 * 这些大多是肉眼审不出对错的东西：错了界面不会当场报错，只会在真发请求时
 * 收到一个 400，或者更糟——换一家提供商之后前缀缓存整段作废，用户默默多付一次全价。
 *
 * 跑法：node scripts/run-agent-ops-test.mjs（见 package.json 的 test:agent）
 *
 * 拆分：这个文件原先是一个 1900 多行的巨型单文件，现在按域拆进 scripts/agent-ops/
 * （harness.ts 放模块级 fixture 与 ok() 计数器，五个 *.test.ts 放各组用例）。
 * 这里只剩入口：import 各分组，然后**按原来的顺序**依次跑。
 * 模块求值时就要跑掉的那一段（存储 / 旧布局迁移 / 路径寻址的断言）在 harness.ts 里，
 * 由第一个 import 触发，仍然早于所有测试函数——顺序与副作用时机与拆分前一致。
 */
import { fails, pass } from './agent-ops/harness'
import { apiNameTests, resourceApiTests, toolTests } from './agent-ops/docs.test'
import { learningStateTests, scrollTests } from './agent-ops/reading.test'
import { examTests, methodAndSdocTests, userInfoTests, workflowTests } from './agent-ops/exam.test'
import { budgetAndAttachTests, imageTests, staticTests } from './agent-ops/media.test'
import { cspTests, proxyTests, shortcutTests, themeTokensTests } from './agent-ops/misc.test'
import { reviewTests } from './agent-ops/review.test'
import { workspaceTests } from './agent-ops/workspace.test'

// 名单检查由文件末尾的总链路调用一次（原先这里又调了一次，两组断言都会重复记账）
toolTests()

/** 十三组跑完一起报账：全过才算通过，失败逐条列出来（断言信息里带上下文，便于直接定位） */
apiNameTests()
  .then(() => scrollTests())
  .then(() => imageTests())
  .then(() => staticTests())
  .then(() => resourceApiTests())
  .then(() => budgetAndAttachTests())
  .then(() => examTests())
  .then(() => cspTests())
  .then(() => learningStateTests())
  .then(() => methodAndSdocTests())
  .then(() => workflowTests())
  .then(() => reviewTests())
  .then(() => workspaceTests())
  .then(() => userInfoTests())
  .then(() => themeTokensTests())
  .then(() => proxyTests())
  .then(() => shortcutTests())
  .then(() => {
    console.log('PASS ' + pass)
    if (fails.length) {
      console.log('FAIL ' + fails.length)
      for (const f of fails) console.log('  - ' + f)
      process.exitCode = 1
    } else {
      console.log('ALL OK')
    }
  })
