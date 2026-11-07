/**
 * 这个文件负责什么：沙箱类型契约的**code（代码块伪编译）**组的宿主实现 CodeOps——
 * 伪编译产物的交付口（见 lib/codeArtifacts）。
 * 原先与其它组同写在 src/agent/sandbox/types.ts，按 API 能力组拆到这里；形状逐字未动，
 * 对外一律经门面 src/agent/sandbox/types.ts 原样转出，调用方 import 路径不变。
 */

/* ---------- code：代码块伪编译 ---------- */

/**
 * code.* 的宿主实现：伪编译产物的**交货口**（见 lib/codeArtifacts 的 submitCompile）。
 *
 * 为什么要有这么一条 api，而不是让宿主去读对话里那段围栏：产物是一条要落盘、
 * 要被代码块认领的数据，靠「猜哪段围栏是结果」是猜不准的（一轮对话里可能有好几块）。
 * key 由触发方给（它知道是哪一块代码），代码原文由宿主自己记着，模型只交 js 与说明。
 */
export interface CodeOps {
  /** 交付一份伪编译产物；key 对不上、js 为空时回 { error } */
  save: (input: unknown) => unknown
  /**
   * 判定「这段代码没有输出」，**当场停止编译**并把那块标成无输出（见 lib/codeArtifacts）。
   * 这是一条正经的交付，不是失败：有些代码块本来就是一堆定义，转译出来也没有任何东西可看。
   */
  silent: (input: unknown) => unknown
}

