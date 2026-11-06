/**
 * 网页访客环境（Guest Page）内的轻量 Agent 运行时脚本构造器。
 * 
 * 核心机制：
 * 1. 深度穿透 Shadow DOM 与同源 iframe；
 * 2. 紧凑语义索引生成（正文折叠、列表折叠、原子类去噪、图标语义补偿）；
 * 3. 基于 data-agent-id、内存 Map 与 Deep QuerySelector 的全域寻址；
 * 4. 健壮的真实用户级受控动作（click / fill / type / press / scroll / text / inspect），
 *    彻底消除原型链 Illegal invocation 崩溃，无缝支持 Web Components 与复杂 Shadow DOM 富文本。
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

  function safeFormatError(err) {
    if (!err) return '未知错误';
    if (typeof err === 'string') return err;
    if (err.message) return String(err.message);
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }

  function isVisible(el) {
    if (!el) return false;
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

  /** 下钻解析可编辑核心节点（穿越自定义组件宿主与 Shadow DOM） */
  function resolveEditableTarget(el, maxDepth = 3) {
    if (!el || maxDepth < 0) return el;
    const tag = el.tagName.toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA') return el;
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '') {
      return el;
    }

    const editableSelector = 'textarea, input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), [contenteditable="true"], [contenteditable=""], [role="textbox"]';

    if (el.shadowRoot) {
      try {
        const match = el.shadowRoot.querySelector(editableSelector);
        if (match) return match;
      } catch {}
      for (const child of el.shadowRoot.children) {
        if (child.tagName.includes('-') || child.shadowRoot) {
          const nested = resolveEditableTarget(child, maxDepth - 1);
          if (nested && nested !== child) return nested;
        }
      }
    }

    try {
      const lightMatch = el.querySelector(editableSelector);
      if (lightMatch) return lightMatch;
    } catch {}

    return el;
  }

  /** 下钻解析可点击按钮或链接核心节点 */
  function resolveClickableTarget(el) {
    if (!el) return el;
    const tag = el.tagName.toUpperCase();
    if (ACTION_TAGS.has(tag)) return el;
    if (el.shadowRoot) {
      try {
        const innerAction = el.shadowRoot.querySelector('button, a, input[type="button"], input[type="submit"], [role="button"], [tabindex]');
        if (innerAction) return innerAction;
      } catch {}
    }
    return el;
  }

  /** 统一的节点可编辑判定（index 与 inspect 严格保持口径一致） */
  function checkIsEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName.toUpperCase();
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
      const nonTextInputs = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'file', 'hidden', 'color', 'range']);
      return !nonTextInputs.has((el.type || '').toLowerCase());
    }
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '') {
      return true;
    }
    if (el.getAttribute('role') === 'textbox') return true;

    // 自定义组件：标签名包含输入语义（如 bili-comment-rich-textarea）
    if (tag.includes('-') && (tag.includes('TEXTAREA') || tag.includes('INPUT') || tag.includes('EDITOR') || tag.includes('SEARCH'))) {
      return true;
    }

    // Shadow Host 且直接承载输入节点（排除布局容器如 comment-box）
    if (el.shadowRoot && !tag.includes('BOX') && !tag.includes('CONTAINER') && !tag.includes('WRAPPER') && !GENERIC_IDS.has(tag.toLowerCase())) {
      try {
        const directEditor = el.shadowRoot.querySelector('textarea, input, [contenteditable="true"], [role="textbox"]');
        if (directEditor) return true;
      } catch {}
    }
    return false;
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

  /** 递归穿透所有 ShadowRoot 与同源 iframe 的深度选择器查找 */
  function deepQuerySelector(root, selector) {
    if (!root || !selector) return null;

    if (selector.includes('>>>') || selector.includes('::shadow')) {
      const parts = selector.split(/\\s*>>>\\s*|\\s*::shadow\\s*/);
      let cur = root;
      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const curRoot = cur.shadowRoot || cur;
        const next = deepQuerySelector(curRoot, trimmed);
        if (!next) return null;
        cur = next;
      }
      return cur;
    }

    try {
      const match = root.querySelector(selector);
      if (match) return match;
    } catch {}

    const all = root.querySelectorAll('*');
    for (const el of all) {
      if (el.shadowRoot) {
        const found = deepQuerySelector(el.shadowRoot, selector);
        if (found) return found;
      }
      if (el.tagName === 'IFRAME') {
        try {
          if (el.contentDocument) {
            const found = deepQuerySelector(el.contentDocument, selector);
            if (found) return found;
          }
        } catch {}
      }
    }
    return null;
  }

  window.__findAgentNode = function(agentId, root = document) {
    if (agentId === undefined || agentId === null) return null;

    // 字符串且非纯数字：作为 CSS 选择器深度穿透查询
    if (typeof agentId === 'string' && isNaN(Number(agentId))) {
      return deepQuerySelector(root, agentId);
    }

    const numId = Number(agentId);
    const cached = window.__agentNodeMap?.get(numId);
    if (cached && cached.isConnected) return cached;

    const selector = \`[data-agent-id="\${numId}"]\`;
    const found = deepQuerySelector(root, selector);
    if (found) {
      window.__agentNodeMap?.set(numId, found);
      return found;
    }
    return null;
  };

  window.__agentIndex = function(focusTarget) {
    try {
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
        const isEditable = checkIsEditable(el);

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
    } catch (err) {
      return {
        text: '',
        count: 0,
        title: document.title || '',
        url: window.location.href,
        error: safeFormatError(err),
      };
    }
  };

  window.__agentClick = function(target, opts = {}) {
    try {
      const el = window.__findAgentNode(target);
      if (!el) return { ok: false, error: '未找到节点 [' + target + ']，页面可能已变化，请先重新 index()' };

      const resolvedEl = resolveClickableTarget(el);

      try {
        resolvedEl.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      } catch {}

      const rect = resolvedEl.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const doc = resolvedEl.ownerDocument || document;
      const win = doc.defaultView || window;
      const eventInit = { bubbles: true, cancelable: true, composed: true, view: win, clientX: x, clientY: y };

      try { resolvedEl.focus?.(); } catch {}
      try { resolvedEl.dispatchEvent(new PointerEvent('pointerdown', eventInit)); } catch {}
      try { resolvedEl.dispatchEvent(new MouseEvent('mousedown', eventInit)); } catch {}
      try { resolvedEl.dispatchEvent(new PointerEvent('pointerup', eventInit)); } catch {}
      try { resolvedEl.dispatchEvent(new MouseEvent('mouseup', eventInit)); } catch {}

      try {
        if (typeof resolvedEl.click === 'function') {
          resolvedEl.click();
        } else {
          resolvedEl.dispatchEvent(new MouseEvent('click', eventInit));
        }
      } catch {
        resolvedEl.dispatchEvent(new MouseEvent('click', eventInit));
      }

      return {
        ok: true,
        tag: el.tagName.toLowerCase(),
        resolvedTag: resolvedEl.tagName.toLowerCase(),
      };
    } catch (err) {
      return { ok: false, error: safeFormatError(err) };
    }
  };

  window.__agentFill = function(target, text, opts = {}) {
    try {
      const el = window.__findAgentNode(target);
      if (!el) return { ok: false, error: '未找到节点 [' + target + ']，页面可能已变化，请先重新 index()' };

      const resolvedEl = resolveEditableTarget(el);
      const isNativeInput = resolvedEl instanceof HTMLInputElement || resolvedEl instanceof HTMLTextAreaElement;
      const isCE = resolvedEl.isContentEditable || resolvedEl.getAttribute('contenteditable') === 'true' || resolvedEl.getAttribute('contenteditable') === '';

      try {
        resolvedEl.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      } catch {}
      try {
        resolvedEl.focus?.();
      } catch {}

      const val = String(text ?? '');
      const doc = resolvedEl.ownerDocument || document;
      const win = doc.defaultView || window;

      let resolvedType = 'generic';

      if (isNativeInput) {
        resolvedType = resolvedEl instanceof HTMLTextAreaElement ? 'textarea' : 'input';
        const proto = resolvedEl instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        const currentVal = opts.clear === false ? (resolvedEl.value || '') : '';
        const newVal = currentVal + val;

        if (setter) {
          setter.call(resolvedEl, newVal);
        } else {
          resolvedEl.value = newVal;
        }

        resolvedEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        resolvedEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      } else if (isCE) {
        resolvedType = 'contenteditable';
        const sel = win.getSelection?.();
        if (sel) {
          const range = doc.createRange();
          range.selectNodeContents(resolvedEl);
          if (opts.clear === false) {
            range.collapse(false);
          }
          sel.removeAllRanges();
          sel.addRange(range);
        }

        let inserted = false;
        try {
          if (opts.clear !== false) {
            doc.execCommand('selectAll', false, null);
          }
          inserted = doc.execCommand('insertText', false, val);
        } catch {}

        const InputEventClass = win.InputEvent || win.Event;
        try {
          resolvedEl.dispatchEvent(new InputEventClass('beforeinput', {
            bubbles: true,
            cancelable: true,
            composed: true,
            inputType: 'insertText',
            data: val,
          }));
        } catch {}

        if (!inserted || (resolvedEl.innerText !== val && !resolvedEl.textContent?.includes(val))) {
          if (opts.clear === false) {
            resolvedEl.innerText = (resolvedEl.innerText || '') + val;
          } else {
            resolvedEl.innerText = val;
          }
        }

        try {
          resolvedEl.dispatchEvent(new InputEventClass('input', {
            bubbles: true,
            cancelable: false,
            composed: true,
            inputType: 'insertText',
            data: val,
          }));
        } catch {}
      } else {
        resolvedType = 'custom';
        if ('value' in resolvedEl && typeof Object.getOwnPropertyDescriptor(Object.getPrototypeOf(resolvedEl), 'value')?.set === 'function') {
          try {
            resolvedEl.value = val;
          } catch {}
        } else {
          resolvedEl.textContent = val;
        }
        resolvedEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        resolvedEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      }

      if (opts.pressEnter) {
        const keyOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
        resolvedEl.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
        resolvedEl.dispatchEvent(new KeyboardEvent('keypress', keyOpts));
        resolvedEl.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
        const form = resolvedEl.closest?.('form');
        if (form) {
          try {
            if (typeof form.requestSubmit === 'function') form.requestSubmit();
            else form.submit();
          } catch {}
        }
      }

      return {
        ok: true,
        tag: el.tagName.toLowerCase(),
        resolvedTag: resolvedEl.tagName.toLowerCase(),
        resolvedType,
      };
    } catch (err) {
      return { ok: false, error: safeFormatError(err) };
    }
  };

  /** 逐字符按键仿真与 IME 模拟输入（为 B 站、知乎等 Shadow DOM 复杂富文本框量身定制的健壮输入通道） */
  window.__agentType = async function(target, text, opts = {}) {
    try {
      const el = target ? window.__findAgentNode(target) : document.activeElement || document.body;
      if (!el) return { ok: false, error: '未找到输入目标节点' };

      const resolvedEl = resolveEditableTarget(el);
      try {
        resolvedEl.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      } catch {}
      try {
        resolvedEl.focus?.();
      } catch {}

      const str = String(text ?? '');
      const doc = resolvedEl.ownerDocument || document;
      const win = doc.defaultView || window;
      const isNativeInput = resolvedEl instanceof HTMLInputElement || resolvedEl instanceof HTMLTextAreaElement;
      const delayMs = typeof opts.delayMs === 'number' && opts.delayMs > 0 ? opts.delayMs : 0;

      try {
        resolvedEl.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, cancelable: true, composed: true, data: '' }));
      } catch {}

      for (let i = 0; i < str.length; i++) {
        const char = str[i];
        const keyCode = char.charCodeAt(0);
        const keyOpts = { key: char, code: 'Key' + char.toUpperCase(), keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true };

        resolvedEl.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
        resolvedEl.dispatchEvent(new KeyboardEvent('keypress', keyOpts));

        const InputEventClass = win.InputEvent || win.Event;
        try {
          resolvedEl.dispatchEvent(new InputEventClass('beforeinput', {
            bubbles: true,
            cancelable: true,
            composed: true,
            inputType: 'insertText',
            data: char,
          }));
        } catch {}

        if (isNativeInput) {
          const start = resolvedEl.selectionStart ?? resolvedEl.value.length;
          const end = resolvedEl.selectionEnd ?? resolvedEl.value.length;
          const current = resolvedEl.value || '';
          resolvedEl.value = current.slice(0, start) + char + current.slice(end);
          resolvedEl.selectionStart = resolvedEl.selectionEnd = start + 1;
        } else {
          let inserted = false;
          try {
            inserted = doc.execCommand('insertText', false, char);
          } catch {}
          if (!inserted) {
            const sel = win.getSelection?.();
            if (sel && sel.rangeCount > 0) {
              const range = sel.getRangeAt(0);
              range.deleteContents();
              const textNode = doc.createTextNode(char);
              range.insertNode(textNode);
              range.setStartAfter(textNode);
              range.setEndAfter(textNode);
              sel.removeAllRanges();
              sel.addRange(range);
            } else {
              resolvedEl.innerText = (resolvedEl.innerText || '') + char;
            }
          }
        }

        try {
          resolvedEl.dispatchEvent(new InputEventClass('input', {
            bubbles: true,
            cancelable: false,
            composed: true,
            inputType: 'insertText',
            data: char,
          }));
        } catch {}

        resolvedEl.dispatchEvent(new KeyboardEvent('keyup', keyOpts));

        if (delayMs > 0) {
          await new Promise(r => setTimeout(r, delayMs));
        }
      }

      try {
        resolvedEl.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, cancelable: true, composed: true, data: str }));
      } catch {}

      if (isNativeInput) {
        resolvedEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      }

      return {
        ok: true,
        tag: el.tagName.toLowerCase(),
        resolvedTag: resolvedEl.tagName.toLowerCase(),
        typedChars: str.length,
      };
    } catch (err) {
      return { ok: false, error: safeFormatError(err) };
    }
  };

  window.__agentPress = function(key, target) {
    try {
      const el = target ? window.__findAgentNode(target) : document.activeElement || document.body;
      if (!el) return { ok: false, error: '未找到按键目标节点' };

      el.focus?.();
      const keyName = String(key);
      const map = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, Delete: 46, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35 };
      const keyCode = map[keyName] ?? (keyName.length === 1 ? keyName.toUpperCase().charCodeAt(0) : 0);
      const keyOpts = { key: keyName, code: keyName, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true };

      el.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
      el.dispatchEvent(new KeyboardEvent('keypress', keyOpts));
      el.dispatchEvent(new KeyboardEvent('keyup', keyOpts));

      return { ok: true, key: keyName };
    } catch (err) {
      return { ok: false, error: safeFormatError(err) };
    }
  };

  window.__agentScroll = function(opts = {}) {
    try {
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
    } catch (err) {
      return { ok: false, error: safeFormatError(err) };
    }
  };

  window.__agentText = function(target, opts = {}) {
    try {
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
    } catch (err) {
      return { ok: false, error: safeFormatError(err) };
    }
  };

  window.__agentInspect = function(target) {
    try {
      const el = window.__findAgentNode(target);
      if (!el) return { ok: false, error: '未找到节点 [' + target + ']，页面可能已变化，请先重新 index()' };

      const resolvedEl = resolveEditableTarget(el);
      const rect = el.getBoundingClientRect();
      return {
        ok: true,
        id: target,
        tag: el.tagName.toLowerCase(),
        resolvedTag: resolvedEl !== el ? resolvedEl.tagName.toLowerCase() : undefined,
        idAttr: el.id || undefined,
        className: el.className || undefined,
        value: (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)
          ? el.value
          : ('value' in resolvedEl ? resolvedEl.value : undefined),
        placeholder: el.getAttribute('placeholder') || resolvedEl.getAttribute('placeholder') || undefined,
        href: el.getAttribute('href') || undefined,
        checked: (el instanceof HTMLInputElement) ? el.checked : undefined,
        disabled: Boolean(el.disabled || el.getAttribute('disabled')),
        isEditable: checkIsEditable(el),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      };
    } catch (err) {
      return { ok: false, error: safeFormatError(err) };
    }
  };

  window.__agentRuntimeReady = true;
  return true;
})()`;

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
