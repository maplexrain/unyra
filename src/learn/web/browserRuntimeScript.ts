/**
 * 网页访客环境（Guest Page）内的轻量 Agent 运行时脚本构造器。
 * 
 * 核心机制：
 * 1. 深度穿透 Shadow DOM 与同源 iframe；
 * 2. 紧凑语义索引生成（保护布局容器不被折叠、为 shadow 内部所有交互组件编号、带 href 路径）；
 * 3. 基于 data-agent-id、内存 Map 与 Deep QuerySelector 的全域寻址（支持 >>> 与后代选择器）；
 * 4. 健壮的真实用户级受控动作（click / fill 带自检比对 / type / press / scroll / text / inspect / query / waitFor / eval）。
 *
 * 拆分说明（纯搬运重构）：脚本主体按段原样搬入 ./runtimeScript/ 各模块——
 * core（基础环境与 Shadow/iframe 穿透查询）、indexing（语义索引与查询等待）、
 * interact（受控交互）、capture（元素截图分片）、markdown（转 Markdown），
 * 各模块导出模板字符串片段；本文件保留全部既有导出并按原拼接顺序组装，
 * 最终脚本与拆分前逐字节一致；IIFE 收尾（ready 标记 + 闭合）保留在此处。
 */

import { RUNTIME_CORE } from './runtimeScript/core';
import { RUNTIME_INDEXING } from './runtimeScript/indexing';
import { RUNTIME_INTERACT } from './runtimeScript/interact';
import { RUNTIME_CAPTURE } from './runtimeScript/capture';
import { RUNTIME_MARKDOWN } from './runtimeScript/markdown';

/** 运行时收尾（原文件第 1567–1570 行原样搬运）：置 ready 标记、返回 true 并闭合 IIFE */
const RUNTIME_CLOSING = `
  window.__agentRuntimeReady = true;
  return true;
})()`;

/** 基础运行时的初始化脚本（挂载全局函数，支持重复调用与缓存刷新） */
export const BROWSER_RUNTIME_INIT_SCRIPT =
  RUNTIME_CORE +
  RUNTIME_INDEXING +
  RUNTIME_INTERACT +
  RUNTIME_CAPTURE +
  RUNTIME_MARKDOWN +
  RUNTIME_CLOSING;

/** 生成调用指定 Agent 运行时操作的 JS 包装语句 */
export function buildRuntimeExecScript(fnCall: string): string {
  return `(async () => {
    try {
      ${BROWSER_RUNTIME_INIT_SCRIPT};
      return await (${fnCall});
    } catch (err) {
      return {
        ok: false,
        error: err && err.message ? err.message : (typeof err === 'string' ? err : JSON.stringify(err)),
      };
    }
  })()`;
}
