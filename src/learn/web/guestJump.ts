/**
 * 平滑滚动至指定选择器对应的 DOM 元素，并附加醒目的轮廓高亮动效。
 */
export function buildJumpToElementScript(selector: string): string {
  return `(() => {
    try {
      const sel = ${JSON.stringify(selector)};
      if (!sel) return { ok: false, error: '未指定选择器' };
      let el = null;
      try {
        el = document.querySelector(sel);
      } catch (e) {}
      if (!el && sel.startsWith('#')) {
        const id = sel.slice(1);
        try {
          el = document.getElementById(id) || document.querySelector('[name="' + CSS.escape(id) + '"]');
        } catch (e) {}
      }
      if (!el && window.__findAgentNode) {
        el = window.__findAgentNode(sel);
      }
      if (!el) {
        return { ok: false, error: '未找到元素: ' + sel };
      }

      el.scrollIntoView({ behavior: 'smooth', block: 'center' });

      const prevTransition = el.style.transition;
      const prevOutline = el.style.outline;
      const prevBoxShadow = el.style.boxShadow;

      el.style.transition = 'all 0.4s ease-out';
      el.style.outline = '3px solid #f59e0b';
      el.style.boxShadow = '0 0 16px rgba(245, 158, 11, 0.5)';

      setTimeout(() => {
        el.style.outline = prevOutline;
        el.style.boxShadow = prevBoxShadow;
        setTimeout(() => {
          el.style.transition = prevTransition;
        }, 400);
      }, 2500);

      return { ok: true, tag: el.tagName };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  })()`;
}
