/**
 * 这个文件负责什么：IPC 契约的**代码块伪编译产物**通道组——CodeArtifact 与
 * 「无输出」标记 SilentMark（见 src/lib/codeArtifacts）。
 * 原先与其它组同写在 shared/ipc.ts，按通道组拆到这里；形状逐字未动，
 * 对外一律经门面 shared/ipc.ts 原样转出，调用方 import 路径不变。
 */

/* ---------- 代码块的伪编译产物 ---------- */

/**
 * 一份伪编译产物：编译出来的 JS + 那次的说明 + 是谁编的。
 *
 * 为什么把源码也存进去：键是「代码 + 语言」的指纹（见 src/lib/codeArtifacts.ts），
 * 指纹理论上会撞；读回来时对着 code 核一眼，撞了就当没有这份产物——
 * 大不了重编一次，绝不能让另一段代码的产物跑到这一块下面去跑。
 *
 * 谁在用：主进程 electron/runner.ts 的 runcache.json、preload 的 runner.artifacts /
 * runner.putArtifact，渲染层 src/lib/codeArtifacts.ts 与 src/lib/codeBlockMenu.ts。
 */
export interface CodeArtifact {
  /** 被编译的那段源码（原样存着：读回来时用它核对，见 codeArtifacts 的碰撞处理） */
  code: string
  /** 语言标记（可能没有：围栏上没写语言） */
  languageId: string | null
  /** 编译产物：一段可直接执行的 JS */
  js: string
  /** 模型写的那句说明（补了哪些假上下文、做了什么改动） */
  note: string
  /** 哪个模型编的（界面要显示，也方便日后判断产物是不是该重编） */
  model: string
  /** 落盘时刻 */
  at: number
}

/**
 * 「这段代码没有输出」的标记（由**超级导师**判定，见 src/lib/codeArtifacts 的 submitSilent）。
 *
 * 它不是缓存，是一条结论：导师看过这段代码，认定它跑不出任何东西。被标上的代码块
 * 从此不再显示编译与运行（重启也是），所以必须落盘。
 *
 * 谁在用：主进程 electron/runner.ts 的 runcache.json、preload 的 runner.putSilent，
 * 渲染层 src/lib/codeArtifacts.ts 的内存表 silent。
 */
export interface SilentMark {
  /** 被判定无输出的那段源码（读回来时核对，防指纹碰撞） */
  code: string
  languageId: string | null
  /** 导师给的一句话：为什么它没有输出 */
  reason: string
  at: number
}

