/**
 * 运行时脚本·Markdown 转换段（原 browserRuntimeScript.ts 第 1290–1566 行原样搬运）。
 *
 * 职责：__agentToMarkdown 将 DOM（含 shadow 与 iframe 内容）转换为 Markdown：
 * 图片懒加载提升、KaTeX/MathJax 公式、代码块、表格、列表、引用与行内样式映射。
 *
 * 纯搬运约定：片段内容与原文件对应行逐字节一致（含全部中文注释），由门面
 * src/learn/web/browserRuntimeScript.ts 按原拼接顺序组装，最终脚本不变。
 */

export const RUNTIME_MARKDOWN = `
window.__agentToMarkdown = function(target, opts = {}) {
    try {
      let root = target !== undefined && target !== null ? window.__findAgentNode(target) : null;
      if (!root) {
        root = document.querySelector('article') || document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
      }
      if (!root) {
        return { ok: false, error: '未找到可转换的 DOM 元素' };
      }

      // A1: 转换前主动触发图片懒加载提升与 loading=eager
      try {
        const imgs = root.querySelectorAll('img');
        for (const img of imgs) {
          const lazySrc = img.getAttribute('data-src') ||
                          img.getAttribute('data-original') ||
                          img.getAttribute('data-actualsrc') ||
                          img.getAttribute('data-url') ||
                          img.getAttribute('data-origin-src') ||
                          img.getAttribute('data-lazy-src') ||
                          img.getAttribute('data-echo') ||
                          img.getAttribute('data-original-src');
          if (lazySrc && (!img.src || img.src.startsWith('data:') || img.src.includes('placeholder'))) {
            img.src = lazySrc;
          }
          if (img.loading !== 'eager') {
            img.loading = 'eager';
          }
        }
      } catch (e) {}

      const diagnostics = {
        images: 0,
        headings: 0,
        paragraphs: 0,
        codeBlocks: 0,
      };

      function resolveUrl(url) {
        if (!url || typeof url !== 'string') return '';
        if (url.startsWith('data:') || url.startsWith('blob:')) return url;
        try {
          return new URL(url, window.location.href).href;
        } catch (e) {
          return url;
        }
      }

      function renderChildren(el, depth) {
        let res = '';
        if (el.shadowRoot) {
          for (const child of el.shadowRoot.childNodes) {
            res += nodeToMd(child, depth + 1);
          }
        }
        for (const child of el.childNodes) {
          res += nodeToMd(child, depth + 1);
        }
        return res;
      }

      const BT = String.fromCharCode(96);
      const TRIPLE_BT = BT + BT + BT;
      const NL = String.fromCharCode(10);
      const DNL = NL + NL;

      function nodeToMd(node, depth = 0) {
        if (depth > 40) return '';
        if (node.nodeType === Node.TEXT_NODE) {
          return node.textContent || '';
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return '';

        const el = node;
        const tag = el.tagName.toUpperCase();

        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'TEMPLATE', 'META', 'LINK', 'CANVAS', 'IFRAME'].includes(tag)) {
          return '';
        }

        if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
          return '';
        }

        const texAttr = el.getAttribute('data-tex') || el.getAttribute('data-latex') || el.getAttribute('alt');
        if (el.classList.contains('katex') || el.classList.contains('MathJax') || tag === 'MATH') {
          const annot = el.querySelector('annotation[encoding*="tex"]');
          const mathSrc = annot ? annot.textContent.trim() : (texAttr || el.innerText || '').trim();
          if (mathSrc) {
            const isBlock = el.classList.contains('katex-display') || el.getAttribute('display') === 'block' || tag === 'MATH';
            return isBlock ? (DNL + '$$' + mathSrc + '$$' + DNL) : ('$' + mathSrc + '$');
          }
        }

        switch (tag) {
          case 'H1':
            diagnostics.headings++;
            return DNL + '# ' + renderChildren(el, depth).trim() + DNL;
          case 'H2':
            diagnostics.headings++;
            return DNL + '## ' + renderChildren(el, depth).trim() + DNL;
          case 'H3':
            diagnostics.headings++;
            return DNL + '### ' + renderChildren(el, depth).trim() + DNL;
          case 'H4':
            diagnostics.headings++;
            return DNL + '#### ' + renderChildren(el, depth).trim() + DNL;
          case 'H5':
            diagnostics.headings++;
            return DNL + '##### ' + renderChildren(el, depth).trim() + DNL;
          case 'H6':
            diagnostics.headings++;
            return DNL + '###### ' + renderChildren(el, depth).trim() + DNL;

          case 'P':
            diagnostics.paragraphs++;
            return DNL + renderChildren(el, depth).trim() + DNL;

          case 'BR':
            return NL;

          case 'HR':
            return DNL + '---' + DNL;

          case 'B':
          case 'STRONG': {
            const t = renderChildren(el, depth).trim();
            return t ? ('**' + t + '**') : '';
          }

          case 'I':
          case 'EM': {
            const t = renderChildren(el, depth).trim();
            return t ? ('*' + t + '*') : '';
          }

          case 'DEL':
          case 'S':
          case 'STRIKE': {
            const t = renderChildren(el, depth).trim();
            return t ? ('~~' + t + '~~') : '';
          }

          case 'PRE': {
            diagnostics.codeBlocks++;
            const codeEl = el.querySelector('code');
            const codeText = codeEl ? codeEl.textContent : el.textContent;
            let lang = '';
            const cls = (codeEl ? codeEl.className : '') + ' ' + el.className;
            const langMatch = cls.match(/(?:lang|language)-([a-zA-Z0-9_-]+)/i);
            if (langMatch) lang = langMatch[1];
            return DNL + TRIPLE_BT + lang + NL + (codeText || '').trimEnd() + NL + TRIPLE_BT + DNL;
          }

          case 'CODE': {
            if (el.parentElement && el.parentElement.tagName === 'PRE') {
              return el.textContent || '';
            }
            const c = el.textContent || '';
            return c ? (BT + c + BT) : '';
          }

          case 'BLOCKQUOTE': {
            const inner = renderChildren(el, depth).trim();
            const quoted = inner.split(NL).map(l => '> ' + l).join(NL);
            return DNL + quoted + DNL;
          }

          case 'A': {
            const text = renderChildren(el, depth).trim();
            const href = resolveUrl(el.getAttribute('href') || el.href || '');
            if (!href) return text;
            return '[' + (text || href) + '](' + href + ')';
          }

          case 'IMG': {
            const alt = (el.alt || el.getAttribute('aria-label') || el.title || '').trim();
            const rawSrc = el.getAttribute('data-src') ||
                           el.getAttribute('data-original') ||
                           el.getAttribute('data-actualsrc') ||
                           el.getAttribute('data-url') ||
                           el.getAttribute('data-origin-src') ||
                           el.getAttribute('data-lazy-src') ||
                           el.currentSrc ||
                           el.src ||
                           '';
            const src = resolveUrl(rawSrc);

            // A2: 对「行内代码/公式被渲染成图片」的启发式处理
            if (alt && (/mathjax|tex\b|\bformula\b|latex|equation/i.test(src) || el.classList.contains('math') || el.classList.contains('tex'))) {
              const isCode = /^[a-zA-Z_$][a-zA-Z0-9_$]*\(.*\)$/.test(alt) || /^[a-zA-Z0-9_$.-]+$/.test(alt);
              if (isCode) {
                return ' ' + BT + alt + BT + ' ';
              }
              return ' $' + alt + '$ ';
            }

            if (!src) return '';
            diagnostics.images++;
            return DNL + '![' + alt + '](' + src + ')' + DNL;
          }

          case 'UL':
          case 'OL': {
            let out = DNL;
            const isOrdered = tag === 'OL';
            let index = 1;
            for (const child of el.children) {
              if (child.tagName === 'LI') {
                const prefix = isOrdered ? (index++ + '. ') : '- ';
                const liText = renderChildren(child, depth).trim();
                out += prefix + liText.split(NL).join(NL + '  ') + NL;
              }
            }
            return out + NL;
          }

          case 'TABLE': {
            const rows = Array.from(el.querySelectorAll('tr'));
            if (!rows.length) return '';
            let mdTable = DNL;
            let colCount = 0;

            rows.forEach((tr, rIdx) => {
              const cells = Array.from(tr.querySelectorAll('th, td'));
              if (!cells.length) return;
              if (rIdx === 0) colCount = cells.length;
              const rowContent = '| ' + cells.map(c => renderChildren(c, depth).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()).join(' | ') + ' |' + NL;
              mdTable += rowContent;

              if (rIdx === 0) {
                mdTable += '| ' + Array(colCount).fill('---').join(' | ') + ' |' + NL;
              }
            });
            return mdTable + NL;
          }

          default: {
            // 支持双图卡片或包含 background-image 的图片容器（如 .opus-para-pic）
            if (el.classList && el.classList.contains('opus-para-pic') && !el.querySelector('img')) {
              const bg = el.style && el.style.backgroundImage ? el.style.backgroundImage : '';
              const bgMatch = bg.match(/url\(['"]?(.*?)['"]?\)/);
              if (bgMatch && bgMatch[1]) {
                const src = resolveUrl(bgMatch[1]);
                if (src) {
                  diagnostics.images++;
                  const alt = (el.getAttribute('aria-label') || el.title || '').trim();
                  return DNL + '![' + alt + '](' + src + ')' + DNL;
                }
              }
            }
            return renderChildren(el, depth);
          }
        }
      }

      let markdown = nodeToMd(root, 0);
      markdown = markdown
        .split(NL)
        .map(l => l.trimEnd())
        .join(NL)
        .replace(new RegExp(NL + '{3,}', 'g'), DNL)
        .trim();

      const lines = markdown ? markdown.split(NL).length : 0;
      return {
        ok: true,
        markdown,
        chars: markdown.length,
        lines,
        diagnostics,
      };
    } catch (err) {
      return { ok: false, error: safeFormatError(err) };
    }
  };
`;
