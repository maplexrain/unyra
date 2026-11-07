/**
 * 运行时脚本·基础环境段（原 browserRuntimeScript.ts 第 12–328 行原样搬运）。
 *
 * 职责：IIFE 引导与 ready 幂等守卫；标签/噪声类常量集合；__agentNodeMap 节点缓存；
 * safeFormatError / isVisible / cleanText / getDeepText / getItemSummary 等通用工具；
 * 可编辑与可点击核心节点下钻解析（resolveEditableTarget / resolveClickableTarget）；
 * 统一可编辑判定 checkIsEditable 与节点描述符 getDescriptor；
 * Shadow DOM 与同源 iframe 递归穿透查询（deepQuerySelectorAll / deepQuerySelector）；
 * __findAgentNode 全域寻址。模板以 "(() => {" 开场，IIFE 由门面的收尾片段闭合。
 *
 * 纯搬运约定：片段内容与原文件对应行逐字节一致（含全部中文注释），由门面
 * src/learn/web/browserRuntimeScript.ts 按原拼接顺序组装，最终脚本不变。
 */

export const RUNTIME_CORE = `(() => {
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

  function getDeepText(el, maxDepth = 4, maxChars = Infinity) {
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
      if (maxChars < Infinity && text.length > maxChars) break;
    }
    return text;
  }

  function isProseContainer(el) {
    const pCount = el.querySelectorAll(':scope > p, :scope > div > p, :scope > pre, :scope > blockquote').length;
    return pCount >= 3;
  }

  function getItemSummary(el) {
    const rawText = getDeepText(el, 3, 200);
    const text = cleanText(rawText, 25);

    let title = el.getAttribute('title') || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
    if (!title && el.shadowRoot) {
      const innerInput = el.shadowRoot.querySelector('[placeholder], [aria-label]');
      if (innerInput) title = innerInput.getAttribute('placeholder') || innerInput.getAttribute('aria-label') || '';
    }

    if (/^\\d+$/.test(text) && !title) {
      const innerHtmlClasses = [el.className, ...[...el.querySelectorAll('[class]')].map(e => e.className)].join(' ');
      const match = innerHtmlClasses.match(/\\b(like|thumb|coin|fav|collect|star|share|forward|comment|reply|search|follow|watch)\\b/i);
      if (match) return match[1].toLowerCase() + ':' + text;
    }
    if (title && text && title !== text) return title + '(' + text + ')';
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
          linkAttr = '[href="' + cleanText(path, 35) + '"]';
        }
      }
    }

    let cls = '';
    if (el.classList && el.classList.length) {
      const bestClass = [...el.classList].find(c => c.length > 2 && c.length < 28 && !NOISY_CLASS.test(c));
      if (bestClass) cls = '.' + bestClass;
    }

    if (ACTION_TAGS.has(el.tagName) || isEditable) {
      const hint = getItemSummary(el);
      const roleTag = isEditable && !ACTION_TAGS.has(el.tagName) ? (tag + cls + '[editable]') : (tag + cls + linkAttr);
      return hint ? (roleTag + ' "' + hint + '"') : roleTag;
    }

    const id = (el.id && !GENERIC_IDS.has(el.id.toLowerCase())) ? ('#' + el.id) : '';
    if (id) cls = '';
    const summary = tag.includes('-') ? cleanText(getItemSummary(el), 25) : '';
    return tag + linkAttr + id + cls + (summary ? (' "' + summary + '"') : '');
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

    const selector = '[data-agent-id="' + numId + '"]';
    const found = deepQuerySelector(root, selector);
    if (found) {
      window.__agentNodeMap?.set(numId, found);
      return found;
    }
    return null;
  };
`;
