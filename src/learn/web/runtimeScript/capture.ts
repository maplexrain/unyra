/**
 * 运行时脚本·元素截图分片段（原 browserRuntimeScript.ts 第 1050–1289 行原样搬运）。
 *
 * 职责：__captureTokens 截图会话表；__agentPrepareElementCapture 防遮挡隔离与折叠展开；
 * __agentGetCaptureSlice 视口分片定位；__agentCleanupElementCapture 现场恢复；
 * __agentElementToImage 元素转图片（canvas 直提与 SVG foreignObject 兜底）。
 *
 * 纯搬运约定：片段内容与原文件对应行逐字节一致（含全部中文注释），由门面
 * src/learn/web/browserRuntimeScript.ts 按原拼接顺序组装，最终脚本不变。
 */

export const RUNTIME_CAPTURE = `
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
`;
