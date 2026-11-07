/**
 * 运行时脚本·受控交互段（原 browserRuntimeScript.ts 第 558–1049 行原样搬运）。
 *
 * 职责：__agentClick 真实用户级点击；__agentFill 受控填入（写入后自检比对防假阳性）；
 * __agentType 逐字符按键仿真与 IME 模拟输入；__agentPress 按键仿真；
 * __agentScroll 页面/容器滚动；__agentText 分页取文；__agentInspect 节点详情检查。
 *
 * 纯搬运约定：片段内容与原文件对应行逐字节一致（含全部中文注释），由门面
 * src/learn/web/browserRuntimeScript.ts 按原拼接顺序组装，最终脚本不变。
 */

export const RUNTIME_INTERACT = `
  window.__agentClick = function(target, opts = {}) {
    try {
      const el = window.__findAgentNode(target);
      if (!el) {
        const isSelector = typeof target === 'string' && isNaN(Number(target));
        return {
          ok: false,
          error: isSelector
            ? ('选择器未匹配到任何节点: "' + target + '"')
            : ('未找到节点编号 [' + target + ']（页面可能已刷新或 DOM 节点已移除，请重新执行 index()）'),
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

      const scrollEl = document.scrollingElement || document.documentElement || document.body;
      const getDocHeight = () => Math.max(
        document.body ? document.body.scrollHeight : 0,
        document.documentElement ? document.documentElement.scrollHeight : 0,
        scrollEl ? scrollEl.scrollHeight : 0
      );
      const getDocY = () => window.scrollY || (scrollEl ? scrollEl.scrollTop : 0) || 0;

      if (container === window) {
        const curY = getDocY();
        let targetY = curY;
        const totalHeight = getDocHeight();

        if (opts.to === 'top') targetY = 0;
        else if (opts.to === 'bottom') targetY = totalHeight;
        else if (typeof opts.by === 'number') targetY = curY + opts.by;

        // 同步即时滚动，避免 smooth 异步动画导致当场读出未滚动的虚假坐标
        const behavior = opts.smooth ? 'smooth' : 'auto';
        window.scrollTo({ top: targetY, behavior });
        if (scrollEl && !opts.smooth) {
          scrollEl.scrollTop = targetY;
        }

        const newDocY = getDocY();
        const updatedHeight = getDocHeight();
        const atBottom = window.innerHeight + newDocY >= updatedHeight - 20;

        return {
          ok: true,
          scrollY: newDocY,
          scrollHeight: updatedHeight,
          atBottom,
          documentScrollY: newDocY,
          documentScrollHeight: updatedHeight,
          documentAtBottom: atBottom,
        };
      } else {
        const el = container;
        if (opts.to === 'top') el.scrollTop = 0;
        else if (opts.to === 'bottom') el.scrollTop = el.scrollHeight;
        else if (typeof opts.by === 'number') el.scrollTop += opts.by;

        const containerAtBottom = el.clientHeight + el.scrollTop >= el.scrollHeight - 20;
        const currentDocY = getDocY();
        const currentDocHeight = getDocHeight();
        const docAtBottom = window.innerHeight + currentDocY >= currentDocHeight - 20;

        return {
          ok: true,
          scrollY: el.scrollTop,
          scrollHeight: el.scrollHeight,
          atBottom: containerAtBottom,
          containerScrollY: el.scrollTop,
          containerScrollHeight: el.scrollHeight,
          containerAtBottom,
          documentScrollY: currentDocY,
          documentScrollHeight: currentDocHeight,
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

      const deep = getDeepText(el, 16, Infinity);
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
          : ('未找到节点编号 [' + target + ']（页面可能已刷新或 DOM 节点已移除，请重新执行 index()）');
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
`;
