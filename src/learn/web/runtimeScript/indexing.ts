/**
 * 运行时脚本·语义索引与查询段（原 browserRuntimeScript.ts 第 329–557 行原样搬运）。
 *
 * 职责：__agentIndex 紧凑语义索引（正文区折叠、列表折叠保护、shadow 内交互控件编号）；
 * __agentQuery 全局多选匹配查询；__agentWaitFor 智能等待目标元素或文本出现；
 * __agentEval 在访客页面上下文中受控求值。
 *
 * 纯搬运约定：片段内容与原文件对应行逐字节一致（含全部中文注释），由门面
 * src/learn/web/browserRuntimeScript.ts 按原拼接顺序组装，最终脚本不变。
 */

export const RUNTIME_INDEXING = `
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
          const outline = headings.length ? (' | 提纲: ' + headings.join(' / ')) : '';
          lines.push(indent + '[' + id + '] ' + getDescriptor(el, false) + ' (正文区: 共' + totalChars + '字' + outline + ' -> "' + cleanText(el.innerText, 35) + '")');
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
              .map(s => '"' + s + '"')
              .join(', ');
            if (samples) {
              const id = mark(el);
              lines.push(indent + "[" + id + "] " + getDescriptor(el, false) + " [列表: 共" + children.length + "项 " + dominantTag.toLowerCase() + ", 示例: " + samples + " ...]");
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
          lines.push(indent + "[" + currentId + "] " + getDescriptor(el, isEditable));

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
      error: '等待超时 (' + timeoutMs + 'ms)：未能在页面中找到目标或文本 [' + queryTarget + ']',
    };
  };

  /** 在访客页面上下文中安全执行受控代码并返回 JSON */
  window.__agentEval = async function(code) {
    try {
      const trimmed = String(code || '').trim();
      const fnBody = trimmed.includes('return ') ? trimmed : ('return (' + trimmed + ');');
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
`;
