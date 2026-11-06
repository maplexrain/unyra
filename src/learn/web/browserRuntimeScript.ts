/**
 * 网页访客环境（Guest Page）内的轻量 Agent 运行时脚本构造器。
 * 
 * 核心机制：
 * 1. 深度穿透 Shadow DOM 与同源 iframe；
 * 2. 紧凑语义索引生成（保护布局容器不被折叠、为 shadow 内部所有交互组件编号、带 href 路径）；
 * 3. 基于 data-agent-id、内存 Map 与 Deep QuerySelector 的全域寻址（支持 >>> 与后代选择器）；
 * 4. 健壮的真实用户级受控动作（click / fill 带自检比对 / type / press / scroll / text / inspect / query / waitFor / eval）。
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
    return r.width > 0 && r.height > 0;
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
      if (text.length > 200) break;
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

    // Shadow Host 且直接承载输入节点（排除整体容器）
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
    let linkAttr = '';
    if (tag === 'a') {
      const rawHref = el.getAttribute('href') || '';
      if (rawHref) {
        let path = rawHref;
        try {
          if (rawHref.startsWith('http')) {
            const u = new URL(rawHref);
            path = u.pathname + u.search;
          }
        } catch {}
        if (path && path !== '/') {
          linkAttr = \`[href="\${cleanText(path, 35)}"]\`;
        }
      }
    }

    let cls = '';
    if (el.classList && el.classList.length) {
      const bestClass = [...el.classList].find(c => c.length > 2 && c.length < 28 && !NOISY_CLASS.test(c));
      if (bestClass) cls = \`.\${bestClass}\`;
    }

    if (ACTION_TAGS.has(el.tagName) || isEditable) {
      const hint = getItemSummary(el);
      const roleTag = isEditable && !ACTION_TAGS.has(el.tagName) ? \`\${tag}\${cls}[editable]\` : \`\${tag}\${cls}\${linkAttr}\`;
      return hint ? \`\${roleTag} "\${hint}"\` : roleTag;
    }

    const id = (el.id && !GENERIC_IDS.has(el.id.toLowerCase())) ? \`#\${el.id}\` : '';
    if (id) cls = '';
    const summary = tag.includes('-') ? cleanText(getItemSummary(el), 25) : '';
    return \`\${tag}\${linkAttr}\${id}\${cls}\${summary ? \` "\${summary}"\` : ''}\`;
  }

  function getEffectiveChildren(el) {
    const raw = [];
    if (el.shadowRoot) raw.push(...el.shadowRoot.children);
    raw.push(...el.children);
    return raw.filter(c => c.nodeType === 1 && !IGNORE_TAGS.has(c.tagName) && isVisible(c));
  }

  /** 递归穿透所有 ShadowRoot 与同源 iframe 的多项选择器查找（支持 >>>、::shadow 与空格后代） */
  function deepQuerySelectorAll(root, selector, maxCount = 50) {
    if (!root || !selector) return [];
    const results = [];

    // 1. 处理 Pierce 组合符 >>> 或 ::shadow
    if (selector.includes('>>>') || selector.includes('::shadow')) {
      const parts = selector.split(/\\s*>>>\\s*|\\s*::shadow\\s*/);
      let currentRoots = [root];
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (!part) continue;
        const isLast = i === parts.length - 1;
        const nextRoots = [];
        for (const cur of currentRoots) {
          const curRoot = cur.shadowRoot || cur;
          const found = deepQuerySelectorAll(curRoot, part, isLast ? maxCount : 50);
          if (isLast) {
            results.push(...found);
            if (results.length >= maxCount) return results.slice(0, maxCount);
          } else {
            for (const el of found) {
              if (el.shadowRoot) nextRoots.push(el.shadowRoot);
              nextRoots.push(el);
            }
          }
        }
        currentRoots = nextRoots;
      }
      return results.slice(0, maxCount);
    }

    // 2. 本地原生 querySelectorAll 匹配
    try {
      const direct = root.querySelectorAll(selector);
      for (const d of direct) {
        results.push(d);
        if (results.length >= maxCount) return results;
      }
    } catch {}

    // 3. 处理带空格的后代组合器跨 Shadow 下钻（如 "bili-comment-box .brt-btn"）
    if (selector.includes(' ')) {
      const segments = selector.split(/\\s+/).filter(Boolean);
      if (segments.length >= 2) {
        const firstSegment = segments[0];
        const restSelector = segments.slice(1).join(' ');
        const firstMatches = deepQuerySelectorAll(root, firstSegment, 20);
        for (const fm of firstMatches) {
          const subRoot = fm.shadowRoot || fm;
          const subMatches = deepQuerySelectorAll(subRoot, restSelector, maxCount - results.length);
          for (const sm of subMatches) {
            if (!results.includes(sm)) results.push(sm);
            if (results.length >= maxCount) return results;
          }
        }
      }
    }

    // 4. 递归下钻所有 ShadowRoot 与同源 iframe
    const all = root.querySelectorAll('*');
    for (const el of all) {
      if (el.shadowRoot) {
        const sub = deepQuerySelectorAll(el.shadowRoot, selector, maxCount - results.length);
        for (const s of sub) {
          if (!results.includes(s)) results.push(s);
          if (results.length >= maxCount) return results;
        }
      }
      if (el.tagName === 'IFRAME') {
        try {
          if (el.contentDocument) {
            const sub = deepQuerySelectorAll(el.contentDocument, selector, maxCount - results.length);
            for (const s of sub) {
              if (!results.includes(s)) results.push(s);
              if (results.length >= maxCount) return results;
            }
          }
        } catch {}
      }
    }

    return results;
  }

  function deepQuerySelector(root, selector) {
    const list = deepQuerySelectorAll(root, selector, 1);
    return list.length ? list[0] : null;
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

  window.__agentIndex = function(focusTargetOrOpts, maybeOpts) {
    try {
      window.__agentNodeMap.clear();
      const lines = [];
      let nodeId = 1;

      let focusTarget = undefined;
      let opts = {};
      if (focusTargetOrOpts && typeof focusTargetOrOpts === 'object') {
        opts = focusTargetOrOpts;
        focusTarget = opts.focus ?? opts.target;
      } else {
        focusTarget = focusTargetOrOpts;
        opts = maybeOpts || {};
      }

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

        if (opts.collapse !== false && !opts.full && isProseContainer(el)) {
          const id = mark(el);
          const totalChars = (el.innerText || '').replace(/\\s+/g, '').length;
          const headings = [...el.querySelectorAll('h1, h2, h3, h4')].map(h => cleanText(h.innerText, 15)).slice(0, 6);
          const outline = headings.length ? \` | 提纲: \${headings.join(' / ')}\` : '';
          lines.push(\`\${indent}[\${id}] \${getDescriptor(el, false)} (正文区: 共\${totalChars}字\${outline} -> "\${cleanText(el.innerText, 35)}")\`);
          return;
        }

        const children = getEffectiveChildren(el);

        // 列表折叠保护：绝不折叠 DIV、SPAN、SECTION 等主要布局容器
        if (opts.collapse !== false && !opts.full && children.length >= 3) {
          const tagCounts = {};
          children.forEach(c => tagCounts[c.tagName] = (tagCounts[c.tagName] || 0) + 1);
          const [dominantTag, count] = Object.entries(tagCounts).sort((a, b) => b[1] - a[1])[0];
          const isListableTag = dominantTag.includes('-') || ['LI', 'TR'].includes(dominantTag);

          if (isListableTag && (count >= 3 && count / children.length >= 0.7)) {
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
          if (isAction && !getItemSummary(el) && !el.shadowRoot) return;

          const lineIndexBefore = lines.length;
          const currentId = mark(el);
          lines.push(\`\${indent}[\${currentId}] \${getDescriptor(el, isEditable)}\`);

          // 核心机制：如果带有 shadowRoot，绝不因 isAction 提前返回，必须深入给内部可交互控件分配 id
          if (isAction && !el.shadowRoot) return;

          for (const child of children) {
            walk(child, depth + 1);
          }

          if (lines.length === lineIndexBefore + 1 && !cleanText(getDeepText(el, 2)) && !isAction) {
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
        lines,
      };
    } catch (err) {
      return {
        text: '',
        count: 0,
        title: document.title || '',
        url: window.location.href,
        lines: [],
        error: safeFormatError(err),
      };
    }
  };

  /** 全局多选匹配查询（返回匹配候选数组，自动分配 id） */
  window.__agentQuery = function(selector, opts = {}) {
    try {
      const limit = typeof opts.limit === 'number' ? opts.limit : 20;
      const elements = deepQuerySelectorAll(document, selector, limit);
      const matches = elements.map(el => {
        let id = Number(el.getAttribute('data-agent-id'));
        if (!id || isNaN(id)) {
          id = window.__agentNodeMap.size + 1;
          while (window.__agentNodeMap.has(id)) id++;
          el.setAttribute('data-agent-id', id);
          window.__agentNodeMap.set(id, el);
        }
        const rect = el.getBoundingClientRect();
        const isVis = isVisible(el) && rect.width > 0 && rect.height > 0;
        return {
          id,
          tag: el.tagName.toLowerCase(),
          cls: el.className ? String(el.className) : undefined,
          idAttr: el.id || undefined,
          text: cleanText(getDeepText(el, 3), 60),
          href: el.getAttribute('href') || undefined,
          value: ('value' in el && typeof el.value === 'string') ? el.value : undefined,
          placeholder: el.getAttribute('placeholder') || undefined,
          visible: isVis,
          isEditable: checkIsEditable(el),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        };
      });
      return {
        ok: true,
        selector,
        count: matches.length,
        matches,
      };
    } catch (err) {
      return { ok: false, selector, count: 0, matches: [], error: safeFormatError(err) };
    }
  };

  /** 智能等待目标元素或文本出现 */
  window.__agentWaitFor = async function(targetOrText, opts = {}) {
    const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : (typeof opts.timeout === 'number' ? opts.timeout : 5000);
    const startTime = Date.now();
    const queryTarget = String(targetOrText);

    while (Date.now() - startTime < timeoutMs) {
      const node = window.__findAgentNode(queryTarget);
      if (node) {
        const rect = node.getBoundingClientRect();
        const isVis = isVisible(node) && rect.width > 0 && rect.height > 0;
        if (opts.visible !== true || isVis) {
          let id = Number(node.getAttribute('data-agent-id'));
          if (!id || isNaN(id)) {
            id = window.__agentNodeMap.size + 1;
            while (window.__agentNodeMap.has(id)) id++;
            node.setAttribute('data-agent-id', id);
            window.__agentNodeMap.set(id, node);
          }
          return {
            ok: true,
            elapsedMs: Date.now() - startTime,
            id,
            tag: node.tagName.toLowerCase(),
            visible: isVis,
          };
        }
      }

      const bodyText = document.body ? getDeepText(document.body, 5) : '';
      if (bodyText.includes(queryTarget)) {
        return {
          ok: true,
          elapsedMs: Date.now() - startTime,
        };
      }

      await new Promise(r => setTimeout(r, 100));
    }

    return {
      ok: false,
      elapsedMs: Date.now() - startTime,
      error: \`等待超时 (\${timeoutMs}ms)：未能在页面中找到目标或文本 [\${queryTarget}]\`,
    };
  };

  /** 在访客页面上下文中安全执行受控代码并返回 JSON */
  window.__agentEval = async function(code) {
    try {
      const trimmed = String(code || '').trim();
      const fnBody = trimmed.includes('return ') ? trimmed : \`return (\${trimmed});\`;
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      const fn = new AsyncFunction('document', 'window', fnBody);
      const res = await fn(document, window);
      return {
        ok: true,
        result: res !== undefined ? JSON.parse(JSON.stringify(res)) : undefined,
      };
    } catch (err) {
      return {
        ok: false,
        error: safeFormatError(err),
      };
    }
  };

  window.__agentClick = function(target, opts = {}) {
    try {
      const el = window.__findAgentNode(target);
      if (!el) {
        const isSelector = typeof target === 'string' && isNaN(Number(target));
        return {
          ok: false,
          error: isSelector
            ? \`选择器未匹配到任何节点: "\${target}"\`
            : \`未找到节点编号 [\${target}]（页面可能已刷新或 DOM 节点已移除，请重新执行 index()）\`,
        };
      }

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

      const isVis = isVisible(resolvedEl) && rect.width > 0 && rect.height > 0;
      return {
        ok: true,
        tag: el.tagName.toLowerCase(),
        resolvedTag: resolvedEl.tagName.toLowerCase(),
        visible: isVis,
        warning: !isVis ? '节点尺寸为 0x0 或处于隐藏状态，点击可能未产生页面交互' : undefined,
      };
    } catch (err) {
      return { ok: false, error: safeFormatError(err) };
    }
  };

  window.__agentFill = function(target, text, opts = {}) {
    try {
      const el = window.__findAgentNode(target);
      if (!el) {
        const isSelector = typeof target === 'string' && isNaN(Number(target));
        return {
          ok: false,
          error: isSelector
            ? \`选择器未匹配到任何节点: "\${target}"\`
            : \`未找到节点编号 [\${target}]（页面可能已刷新或 DOM 节点已移除，请重新执行 index()）\`,
        };
      }

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

      // 写入后自检比对（Readback），彻底防止假阳性
      const readbackVal = (isNativeInput ? resolvedEl.value : (resolvedEl.innerText || resolvedEl.textContent || '')).trim();
      const expectedSnippet = val.trim().slice(0, 15);
      if (expectedSnippet.length > 0 && !readbackVal.includes(expectedSnippet)) {
        return {
          ok: false,
          tag: el.tagName.toLowerCase(),
          resolvedTag: resolvedEl.tagName.toLowerCase(),
          wrote: 0,
          readback: readbackVal.slice(0, 50),
          hint: '文本未能成功写入目标编辑器（常因框架拦截合成事件导致），请改用 api.browser.type(target, text)',
        };
      }

      return {
        ok: true,
        tag: el.tagName.toLowerCase(),
        resolvedTag: resolvedEl.tagName.toLowerCase(),
        resolvedType,
        wrote: val.length,
        readback: readbackVal.slice(0, 80),
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

      return {
        ok: true,
        key: keyName,
        dispatched: true,
        warning: '若页面依赖 isTrusted 原生快捷键，合成事件可能被忽略；若未生效建议优先调用 api.browser.click() 点击按钮',
      };
    } catch (err) {
      return { ok: false, error: safeFormatError(err) };
    }
  };

  window.__agentScroll = function(opts = {}) {
    try {
      const container = opts.target ? window.__findAgentNode(opts.target) : window;
      if (opts.target && !container) return { ok: false, error: '未找到滚动目标节点' };

      const docScrollHeight = document.body ? document.body.scrollHeight : 0;
      const docScrollY = window.scrollY || 0;
      const docAtBottom = window.innerHeight + docScrollY >= docScrollHeight - 50;

      if (container === window) {
        if (opts.to === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
        else if (opts.to === 'bottom') window.scrollTo({ top: docScrollHeight, behavior: 'smooth' });
        else if (typeof opts.by === 'number') window.scrollBy({ top: opts.by, behavior: 'smooth' });

        const newDocY = window.scrollY || 0;
        return {
          ok: true,
          scrollY: newDocY,
          scrollHeight: docScrollHeight,
          atBottom: window.innerHeight + newDocY >= docScrollHeight - 50,
          documentScrollY: newDocY,
          documentScrollHeight: docScrollHeight,
          documentAtBottom: window.innerHeight + newDocY >= docScrollHeight - 50,
        };
      } else {
        const el = container;
        if (opts.to === 'top') el.scrollTop = 0;
        else if (opts.to === 'bottom') el.scrollTop = el.scrollHeight;
        else if (typeof opts.by === 'number') el.scrollTop += opts.by;

        const containerAtBottom = el.clientHeight + el.scrollTop >= el.scrollHeight - 50;
        return {
          ok: true,
          scrollY: el.scrollTop,
          scrollHeight: el.scrollHeight,
          atBottom: containerAtBottom,
          containerScrollY: el.scrollTop,
          containerScrollHeight: el.scrollHeight,
          containerAtBottom,
          documentScrollY: docScrollY,
          documentScrollHeight: docScrollHeight,
          documentAtBottom: docAtBottom,
        };
      }
    } catch (err) {
      return { ok: false, error: safeFormatError(err) };
    }
  };

  window.__agentText = function(target, opts = {}) {
    try {
      const el = window.__findAgentNode(target);
      if (!el) {
        const isSelector = typeof target === 'string' && isNaN(Number(target));
        return {
          ok: false,
          error: isSelector
            ? \`选择器未匹配到任何节点: "\${target}"\`
            : \`未找到节点编号 [\${target}]（页面可能已刷新或 DOM 节点已移除，请重新执行 index()）\`,
        };
      }

      const deep = getDeepText(el, 8);
      const fullText = (deep || el.innerText || el.textContent || '').trim();
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

  window.__agentInspect = function(target, opts = {}) {
    try {
      let el = null;
      let matchCount = 1;
      if (typeof target === 'string' && isNaN(Number(target))) {
        const list = deepQuerySelectorAll(document, target, 50);
        matchCount = list.length;
        const idx = typeof opts.nth === 'number' ? opts.nth : 0;
        el = list[idx] || null;
      } else {
        el = window.__findAgentNode(target);
      }

      if (!el) {
        const isSelector = typeof target === 'string' && isNaN(Number(target));
        const errorMsg = isSelector
          ? \`选择器未匹配到任何节点: "\${target}"\`
          : \`未找到节点编号 [\${target}]（页面可能已刷新或 DOM 节点已移除，请重新执行 index()）\`;
        return { ok: false, error: errorMsg };
      }

      const resolvedEl = resolveEditableTarget(el);
      const rect = el.getBoundingClientRect();
      const isVis = isVisible(el) && rect.width > 0 && rect.height > 0;
      const textVal = cleanText(getDeepText(el, 4), 500);

      return {
        ok: true,
        id: target,
        matchCount,
        tag: el.tagName.toLowerCase(),
        resolvedTag: resolvedEl !== el ? resolvedEl.tagName.toLowerCase() : undefined,
        idAttr: el.id || undefined,
        className: el.className || undefined,
        text: textVal,
        value: (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)
          ? el.value
          : ('value' in resolvedEl ? resolvedEl.value : (resolvedEl.innerText || undefined)),
        placeholder: el.getAttribute('placeholder') || resolvedEl.getAttribute('placeholder') || undefined,
        href: el.getAttribute('href') || undefined,
        checked: (el instanceof HTMLInputElement) ? el.checked : undefined,
        disabled: Boolean(el.disabled || el.getAttribute('disabled')),
        visible: isVis,
        warning: !isVis ? '节点尺寸为 0x0 或不可见，对其执行点击可能无效' : undefined,
        isEditable: checkIsEditable(el),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      };
    } catch (err) {
      return { ok: false, error: safeFormatError(err) };
    }
  };

  window.__captureTokens = window.__captureTokens || new Map();

  window.__agentPrepareElementCapture = function(target, opts = {}) {
    try {
      const el = window.__findAgentNode(target);
      if (!el) {
        return { ok: false, error: '未找到目标 DOM 元素: ' + target };
      }

      // 1. 如果是原生 CANVAS，直接提取最高清无损数据
      if (el instanceof HTMLCanvasElement || el.tagName === 'CANVAS') {
        try {
          const dataUrl = el.toDataURL('image/png');
          return {
            ok: true,
            directDataUrl: dataUrl,
            tag: 'canvas',
            totalWidth: el.width || 300,
            totalHeight: el.height || 150,
            slices: 1,
          };
        } catch (e) {
          // 跨域污染画布继续走普通截图
        }
      }

      const isolate = opts.isolate !== false;
      const full = opts.full !== false;
      const padding = typeof opts.padding === 'number' ? Math.max(0, opts.padding) : 0;
      const maxHeight = typeof opts.maxHeight === 'number' ? Math.max(100, opts.maxHeight) : 16000;

      const restoreFns = [];
      const prevScrollX = window.scrollX || window.pageXOffset || 0;
      const prevScrollY = window.scrollY || window.pageYOffset || 0;

      // 2. 消除遮挡（Anti-Occlusion Isolation）
      if (isolate) {
        const ancestors = new Set();
        let curr = el;
        while (curr && curr !== document && curr !== document.documentElement) {
          ancestors.add(curr);
          curr = curr.parentElement || (curr.getRootNode && curr.getRootNode().host);
        }

        // 隐藏所有不在当前元素祖先链路上的 position: fixed / sticky 元素（如吸顶导航、悬浮球、遮罩层）
        const allNodes = document.querySelectorAll('*');
        for (const node of allNodes) {
          if (ancestors.has(node) || el.contains(node)) continue;
          try {
            const cs = window.getComputedStyle(node);
            if (cs.position === 'fixed' || cs.position === 'sticky') {
              const prev = node.style.visibility;
              node.style.visibility = 'hidden';
              restoreFns.push(() => { node.style.visibility = prev; });
            }
          } catch (e) {}
        }

        // 采样命中遮挡物：针对盖在当前元素上方的悬浮弹窗、蒙层
        try {
          const b = el.getBoundingClientRect();
          if (b.width > 0 && b.height > 0) {
            const pts = [
              { x: b.left + b.width * 0.5, y: b.top + b.height * 0.5 },
              { x: b.left + 8, y: b.top + 8 },
              { x: b.right - 8, y: b.top + 8 },
              { x: b.left + 8, y: b.bottom - 8 },
              { x: b.right - 8, y: b.bottom - 8 },
              { x: b.left + b.width * 0.5, y: b.top + 16 },
              { x: b.left + b.width * 0.5, y: b.bottom - 16 },
            ];
            for (const p of pts) {
              if (p.x < 0 || p.y < 0 || p.x > window.innerWidth || p.y > window.innerHeight) continue;
              const stack = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(p.x, p.y) : [];
              for (const top of stack) {
                if (!ancestors.has(top) && !el.contains(top) && top !== document.documentElement && top !== document.body) {
                  const prev = top.style.visibility;
                  top.style.visibility = 'hidden';
                  restoreFns.push(() => { top.style.visibility = prev; });
                }
              }
            }
          }
        } catch (e) {}
      }

      // 3. 文章/长内容解除折叠与展开（如 max-height 折叠与阅读更多遮罩）
      if (full) {
        if (el.style && el.style.maxHeight && el.style.maxHeight !== 'none') {
          const prev = el.style.maxHeight;
          el.style.maxHeight = 'none';
          restoreFns.push(() => { el.style.maxHeight = prev; });
        }
        if (el.style && el.style.overflow && el.style.overflow !== 'visible') {
          const prev = el.style.overflow;
          el.style.overflow = 'visible';
          restoreFns.push(() => { el.style.overflow = prev; });
        }
        // 展开内部常见的折叠限高与渐变遮罩
        try {
          const foldNodes = el.querySelectorAll('[style*="max-height"], [style*="maxHeight"], .collapse, .collapsed, .fold');
          for (const fn of foldNodes) {
            if (fn.style && fn.style.maxHeight && fn.style.maxHeight !== 'none') {
              const prev = fn.style.maxHeight;
              fn.style.maxHeight = 'none';
              restoreFns.push(() => { fn.style.maxHeight = prev; });
            }
          }
        } catch (e) {}
      }

      // 4. 计算元素在文档全局的绝对坐标与尺寸
      const rect = el.getBoundingClientRect();
      const docLeft = Math.max(0, Math.floor(rect.left + (window.scrollX || window.pageXOffset || 0)));
      const docTop = Math.max(0, Math.floor(rect.top + (window.scrollY || window.pageYOffset || 0)));
      const totalWidth = Math.ceil(el.offsetWidth || rect.width || el.scrollWidth || 300);
      const measuredHeight = Math.ceil(Math.max(el.offsetHeight || 0, el.scrollHeight || 0, rect.height || 0));
      const totalHeight = Math.min(maxHeight, Math.max(1, measuredHeight));

      const token = 'cap_' + Math.random().toString(36).slice(2) + Date.now();
      const session = {
        token,
        el,
        docLeft,
        docTop,
        totalWidth,
        totalHeight,
        padding,
        full,
        prevScrollX,
        prevScrollY,
        restoreFns,
        viewportW: window.innerWidth || 1280,
        viewportH: window.innerHeight || 800,
      };
      window.__captureTokens.set(token, session);

      return {
        ok: true,
        token,
        docLeft,
        docTop,
        totalWidth,
        totalHeight,
        padding,
        full,
        viewportW: session.viewportW,
        viewportH: session.viewportH,
        tag: el.tagName.toLowerCase(),
        className: el.className || undefined,
      };
    } catch (err) {
      return { ok: false, error: safeFormatError(err) };
    }
  };

  window.__agentGetCaptureSlice = function(token, offsetY) {
    try {
      const session = window.__captureTokens?.get(token);
      if (!session) return { ok: false, error: '截图会话已失效或未找到 token' };

      const { el, docLeft, docTop, totalWidth, totalHeight, padding, viewportW, viewportH } = session;
      const targetY = docTop + offsetY;

      // 视口精准定位到当前切片
      window.scrollTo({ left: docLeft, top: targetY, behavior: 'instant' });

      // 计算当前元素在视口中的可见矩形
      const r = el.getBoundingClientRect();
      const clipX = Math.max(0, Math.floor(r.left - padding));
      const clipY = Math.max(0, Math.floor(r.top));
      const clipW = Math.min(viewportW - clipX, Math.ceil(totalWidth + padding * 2));
      const remainingH = totalHeight - offsetY;
      const clipH = Math.min(viewportH - clipY, Math.ceil(remainingH));

      return {
        ok: true,
        rect: {
          x: Math.max(0, clipX),
          y: Math.max(0, clipY),
          width: Math.max(1, clipW),
          height: Math.max(1, clipH),
        },
        offsetY,
        done: (offsetY + clipH >= totalHeight) || clipH <= 0,
      };
    } catch (err) {
      return { ok: false, error: safeFormatError(err) };
    }
  };

  window.__agentCleanupElementCapture = function(token) {
    try {
      const session = window.__captureTokens?.get(token);
      if (!session) return { ok: true };
      try {
        if (Array.isArray(session.restoreFns)) {
          for (const fn of session.restoreFns) {
            try { fn(); } catch (e) {}
          }
        }
        window.scrollTo({ left: session.prevScrollX, top: session.prevScrollY, behavior: 'instant' });
      } finally {
        window.__captureTokens.delete(token);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: safeFormatError(err) };
    }
  };

  window.__agentElementToImage = function(target, opts = {}) {
    try {
      const prep = window.__agentPrepareElementCapture(target, opts);
      if (!prep.ok) return prep;
      if (prep.directDataUrl) {
        return { ok: true, dataUrl: prep.directDataUrl, width: prep.totalWidth, height: prep.totalHeight, tag: prep.tag };
      }
      // 纯页面内 SVG foreignObject 快照兜底（用于测试或轻量无头提取）
      const el = window.__captureTokens?.get(prep.token)?.el || window.__findAgentNode(target);
      if (el) {
        try {
          const clone = el.cloneNode(true);
          const xml = new XMLSerializer().serializeToString(clone);
          const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + prep.totalWidth + '" height="' + prep.totalHeight + '">' +
            '<foreignObject width="100%" height="100%">' +
            '<div xmlns="http://www.w3.org/1999/xhtml">' + xml + '</div>' +
            '</foreignObject></svg>';
          const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
          window.__agentCleanupElementCapture(prep.token);
          return { ok: true, dataUrl, width: prep.totalWidth, height: prep.totalHeight, tag: prep.tag };
        } catch (e) {}
      }
      window.__agentCleanupElementCapture(prep.token);
      return { ok: true, width: prep.totalWidth, height: prep.totalHeight, tag: prep.tag };
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
