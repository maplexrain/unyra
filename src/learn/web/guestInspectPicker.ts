/**
 * 网页元素可视化拾取器（Inspector Element Picker）脚本。
 *
 * 在 webview 中注入交互层：
 * 1. 鼠标滑过时为当前元素绘制高亮黄色线框与半透明遮罩，并显示元素标签与选择器标签；
 * 2. 顶部显示交互提示条（点击拾取 / 按 ESC 取消）；
 * 3. 鼠标点击时阻止页面默认行为，自动推导该元素的最优 CSS 选择器；
 * 4. 自动清理注入的 DOM 与监听器，返回推导出的 selector 结果。
 */

export function buildInspectElementPickerScript(): string {
  return `(function() {
    return new Promise((resolve) => {
      const OVERLAY_ID = '__agent_inspect_overlay__';
      const BADGE_ID = '__agent_inspect_badge__';
      const BANNER_ID = '__agent_inspect_banner__';

      // 清理任何既有的拾取器元素
      [OVERLAY_ID, BADGE_ID, BANNER_ID].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
      });

      const overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.style.cssText = [
        'position: fixed',
        'pointer-events: none',
        'z-index: 2147483646',
        'border: 2px solid #f59e0b',
        'background-color: rgba(245, 158, 11, 0.16)',
        'border-radius: 4px',
        'transition: all 0.05s ease-out',
        'display: none',
        'box-sizing: border-box',
      ].join(';');

      const badge = document.createElement('div');
      badge.id = BADGE_ID;
      badge.style.cssText = [
        'position: fixed',
        'pointer-events: none',
        'z-index: 2147483647',
        'background: #f59e0b',
        'color: #ffffff',
        'font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        'font-size: 11px',
        'font-weight: 600',
        'line-height: 1',
        'padding: 3px 6px',
        'border-radius: 3px',
        'box-shadow: 0 2px 6px rgba(0,0,0,0.25)',
        'display: none',
        'white-space: nowrap',
      ].join(';');

      const banner = document.createElement('div');
      banner.id = BANNER_ID;
      banner.textContent = '🎯 点击网页元素确定为纯净阅读容器 · 按 ESC 键退出';
      banner.style.cssText = [
        'position: fixed',
        'top: 12px',
        'left: 50%',
        'transform: translateX(-50%)',
        'z-index: 2147483647',
        'background: rgba(17, 24, 39, 0.92)',
        'color: #ffffff',
        'padding: 7px 16px',
        'border-radius: 9999px',
        'font-size: 12px',
        'font-weight: 500',
        'font-family: system-ui, -apple-system, sans-serif',
        'box-shadow: 0 4px 14px rgba(0,0,0,0.3)',
        'pointer-events: none',
        'user-select: none',
        'letter-spacing: 0.2px',
      ].join(';');

      document.body.appendChild(overlay);
      document.body.appendChild(badge);
      document.body.appendChild(banner);

      const NOISY_CLASS = /^(flex|grid|block|inline|hidden|relative|absolute|fixed|sticky|w-|h-|p[xytblr]?-\\d|m[xytblr]?-\\d|text-|bg-|border|rounded|shadow|items-|justify-|gap-|space-|z-|opacity-|transition|hover:|focus:|dark:|sm:|md:|lg:|xl:|css-|sc-|ant-|el-|mui-)/i;

      function getMeaningfulClasses(el) {
        if (!el.className || typeof el.className !== 'string') return [];
        return el.className
          .trim()
          .split(/\\s+/)
          .filter(c => c && !NOISY_CLASS.test(c) && !c.startsWith('__agent_'));
      }

      function computeBestSelector(el) {
        if (!el || el === document.body || el === document.documentElement) {
          return 'body';
        }

        // 1. 若具有唯一且语义明确的 ID
        if (el.id && typeof el.id === 'string' && !/^(app|root|body|container|wrapper|main)$/i.test(el.id)) {
          const idSelector = '#' + CSS.escape(el.id);
          try {
            if (document.querySelectorAll(idSelector).length === 1) {
              return idSelector;
            }
          } catch (e) {}
        }

        const tag = el.tagName.toLowerCase();

        // 2. 顶级语义标签
        if (['article', 'main'].includes(tag)) {
          try {
            if (document.querySelectorAll(tag).length === 1) {
              return tag;
            }
          } catch (e) {}
        }

        // 3. 结合有意义的 Class
        const classes = getMeaningfulClasses(el);
        for (const cls of classes) {
          const candidate = tag + '.' + CSS.escape(cls);
          try {
            if (document.querySelectorAll(candidate).length === 1) {
              return candidate;
            }
          } catch (e) {}
          const classOnly = '.' + CSS.escape(cls);
          try {
            if (document.querySelectorAll(classOnly).length === 1) {
              return classOnly;
            }
          } catch (e) {}
        }

        // 4. 向上溯源一至两层寻找唯一定位
        let curr = el;
        const parts = [];
        while (curr && curr !== document.body && curr !== document.documentElement && parts.length < 3) {
          const t = curr.tagName.toLowerCase();
          const currClasses = getMeaningfulClasses(curr);
          let part = t;
          if (curr.id && !/^(app|root|body|container|wrapper)$/i.test(curr.id)) {
            part = '#' + CSS.escape(curr.id);
            parts.unshift(part);
            break;
          } else if (currClasses.length > 0) {
            part = t + '.' + CSS.escape(currClasses[0]);
          }
          parts.unshift(part);
          curr = curr.parentElement;
        }

        const candidatePath = parts.join(' > ');
        try {
          if (document.querySelectorAll(candidatePath).length === 1) {
            return candidatePath;
          }
        } catch (e) {}

        return candidatePath || tag;
      }

      let currentTarget = null;

      function onMouseMove(e) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || el === overlay || el === badge || el === banner || el === document.body || el === document.documentElement) {
          return;
        }
        currentTarget = el;
        const rect = el.getBoundingClientRect();
        overlay.style.display = 'block';
        overlay.style.top = rect.top + 'px';
        overlay.style.left = rect.left + 'px';
        overlay.style.width = rect.width + 'px';
        overlay.style.height = rect.height + 'px';

        const tag = el.tagName.toLowerCase();
        const idPart = el.id ? '#' + el.id : '';
        const classes = getMeaningfulClasses(el);
        const clsPart = classes.length ? '.' + classes.slice(0, 2).join('.') : '';
        badge.textContent = tag + idPart + clsPart;
        badge.style.display = 'block';

        let badgeTop = rect.top - 24;
        if (badgeTop < 10) badgeTop = rect.top + 4;
        badge.style.top = Math.max(badgeTop, 4) + 'px';
        badge.style.left = Math.max(rect.left, 4) + 'px';
      }

      function cleanup() {
        window.removeEventListener('mousemove', onMouseMove, true);
        window.removeEventListener('click', onClick, true);
        window.removeEventListener('keydown', onKeyDown, true);
        overlay.remove();
        badge.remove();
        banner.remove();
      }

      function onClick(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const el = currentTarget || document.elementFromPoint(e.clientX, e.clientY);
        const selector = computeBestSelector(el);
        cleanup();
        resolve({ ok: true, selector });
      }

      function onKeyDown(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup();
          resolve({ ok: false, cancelled: true });
        }
      }

      window.addEventListener('mousemove', onMouseMove, true);
      window.addEventListener('click', onClick, true);
      window.addEventListener('keydown', onKeyDown, true);
    });
  })();`;
}
