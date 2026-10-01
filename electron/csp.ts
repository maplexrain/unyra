/**
 * 生产构建（file:// 加载）时注入给页面的 CSP。
 *
 * 为什么单独一个文件：它是「沙箱能不能跑」的前提，而这件事**错了界面不会当场报错**——
 * 只在用户跟 AI 说了第一句话、模型第一次调 execute 时才炸，报出来的还是一句
 * 「Evaluating a string as JavaScript violates the following Content Security Policy directive
 * because 'unsafe-eval' is not an allowed source of script」。放到这里之后，
 * scripts/agent-ops.test.ts 就能直接断言它，改严了会当场变红。
 *
 * 两条**必须**留着（它们看着像「不安全」，其实是这个应用的运行方式本身）：
 * - script-src 'unsafe-eval'：宿主侧 compileBody 与沙箱里的 new Function 都要用它把模型写的
 *   代码编译成函数。没有它，**打包版的 execute 工具完全不可用**（踩过一次）；
 * - worker-src blob:：沙箱跑在一个 blob: Worker 里（见 agent/sandboxWorker 与 tools 的 runInWorker），
 *   没有它 Worker 直接加载失败，同样是 execute 全废。
 *
 * 其余部分是真正的收紧：默认只允许本地资源，网络出口只留 llm-proxy:（AI 请求的唯一通道），
 * 远程脚本、远程样式一概放不进来。
 *
 * img-src 放行 http(s) 是 2026-10-01 的补充：文档（用户写的、贴进来的、导师写的）里的
 * 远程图片是正经内容——图片是被动资源，不执行任何脚本，script-src / connect-src 的收紧
 * 不受影响。本地图片不走这条：它们由 lib/docImages 读字节贴成 data URL（file: 来源连
 * 'self' 都匹配不上，放行 file: 反而等于给文档开一个读任意本地文件的口子）。
 */
export const LOCAL_FILE_CSP =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
  "worker-src 'self' blob:; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: https: http:; " +
  "font-src 'self' data:; " +
  "connect-src 'self' llm-proxy:;"
