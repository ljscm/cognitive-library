/* eslint-env browser */
/**
 * cognitive-library — main-panel reader.
 *
 * Left: categories and entries from /api/cognitive-library/index.
 * Right: the selected entry, rendered from markdown returned by
 * /api/cognitive-library/entry.
 *
 * Registered into `sidebar.panellist` (entry button) and `main` (the page).
 * Both use the same id, so clicking the button switches the main panel.
 */

window.__ModuleLoader__.load({
  id: 'dsh-cognitive-library',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useMemo } = React;

    const PANEL_ID = 'cognitive-library';
    const PANEL_ORDER = 35;

    const T = {
      text: 'var(--dsw-alias-text-primary, #1f2328)',
      muted: 'var(--dsw-alias-text-secondary, #6b7280)',
      border: 'var(--dsw-alias-border-subtle, #e5e7eb)',
      surface: 'var(--dsw-alias-surface-primary, #ffffff)',
      raised: 'var(--dsw-alias-surface-secondary, #f6f7f9)',
      accent: 'var(--dsw-alias-accent, #2563eb)',
    };

    function Icon(props) {
      const size = typeof props.size === 'number' && props.size > 0 ? props.size : 18;
      return h(
        'svg',
        {
          viewBox: '0 0 20 20',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: size <= 16 ? 1.4 : 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          style: { display: 'block' },
          'aria-hidden': true,
        },
        h('circle', { cx: 6, cy: 6, r: 2.2 }),
        h('circle', { cx: 15, cy: 9, r: 2 }),
        h('circle', { cx: 9, cy: 15, r: 2 }),
        h('path', { d: 'M7.8 7.2 L13.2 8.4 M7.2 8 L8.2 12.9 M13.8 10.6 L10.6 13.8' }),
      );
    }

    function stripFrontmatter(text) {
      const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
      return match ? text.slice(match[0].length) : text;
    }

    function inline(text, keyPrefix) {
      const nodes = [];
      const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
      let last = 0;
      let match;
      let index = 0;
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) nodes.push(text.slice(last, match.index));
        const token = match[0];
        const key = `${keyPrefix}-i${index++}`;
        if (token.startsWith('**')) {
          nodes.push(h('strong', { key }, token.slice(2, -2)));
        } else if (token.startsWith('`')) {
          nodes.push(
            h('code', { key, style: { background: T.raised, borderRadius: 3, padding: '1px 4px', fontSize: '0.92em' } }, token.slice(1, -1)),
          );
        } else {
          const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(token);
          nodes.push(h('a', { key, href: link[2], target: '_blank', rel: 'noreferrer', style: { color: T.accent } }, link[1]));
        }
        last = match.index + token.length;
      }
      if (last < text.length) nodes.push(text.slice(last));
      return nodes;
    }

    /** Minimal markdown: headings, lists, quotes, code fences, paragraphs. */
    function Markdown({ text }) {
      const blocks = [];
      const lines = stripFrontmatter(text).split(/\r?\n/);
      let list = null;
      let code = null;
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (line.startsWith('```')) {
          if (code === null) {
            code = [];
          } else {
            blocks.push(h('pre', { key: `c${i}`, style: { background: T.raised, padding: 12, borderRadius: 6, overflow: 'auto', fontSize: 13 } }, h('code', null, code.join('\n'))));
            code = null;
          }
          continue;
        }
        if (code !== null) {
          code.push(line);
          continue;
        }
        if (line.trim() === '') {
          if (list) {
            blocks.push(h('ul', { key: `u${i}`, style: { margin: '0 0 12px', paddingLeft: 22 } }, list));
            list = null;
          }
          continue;
        }
        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        if (heading) {
          if (list) {
            blocks.push(h('ul', { key: `u${i}`, style: { margin: '0 0 12px', paddingLeft: 22 } }, list));
            list = null;
          }
          const level = heading[1].length;
          const size = [26, 21, 18, 16, 15, 14][level - 1];
          blocks.push(
            h(
              `h${Math.min(level + 1, 6)}`,
              { key: `h${i}`, style: { fontSize: size, lineHeight: 1.4, margin: '22px 0 10px', fontWeight: 600 } },
              inline(heading[2], `h${i}`),
            ),
          );
          continue;
        }
        const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
        if (bullet) {
          list = list || [];
          list.push(h('li', { key: `l${i}`, style: { marginBottom: 6 } }, inline(bullet[1], `l${i}`)));
          continue;
        }
        if (line.startsWith('>')) {
          blocks.push(
            h('blockquote', { key: `q${i}`, style: { margin: '0 0 12px', padding: '2px 0 2px 12px', borderLeft: `3px solid ${T.border}`, color: T.muted } }, inline(line.replace(/^>\s?/, ''), `q${i}`)),
          );
          continue;
        }
        blocks.push(h('p', { key: `p${i}`, style: { margin: '0 0 12px', lineHeight: 1.75 } }, inline(line, `p${i}`)));
      }
      if (list) blocks.push(h('ul', { key: 'u-end', style: { margin: '0 0 12px', paddingLeft: 22 } }, list));
      return h('div', { style: { fontSize: 15, color: T.text } }, blocks);
    }

    function Panel() {
      const [data, setData] = useState(null);
      const [error, setError] = useState('');
      const [activeId, setActiveId] = useState(null);
      const [entry, setEntry] = useState(null);
      const [query, setQuery] = useState('');

      useEffect(() => {
        let alive = true;
        fetch('/api/cognitive-library/index')
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
          .then((payload) => {
            if (!alive) return;
            setData(payload);
            if (payload.entries.length) setActiveId(payload.entries[0].id);
          })
          .catch((e) => alive && setError(`读取认知库失败：${e.message}`));
        return () => {
          alive = false;
        };
      }, []);

      useEffect(() => {
        if (!activeId) return undefined;
        let alive = true;
        setEntry(null);
        fetch(`/api/cognitive-library/entry?id=${encodeURIComponent(activeId)}`)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
          .then((payload) => alive && setEntry(payload))
          .catch((e) => alive && setEntry({ title: '读取失败', content: String(e) }));
        return () => {
          alive = false;
        };
      }, [activeId]);

      const groups = useMemo(() => {
        if (!data) return [];
        const needle = query.trim().toLowerCase();
        const visible = needle
          ? data.entries.filter((e) => `${e.title} ${e.summary} ${(e.tags || []).join(' ')}`.toLowerCase().includes(needle))
          : data.entries;
        const order = [...data.categories, '待归类'];
        const map = new Map(order.map((c) => [c, []]));
        for (const item of visible) {
          if (!map.has(item.category)) map.set(item.category, []);
          map.get(item.category).push(item);
        }
        return [...map.entries()].filter(([, items]) => items.length);
      }, [data, query]);

      if (error) {
        return h('div', { style: { padding: 24, color: T.muted } }, error);
      }
      if (!data) {
        return h('div', { style: { padding: 24, color: T.muted } }, '正在读取认知库…');
      }

      const nav = h(
        'div',
        {
          style: {
            width: 280,
            minWidth: 220,
            borderRight: `1px solid ${T.border}`,
            overflowY: 'auto',
            background: T.raised,
            padding: '12px 10px',
            boxSizing: 'border-box',
          },
        },
        h('div', { style: { fontWeight: 600, fontSize: 14, margin: '2px 6px 10px' } }, `认知库 · ${data.entries.length}`),
        h('input', {
          value: query,
          onChange: (event) => setQuery(event.target.value),
          placeholder: '搜索标题、摘要、标签',
          style: {
            width: '100%',
            boxSizing: 'border-box',
            padding: '6px 8px',
            marginBottom: 10,
            border: `1px solid ${T.border}`,
            borderRadius: 6,
            background: T.surface,
            color: T.text,
            fontSize: 13,
            outline: 'none',
          },
        }),
        groups.map(([category, items]) =>
          h(
            'div',
            { key: category, style: { marginBottom: 12 } },
            h('div', { style: { fontSize: 12, color: T.muted, margin: '0 6px 4px', letterSpacing: '.04em' } }, `${category} · ${items.length}`),
            items.map((item) =>
              h(
                'button',
                {
                  key: item.id,
                  type: 'button',
                  onClick: () => setActiveId(item.id),
                  style: {
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '7px 8px',
                    marginBottom: 2,
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    background: item.id === activeId ? T.surface : 'transparent',
                    color: T.text,
                    fontSize: 13,
                    lineHeight: 1.4,
                    boxShadow: item.id === activeId ? `inset 0 0 0 1px ${T.border}` : 'none',
                  },
                },
                h('span', { style: { marginRight: 6, opacity: 0.55, fontSize: 11 } }, item.type === 'article' ? '文' : '卡'),
                item.title,
              ),
            ),
          ),
        ),
      );

      const body = !entry
        ? h('div', { style: { padding: 24, color: T.muted } }, '正在读取…')
        : h(
            'div',
            { style: { maxWidth: 760, margin: '0 auto', padding: '32px 40px 80px' } },
            h('h1', { style: { fontSize: 26, margin: '0 0 6px', lineHeight: 1.3 } }, entry.title),
            h('div', { style: { fontSize: 12, color: T.muted, marginBottom: 22 } }, entry.type === 'article' ? '文章' : '卡片'),
            h(Markdown, { text: entry.content }),
          );

      return h(
        'div',
        { style: { display: 'flex', height: '100%', minHeight: 0, background: T.surface, color: T.text } },
        nav,
        h('div', { style: { flex: 1, overflowY: 'auto', minWidth: 0 } }, body),
      );
    }

    /** The sidebar passes its requested edge as `size`; wrapper boxes break row alignment. */
    function EntryButton({ size }) {
      return h(Icon, { size });
    }

    // ---- toasts -------------------------------------------------------------

    const toastListeners = new Set();
    let toasts = [];
    let toastSeq = 0;

    function notify(text, tone) {
      const id = ++toastSeq;
      toasts = [...toasts, { id, text, tone: tone || 'ok' }];
      toastListeners.forEach((fn) => fn());
      setTimeout(() => {
        toasts = toasts.filter((item) => item.id !== id);
        toastListeners.forEach((fn) => fn());
      }, 7000);
    }

    function ToastHost() {
      const [, bump] = useState(0);
      useEffect(() => {
        const listener = () => bump((n) => n + 1);
        toastListeners.add(listener);
        return () => toastListeners.delete(listener);
      }, []);
      return h(
        'div',
        { style: { position: 'fixed', right: 20, bottom: 24, zIndex: 9999, display: 'grid', gap: 8, pointerEvents: 'none' } },
        toasts.map((item) =>
          h(
            'div',
            {
              key: item.id,
              style: {
                maxWidth: 360,
                padding: '10px 14px',
                borderRadius: 8,
                fontSize: 13,
                lineHeight: 1.5,
                color: '#fff',
                background: item.tone === 'error' ? '#b42318' : 'rgba(17,24,39,0.92)',
                boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
                pointerEvents: 'auto',
              },
            },
            item.text,
          ),
        ),
      );
    }

    // ---- selection action ---------------------------------------------------

    /**
     * A floating 「知识整理」 next to the current text selection.
     * The host's own selection menu is native (Electron/OS), so a plugin cannot
     * add a row to it; this button is the in-app equivalent.
     */
    function SelectionAction() {
      const [spot, setSpot] = useState(null);
      const [busy, setBusy] = useState(false);

      useEffect(() => {
        function read() {
          const selection = window.getSelection();
          if (!selection || selection.isCollapsed) return setSpot(null);
          const text = String(selection.toString() || '').trim();
          if (text.length < 8) return setSpot(null);
          const node = selection.anchorNode;
          const element = node && (node.nodeType === 1 ? node : node.parentElement);
          if (!element || !element.closest) return setSpot(null);
          // Ignore selections inside inputs, editors and our own panel chrome.
          if (element.closest('input, textarea, [contenteditable="true"], [data-cogni-ui]')) return setSpot(null);
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          if (!rect || (!rect.width && !rect.height)) return setSpot(null);
          setSpot({ text, x: rect.left + rect.width / 2, y: rect.top });
        }
        function onUp() {
          setTimeout(read, 30);
        }
        function onDown(event) {
          const target = event.target;
          if (target && target.closest && target.closest('[data-cogni-ui]')) return;
          setSpot(null);
        }
        document.addEventListener('mouseup', onUp);
        document.addEventListener('mousedown', onDown);
        document.addEventListener('scroll', () => setSpot(null), true);
        return () => {
          document.removeEventListener('mouseup', onUp);
          document.removeEventListener('mousedown', onDown);
          document.removeEventListener('scroll', () => setSpot(null), true);
        };
      }, []);

      if (!spot) return null;
      return h(
        'div',
        {
          'data-cogni-ui': '1',
          style: {
            position: 'fixed',
            left: Math.max(80, Math.min(spot.x, (window.innerWidth || 1200) - 80)),
            top: Math.max(8, spot.y - 44),
            transform: 'translateX(-50%)',
            zIndex: 9998,
            display: 'flex',
            gap: 6,
          },
        },
        h(
          'button',
          {
            type: 'button',
            disabled: busy,
            onMouseDown: (event) => event.preventDefault(),
            onClick: async () => {
              setBusy(true);
              const text = spot.text;
              setSpot(null);
              notify('正在整理…', 'ok');
              try {
                const response = await fetch('/api/cognitive-library/digest', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ text, source: { kind: 'chat', ref: '选中文本' } }),
                });
                const payload = await response.json();
                if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
                const kind = payload.type === 'article' ? '文章' : '卡片';
                const hint = payload.suggestedCategory ? `（建议新建分类「${payload.suggestedCategory}」）` : '';
                notify(`已存入认知库：${kind}《${payload.title}》· ${payload.category}${hint}`);
              } catch (error) {
                notify(`整理失败：${error.message}`, 'error');
              } finally {
                setBusy(false);
              }
            },
            style: {
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.16)',
              background: 'rgba(17,24,39,0.94)',
              color: '#fff',
              fontSize: 12.5,
              cursor: 'pointer',
              boxShadow: '0 6px 20px rgba(0,0,0,0.22)',
            },
          },
          busy ? '整理中…' : '知识整理',
        ),
      );
    }

    /** A row in the session "..." menu: digest the whole conversation. */
    function SessionMenuRow({ sessionId, useMenuOpenState }) {
      const [busy, setBusy] = useState(false);
      const closeMenu = typeof useMenuOpenState === 'function' ? useMenuOpenState()[1] : null;

      async function run() {
        if (closeMenu) closeMenu(false);
        setBusy(true);
        notify('正在整理这个会话…');
        try {
          const response = await fetch('/api/cognitive-library/digest-session', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
          const kind = payload.type === 'article' ? '文章' : '卡片';
          const hint = payload.suggestedCategory ? `（建议新建分类「${payload.suggestedCategory}」）` : '';
          notify(`已存入认知库：${kind}《${payload.title}》· ${payload.category}${hint}`);
        } catch (error) {
          notify(`整理失败：${error.message}`, 'error');
        } finally {
          setBusy(false);
        }
      }

      return h(
        'button',
        {
          type: 'button',
          'data-cogni-ui': '1',
          disabled: busy,
          onClick: run,
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '8px 12px',
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            textAlign: 'left',
            cursor: 'pointer',
            borderRadius: 6,
          },
        },
        h(Icon, { size: 14 }),
        busy ? '整理中…' : '知识整理',
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: PANEL_ORDER,
            label: () => '认知库',
          }, EntryButton),
        );
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, Panel),
        );
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'cognitive-library-toast' }, ToastHost),
        );
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'cognitive-library-selection' }, SelectionAction),
        );
        ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
          ctx.slots.register({
            name: 'sidebar.workspaces.session.menu.item',
            id: 'cognitive-library-session-digest',
            order: 500,
          }, SessionMenuRow),
        );
      },
    };
  },
});
