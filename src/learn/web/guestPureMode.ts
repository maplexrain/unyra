/**
 * 网页纯净阅读与 DOM 元素过滤注入脚本。
 *
 * 核心原理：
 * 1. 查找指定过滤选择器的目标元素（或兜底的正文容器 article / main / #content 等）；
 * 2. 给从 document.body 到目标元素路径上的所有祖先元素打上纯净保留类；
 * 3. 注入专用隔离样式：隐藏所有非保留分支与常见噪音元素（header, nav, footer, sidebar, ads）；
 * 4. 优化目标正文的排版展示（居中、适度留白、去除外部阴影与固定遮挡）；
 * 5. 关闭时一键清理样式与类名，无缝还原原网页。
 */
export function buildApplyPureModeScript(filterSelector?: string, enable = true): string {
  return `(() => {
    try {
      const STYLE_ID = '__agent_pure_mode_style__';
      let styleEl = document.getElementById(STYLE_ID);
      if (!${JSON.stringify(enable)}) {
        if (styleEl) styleEl.remove();
        document.querySelectorAll('.__agent_pure_keep__, .__agent_pure_target__').forEach(el => {
          el.classList.remove('__agent_pure_keep__', '__agent_pure_target__');
        });
        return { ok: true, enabled: false };
      }

      let target = null;
      const selector = ${JSON.stringify(filterSelector || '')};
      if (selector) {
        try {
          target = document.querySelector(selector);
        } catch (e) {}
      }
      if (!target) {
        target = document.querySelector('article') ||
                 document.querySelector('main') ||
                 document.querySelector('[role="main"]') ||
                 document.querySelector('#content, .content, .post-content, .article-content, #article, .entry-content');
      }

      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = STYLE_ID;
        document.head.appendChild(styleEl);
      }

      document.querySelectorAll('.__agent_pure_keep__, .__agent_pure_target__').forEach(el => {
        el.classList.remove('__agent_pure_keep__', '__agent_pure_target__');
      });

      if (!target) {
        styleEl.textContent = \`
          header, nav, footer, aside, .sidebar, .ad, .advertisement, [role="banner"], [role="navigation"] {
            display: none !important;
          }
        \`;
        return { ok: true, enabled: true, fallback: true };
      }

      let curr = target;
      while (curr && curr !== document.body && curr !== document.documentElement) {
        curr.classList.add('__agent_pure_keep__');
        curr = curr.parentElement;
      }
      target.classList.add('__agent_pure_target__');

      styleEl.textContent = \`
        body > *:not(.__agent_pure_keep__),
        .__agent_pure_keep__ > *:not(.__agent_pure_keep__) {
          display: none !important;
        }
        .__agent_pure_target__ {
          display: block !important;
          visibility: visible !important;
          max-width: 860px !important;
          margin: 24px auto !important;
          padding: 24px !important;
          background: transparent !important;
          box-shadow: none !important;
          border: none !important;
        }
        .__agent_pure_keep__ {
          display: block !important;
          margin: 0 !important;
          padding: 0 !important;
          border: none !important;
          background: transparent !important;
          box-shadow: none !important;
          width: 100% !important;
          max-width: 100% !important;
          overflow: visible !important;
        }
      \`;
      return { ok: true, enabled: true, selector };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  })()`;
}
