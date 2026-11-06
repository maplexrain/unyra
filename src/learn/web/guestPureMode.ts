/**
 * 网页纯净阅读与 DOM 元素过滤注入脚本。
 *
 * 核心原理：
 * 1. 支持黑白名单列表：
 *    - 黑名单（blacklist）：无条件隐藏所匹配的干扰元素（广告、弹窗、冗余侧边栏、页眉页脚等）；
 *    - 白名单（whitelist）：若存在白名单，仅放行所选目标及其子树，隐藏其祖先链外的兄弟分支；
 *      若白名单为空，则显示全文，仅应用黑名单规则；
 * 2. 杜绝误伤：严格仅在祖先分支上隐藏非目标同级节点，绝不破坏目标内部任何子元素（段落、图片、代码等）的展示，
 *    且不暴力覆写祖先元素的 margin/padding/display，完整保留原有网站排版与上下文；
 * 3. 关闭时一键清理注入的 style 标签与标记类，无损还原原网页。
 */

export interface WebFilterConfig {
  whitelist?: string[]
  blacklist?: string[]
}

export function buildApplyPureModeScript(
  filterInput?: WebFilterConfig | string,
  enable = true,
): string {
  let whitelist: string[] = []
  let blacklist: string[] = []

  if (typeof filterInput === 'string') {
    const trimmed = filterInput.trim()
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as WebFilterConfig
        whitelist = Array.isArray(parsed.whitelist) ? parsed.whitelist : []
        blacklist = Array.isArray(parsed.blacklist) ? parsed.blacklist : []
      } catch {
        whitelist = trimmed ? [trimmed] : []
      }
    } else if (trimmed) {
      whitelist = [trimmed]
    }
  } else if (filterInput && typeof filterInput === 'object') {
    whitelist = Array.isArray(filterInput.whitelist) ? filterInput.whitelist.map(String).map((s) => s.trim()).filter(Boolean) : []
    blacklist = Array.isArray(filterInput.blacklist) ? filterInput.blacklist.map(String).map((s) => s.trim()).filter(Boolean) : []
  }

  return `(() => {
    try {
      const STYLE_ID = '__agent_pure_mode_style__';
      let styleEl = document.getElementById(STYLE_ID);
      if (!${JSON.stringify(enable)}) {
        if (styleEl) styleEl.remove();
        document.querySelectorAll('.__agent_pure_ancestor__, .__agent_pure_target__').forEach(el => {
          el.classList.remove('__agent_pure_ancestor__', '__agent_pure_target__');
        });
        return { ok: true, enabled: false };
      }

      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = STYLE_ID;
        document.head.appendChild(styleEl);
      }

      // 清理旧标记
      document.querySelectorAll('.__agent_pure_ancestor__, .__agent_pure_target__').forEach(el => {
        el.classList.remove('__agent_pure_ancestor__', '__agent_pure_target__');
      });

      const whitelist = ${JSON.stringify(whitelist)};
      const blacklist = ${JSON.stringify(blacklist)};

      // 1. 黑名单规则生成（绝对隐藏目标干扰节点）
      let blacklistRules = '';
      const validBlacklist = blacklist.map(s => (s || '').trim()).filter(Boolean);
      if (validBlacklist.length > 0) {
        blacklistRules = validBlacklist.join(',\\n') + ' { display: none !important; }';
      }

      // 2. 白名单目标元素查找
      const validWhitelist = whitelist.map(s => (s || '').trim()).filter(Boolean);
      const targets = [];
      if (validWhitelist.length > 0) {
        for (const sel of validWhitelist) {
          try {
            document.querySelectorAll(sel).forEach(el => {
              if (el && el !== document.body && el !== document.documentElement && !targets.includes(el)) {
                targets.push(el);
              }
            });
          } catch (e) {}
        }
      }

      // 若指定了白名单但当前网页未匹配到任何元素，尝试智能兜底主流正文容器
      if (validWhitelist.length > 0 && targets.length === 0) {
        const fallback = document.querySelector('article') ||
                         document.querySelector('main') ||
                         document.querySelector('[role="main"]') ||
                         document.querySelector('#content, .content, .post-content, .article-content, #article, .entry-content');
        if (fallback) targets.push(fallback);
      }

      // 3. 情况 A：没有白名单（或未匹配到），此时仅应用黑名单过滤，绝不破坏页面其余部分的正常阅读
      if (targets.length === 0) {
        styleEl.textContent = blacklistRules;
        return { ok: true, enabled: true, mode: 'blacklist_only', blacklist: validBlacklist };
      }

      // 4. 情况 B：有白名单，标记所有目标元素，并将它们的祖先链标记为 __agent_pure_ancestor__
      for (const t of targets) {
        t.classList.add('__agent_pure_target__');
        let curr = t.parentElement;
        while (curr && curr !== document.body && curr !== document.documentElement) {
          curr.classList.add('__agent_pure_ancestor__');
          curr = curr.parentElement;
        }
      }

      // 关键防误伤规则：
      // 只隐藏 body 和 ancestor 上的非保留兄弟分支；绝不对 target 内部子孙设置任何隐藏！
      // 绝不暴力覆写祖先元素的 display/margin/padding，从而保留原网页正常的居中、字体与网格布局。
      styleEl.textContent = [
        blacklistRules,
        'body > *:not(.__agent_pure_ancestor__):not(.__agent_pure_target__) { display: none !important; }',
        '.__agent_pure_ancestor__ > *:not(.__agent_pure_ancestor__):not(.__agent_pure_target__) { display: none !important; }',
        '.__agent_pure_target__ { visibility: visible !important; }',
      ].filter(Boolean).join('\\n');

      return {
        ok: true,
        enabled: true,
        mode: 'whitelist_and_blacklist',
        targetCount: targets.length,
        whitelist: validWhitelist,
        blacklist: validBlacklist,
      };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  })()`;
}
