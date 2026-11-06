/**
 * 网页访客环境（Guest Page）内的轻量 Agent 运行时脚本构造器。
 * 
 * 核心机制：
 * 1. 深度穿透 Shadow DOM 与同源 iframe；
 * 2. 紧凑语义索引生成（正文折叠、列表折叠、原子类去噪、图标语义补偿）；
 * 3. 基于 data-agent-id 与内存 Map 的精准定位；
 * 4. 真实用户级受控动作（click / fill / press / scroll / text / inspect）。
 */

/** 基础运行时的初始化脚本（挂载全局函数，支持重复调用与缓存刷新） */
export const BROWSER_RUNTIME_INIT_SCRIPT = `(() => {
  if (window.__agentRuntimeReady) return true;

  const IGNORE_TAGS = new Set(['SCRIPT', 'STYLE', 'SVG', 'PATH', 'META', 'LINK', 'NOSCRIPT', 'HEAD', 'BR', 'HR', 'IMG', 'CANVAS']);
  const LANDMARK_TAGS = new Set(['HEADER', 'NAV', 'MAIN', 'ARTICLE', 'SECTION', 'ASIDE', 'FOOTER', 'FORM', 'TABLE']);
  const ACTION_TAGS = new Set(['H1', 'H2', 'H3', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A']);

  const GENERIC_IDS = new Set([
    'app', 'root', 'main', 'body', 'content', 'contents', 'container', 'wrapper',
    'header', 'footer', 'navbar', 'end', 'new', 'canvas',
    'commentbox', 'comment-area', 'editor', 'input', 'user-avatar'
  ]);
  const NOISY_CLASS = /^(flex|grid|block|inline|hidden|relative|absolute|fixed|sticky|w-|h-|p[xytblr]?-\\d|m[xytblr]?-\\d|text-|bg-|border|rounded|shadow|items-|justify-|gap-|space-|z-|opacity-|transition|hover:|focus:|dark:|sm:|md:|lg:|xl:|css-|sc-|ant-|el-|mui-)/i;

  window.__agentNodeMap = new Map();

  function isVisible(el) {
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    }
    const r = el.getBoundingClientRect();
    return r.width > 5 && r.height > 5;
  }

  function cleanText(str, maxLen = 30) {
    const s = (str || '').replace(/\\s+/g, ' ').trim();
    return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
  }

  function getDeepText(el, maxDepth = 4) {
    if (!el || maxDepth < 0) return '';
    if (!el.shadowRoot && !el.tagName.includes('-') && !el.querySelector('*')) {
      return el.innerText || '';
    }
    let text = '';
    const root = el.shadowRoot || el;
    for (const node of root.childNodes) {
      if (node.nodeType === 3) {
        text += node.textContent + ' ';
      } else if (node.nodeType === 1 && !IGNORE_TAGS.has(node.tagName)) {
        if (node.tagName === 'SLOT') {
          const assigned = node.assignedNodes({ flatten: true });
          for (const a of assigned) text += (a.innerText || a.textContent || '') + ' ';
        } else {
          text += getDeepText(node, maxDepth - 1) + ' ';
        }
      }
      if (text.length > 120) break;
    }
    return text;
  }

  function isProseContainer(el) {
    const pCount = el.querySelectorAll(':scope > p, :scope > div > p, :scope > pre, :scope > blockquote').length;
    return pCount >= 3;
  }

  function getItemSummary(el) {
    const rawText = getDeepText(el, 3);
    const text = cleanText(rawText, 25);

    let title = el.getAttribute('title') || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
    if (!title && el.shadowRoot) {
      const innerInput = el.shadowRoot.querySelector('[placeholder], [aria-label]');
      if (innerInput) title = innerInput.getAttribute('placeholder') || innerInput.getAttribute('aria-label') || '';
    }

    if (/^\\d+$/.test(text) && !title) {
      const innerHtmlClasses = [el.className, ...[...el.querySelectorAll('[class]')].map(e => e.className)].join(' ');
      const match = innerHtmlClasses.match(/\\b(like|thumb|coin|fav|collect|star|share|forward|comment|reply|search|follow|watch)\\b/i);
      if (match) return \`\${match[1].toLowerCase()}:\${text}\`;
    }
    if (title && text && title !== text) return \`\${title}(\${text})\`;
    return title || text;
  }

  function getDescriptor(el, isEditable) {
    const tag = el.tagName.toLowerCase();
    if (ACTION_TAGS.has(el.tagName) || isEditable) {
      const hint = getItemSummary(el);
      const roleTag = isEditable && !ACTION_TAGS.has(el.tagName) ? \`\${tag}[editable]\` : tag;
      return hint ? \`\${roleTag} "\${hint}"\` : roleTag;
    }

    const id = (el.id && !GENERIC_IDS.has(el.id.toLowerCase())) ? \`#\${el.id}\` : '';
    let cls = '';
    if (!id && el.classList.length) {
      const bestClass = [...el.classList].find(c => c.length > 2 && c.length < 28 && !NOISY_CLASS.test(c));
      if (bestClass) cls = \`.\${bestClass}\`;
    }
    const summary = tag.includes('-') ? cleanText(getItemSummary(el), 25) : '';
    return \`\${tag}\${id}\${cls}\${summary ? \` "\${summary}"\` : ''}\`;
  }

  function getEffectiveChildren(el) {
    const raw = [];
    if (el.shadowRoot) raw.push(...el.shadowRoot.children);
    raw.push(...el.children);
    return raw.filter(c => c.nodeType === 1 && !IGNORE_TAGS.has(c.tagName) && isVisible(c));
  }

  window.__findAgentNode = function(agentId, root = document) {
    if (typeof agentId === 'string' && isNaN(Number(agentId))) {
      return root.querySelector(agentId);
    }
    const numId = Number(agentId);
    const cached = window.__agentNodeMap?.get(numId);
    if (cached && cached.isConnected) return cached;

    const selector = \`[data-agent-id="\${numId}"]\`;
    const direct = root.querySelector(selector);
    if (direct) {
      window.__agentNodeMap?.set(numId, direct);
      return direct;
    }

    const allElements = root.querySelectorAll('*');
    for (const el of allElements) {
      if (el.shadowRoot) {
        const found = window.__findAgentNode(numId, el.shadowRoot);
        if (found) {
          window.__agentNodeMap?.set(numId, found);
          return found;
        }
      }
      if (el.tagName === 'IFRAME') {
        try {
          if (el.contentDocument) {
            const found = window.__findAgentNode(numId, el.contentDocument);
            if (found) {
              window.__agentNodeMap?.set(numId, found);
              return found;
            }
          }
        } catch {}
      }
    }
    return null;
  };

  window.__agentIndex = function(focusTarget) {
    window.__agentNodeMap.clear();
    const lines = [];
    let nodeId = 1;

    function mark(el) {
      const id = nodeId++;
      el.setAttribute('data-agent-id', id);
      window.__agentNodeMap.set(id, el);
      return id;
    }

    function walk(el, depth = 0) {
      if (!el || el.nodeType !== 1 || IGNORE_TAGS.has(el.tagName) || !isVisible(el)) return;

      const indent = ' '.repeat(Math.min(depth, 6));
      const tag = el.tagName;
      const isCustomElement = tag.includes('-');
      const isEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true' || tag.includes('TEXTAREA') || tag.includes('INPUT');

      if (isProseContainer(el)) {
        const id = mark(el);
        const totalChars = (el.innerText || '').replace(/\\s+/g, '').length;
        const headings = [...el.querySelectorAll('h1, h2, h3, h4')].map(h => cleanText(h.innerText, 15)).slice(0, 6);
        const outline = headings.length ? \` | 提纲: \${headings.join(' / ')}\` : '';
        lines.push(\`\${indent}[\${id}] \${getDescriptor(el, false)} (正文区: 共\${totalChars}字\${outline} -> "\${cleanText(el.innerText, 35)}")\`);
        return;
      }

      const children = getEffectiveChildren(el);

      if (children.length >= 3) {
        const tagCounts = {};
        children.forEach(c => tagCounts[c.tagName] = (tagCounts[c.tagName] || 0) + 1);
        const [dominantTag, count] = Object.entries(tagCounts).sort((a, b) => b[1] - a[1])[0];

        if ((dominantTag.includes('-') && count >= 3) || (count >= 4 && count / children.length >= 0.7)) {
          const samples = children
            .map(c => getItemSummary(c))
            .filter(Boolean)
            .slice(0, 3)
            .map(s => \`"\${s}"\`)
            .join(', ');
          if (samples) {
            const id = mark(el);
            lines.push(\`\${indent}[\${id}] \${getDescriptor(el, false)} [列表: 共\${children.length}项 \${dominantTag.toLowerCase()}, 示例: \${samples} ...]\`);
            return;
          }
        }
      }

      const isLandmark = LANDMARK_TAGS.has(tag) || isCustomElement;
      const isAction = ACTION_TAGS.has(tag) || isEditable;
      const hasMeaningfulId = Boolean(el.id && !GENERIC_IDS.has(el.id.toLowerCase()));

      let nextDepth = depth;
      if (isLandmark || isAction || hasMeaningfulId) {
        if (isAction && !getItemSummary(el)) return;

        const lineIndexBefore = lines.length;
        const currentId = mark(el);
        lines.push(\`\${indent}[\${currentId}] \${getDescriptor(el, isEditable)}\`);

        if (isAction) return;

        for (const child of children) {
          walk(child, depth + 1);
        }

        if (lines.length === lineIndexBefore + 1 && !cleanText(getDeepText(el, 2))) {
          lines.pop();
          window.__agentNodeMap.delete(currentId);
          el.removeAttribute('data-agent-id');
          nodeId--;
        }
        return;
      }

      for (const child of children) {
        walk(child, nextDepth);
      }
    }

    let rootEl = document.body;
    if (focusTarget !== undefined && focusTarget !== null) {
      rootEl = window.__findAgentNode(focusTarget) || document.body;
    }

    walk(rootEl);
    return {
      text: lines.join('\\n'),
      count: window.__agentNodeMap.size,
      title: document.title || '',
      url: window.location.href,
    };
  };

  window.__agentClick = function(target, opts = {}) {
    const el = window.__findAgentNode(target);
    if (!el) return { ok: false, error: '未找到节点 [' + target + ']，页面可能已变化，请先重新 index()' };

    try {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    } catch {}

    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const eventInit = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };

    el.dispatchEvent(new PointerEvent('pointerdown', eventInit));
    el.dispatchEvent(new MouseEvent('mousedown', eventInit));
    el.focus?.();
    el.dispatchEvent(new PointerEvent('pointerup', eventInit));
    el.dispatchEvent(new MouseEvent('mouseup', eventInit));
    el.dispatchEvent(new MouseEvent('click', eventInit));

    return { ok: true, tag: el.tagName.toLowerCase() };
  };

  window.__agentFill = function(target, text, opts = {}) {
    const el = window.__findAgentNode(target);
    if (!el) return { ok: false, error: '未找到节点 [' + target + ']，页面可能已变化，请先重新 index()' };

    el.focus?.();

    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
      if (opts.clear !== false) {
        document.execCommand('selectAll', false, null);
      }
      document.execCommand('insertText', false, String(text));
    } else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      const val = opts.clear === false ? (el.value || '') + String(text) : String(text);
      if (setter) {
        setter.call(el, val);
      } else {
        el.value = val;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (opts.pressEnter) {
      const keyOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
      el.dispatchEvent(new KeyboardEvent('keypress', keyOpts));
      el.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
      const form = el.closest?.('form');
      if (form) {
        try {
          if (typeof form.requestSubmit === 'function') form.requestSubmit();
          else form.submit();
        } catch {}
      }
    }

    return { ok: true, tag: el.tagName.toLowerCase() };
  };

  window.__agentPress = function(key, target) {
    const el = target ? window.__findAgentNode(target) : document.activeElement || document.body;
    if (!el) return { ok: false, error: '未找到按键目标节点' };

    el.focus?.();
    const keyName = String(key);
    const map = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, Delete: 46, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35 };
    const keyCode = map[keyName] ?? (keyName.length === 1 ? keyName.toUpperCase().charCodeAt(0) : 0);
    const keyOpts = { key: keyName, code: keyName, keyCode, which: keyCode, bubbles: true, cancelable: true };

    el.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
    el.dispatchEvent(new KeyboardEvent('keypress', keyOpts));
    el.dispatchEvent(new KeyboardEvent('keyup', keyOpts));

    return { ok: true, key: keyName };
  };

  window.__agentScroll = function(opts = {}) {
    const container = opts.target ? window.__findAgentNode(opts.target) : window;
    if (opts.target && !container) return { ok: false, error: '未找到滚动目标节点' };

    if (container === window) {
      if (opts.to === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
      else if (opts.to === 'bottom') window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      else if (typeof opts.by === 'number') window.scrollBy({ top: opts.by, behavior: 'smooth' });

      const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 50;
      return {
        ok: true,
        scrollY: window.scrollY,
        scrollHeight: document.body.scrollHeight,
        atBottom,
      };
    } else {
      const el = container;
      if (opts.to === 'top') el.scrollTop = 0;
      else if (opts.to === 'bottom') el.scrollTop = el.scrollHeight;
      else if (typeof opts.by === 'number') el.scrollTop += opts.by;

      const atBottom = el.clientHeight + el.scrollTop >= el.scrollHeight - 50;
      return {
        ok: true,
        scrollY: el.scrollTop,
        scrollHeight: el.scrollHeight,
        atBottom,
      };
    }
  };

  window.__agentText = function(target, opts = {}) {
    const el = window.__findAgentNode(target);
    if (!el) return { ok: false, error: '未找到节点 [' + target + ']，页面可能已变化，请先重新 index()' };

    const fullText = (el.innerText || el.textContent || '').trim();
    const maxChars = typeof opts.maxChars === 'number' ? Math.max(opts.maxChars, 100) : 8000;
    const offset = typeof opts.offset === 'number' ? Math.max(opts.offset, 0) : 0;
    const sliced = fullText.slice(offset, offset + maxChars);

    return {
      ok: true,
      id: target,
      text: sliced,
      totalChars: fullText.length,
      offset,
      hasMore: offset + sliced.length < fullText.length,
      nextOffset: offset + sliced.length < fullText.length ? offset + sliced.length : undefined,
    };
  };

  window.__agentInspect = function(target) {
    const el = window.__findAgentNode(target);
    if (!el) return { ok: false, error: '未找到节点 [' + target + ']，页面可能已变化，请先重新 index()' };

    const rect = el.getBoundingClientRect();
    return {
      ok: true,
      id: target,
      tag: el.tagName.toLowerCase(),
      idAttr: el.id || undefined,
      className: el.className || undefined,
      value: (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) ? el.value : undefined,
      placeholder: el.getAttribute('placeholder') || undefined,
      href: el.getAttribute('href') || undefined,
      checked: (el instanceof HTMLInputElement) ? el.checked : undefined,
      disabled: Boolean(el.disabled || el.getAttribute('disabled')),
      isEditable: Boolean(el.isContentEditable || el.getAttribute('contenteditable') === 'true' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    };
  };

  window.__agentRuntimeReady = true;
  return true;
})()`;

/** 生成调用指定 Agent 运行时操作的 JS 包装语句 */
export function buildRuntimeExecScript(fnCall: string): string {
  return `(async () => {
    ${BROWSER_RUNTIME_INIT_SCRIPT};
    return await (${fnCall});
  })()`;
}
