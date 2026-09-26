import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Paragraph from '@tiptap/extension-paragraph';
import { Markdown } from 'tiptap-markdown';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Extension } from '@tiptap/core';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import type { Theme } from '../types';
import Fuse from 'fuse.js';
import { invoke } from '@tauri-apps/api/core';
import { FocusSentenceExtension } from '../extensions/FocusSentenceExtension';
import { Icebreaker } from './Icebreaker';
import { Hashtag } from '../extensions/Hashtag';
import { LinkExtension } from '../extensions/LinkExtension';
import { useTypewriterScroll, useGhostHighlight } from '../hooks/useTypewriterScroll';

// Extension that forces cursor to position 1 when clicking an empty editor
const ForceStartFocus = Extension.create({
  name: 'forceStartFocus',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleClick: (view, _pos, event) => {
            const { state } = view;
            // Check if editor is effectively empty (no real content)
            const isEmpty = state.doc.textContent.trim() === '';
            if (isEmpty) {
              event.preventDefault();
              event.stopPropagation();
              const { tr } = state;
              // Position 1 (inside first paragraph), not 0 (doc root)
              tr.setSelection(TextSelection.create(tr.doc, 1));
              tr.scrollIntoView();
              view.dispatch(tr);
              view.focus();
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});

interface MarkdownEditorProps {
  theme: Theme;
  onChange: (markdown: string) => void;
  onTyping: () => void;
  initialContent?: string;
  targetSearchText: string | null;
  onConsumedTargetSearchText: () => void;
  onEditorReady?: (editor: Editor) => void;
  isFocusMode: boolean;
  knownTags: string[];
}

const ICEBREAKER_KEY = 'silens_icebreaker_date';

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const ICEBREAKER_PHRASES = [
  '今天有什么盘旋在脑海里？',
  '写下第一句话，剩下的交给直觉。',
  '先写一句，不必完美。',
  '把此刻最真实的感受写下来。',
  '从一个词开始，也算开始。',
];


export function MarkdownEditor({
  theme,
  onChange,
  onTyping,
  initialContent = '',
  targetSearchText,
  onConsumedTargetSearchText,
  onEditorReady,
  isFocusMode,
  knownTags,
}: MarkdownEditorProps) {
  const [isReveal, setIsReveal] = useState(false);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draggingRef = useRef(false);

  const [icebreakerText, setIcebreakerText] = useState<string | null>(null);
  const [icebreakerEvap, setIcebreakerEvap] = useState(false);
  const icebreakerShownRef = useRef(false);

  const [tagQuery, setTagQuery] = useState('');
  const [tagOpen, setTagOpen] = useState(false);
  const [tagPos, setTagPos] = useState<{ left: number; top: number } | null>(null);
  const [tagItems, setTagItems] = useState<string[]>([]);
  const [tagActiveIndex, setTagActiveIndex] = useState(0);
  const tagRangeRef = useRef<{ from: number; to: number } | null>(null);

  // [[双向链接]] 自动补全
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkPos, setLinkPos] = useState<{ left: number; top: number } | null>(null);
  const [linkItems, setLinkItems] = useState<string[]>([]);
  const [linkActiveIndex, setLinkActiveIndex] = useState(0);
  const linkRangeRef = useRef<{ from: number; to: number } | null>(null);
  const linkFuseRef = useRef<Fuse<{ name: string }> | null>(null);
  const [allDocNames, setAllDocNames] = useState<string[]>([]);

  // 1.5s Debounced save handler

  // 自定义段落扩展：强迫 TipTap 序列化 Markdown 时保留用户敲击的空行
  const CustomParagraph = Paragraph.extend({
    addStorage() {
      return {
        markdown: {
          serialize(state: any, node: any) {
            if (node.childCount === 0) {
              state.write(' ');
              state.closeBlock(node);
            } else {
              state.renderInline(node);
              state.closeBlock(node);
            }
          },
          parse: {
            setup(markdownit: any) {
              markdownit.block.ruler.enable('paragraph');
            },
          },
        },
      };
    },
  });

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // 1. 彻底禁用无用的富文本语法，将 # 完全释放给幽灵标签
        heading: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        strike: false,
        paragraph: false, // 卸载原生段落行为
      }),
      CustomParagraph,
      Hashtag,
      LinkExtension,
      Markdown.configure({
        html: false, // Ensure pure markdown
        tightLists: true,
        tightListClass: 'tight',
      }),
      FocusSentenceExtension,
      ForceStartFocus,
    ],
    content: initialContent,
    autofocus: 'start',
    editorProps: {
      handleScrollToSelection: () => {
        // When in writing mode the typewriter owns scroll (return true to intercept).
        // When navigating/jumping/edge_case, allow ProseMirror's native scroll.
        return !suspendTypewriterRef.current;
      },
      attributes: {
        // Typography System: 纯粹的系统无衬线、固定 19px、1.9 行高、0 段距、禁用标题干扰
        class: `prose ${theme === 'night' ? 'prose-invert' : 'prose-slate'} max-w-none focus:outline-none text-[17px] leading-[1.9] tracking-[0.03em] prose-p:my-0 prose-a:no-underline prose-strong:font-semibold min-h-[50vh]`,
      },
    },
    onUpdate: ({ editor }) => {
      onTyping();
      const markdown = (editor.storage as any).markdown.getMarkdown();
      if (/<[^>]+>/.test(markdown)) {
        console.error('Security Alert: HTML tags detected in Markdown output. Saving blocked.');
        return;
      }
      onChange(markdown);
    },
  });

  // Typewriter + ghost highlight effects (need editor to be ready)
  const { suspendTypewriterRef, jumpToPosition } = useTypewriterScroll(editor);
  useGhostHighlight(editor, targetSearchText, onConsumedTargetSearchText, jumpToPosition);

  const tagFuse = useMemo(() => {
    return new Fuse(knownTags.map((t) => ({ t })), {
      keys: ['t'],
      threshold: 0.3,
    });
  }, [knownTags]);

  const posAtTextOffset = useCallback((doc: any, from: number, to: number, offset: number) => {
    if (offset <= 0) return from;
    let acc = 0;
    let found: number | null = null;
    doc.nodesBetween(from, to, (node: any, pos: number) => {
      if (!node.isText) return;
      const len = node.text?.length ?? 0;
      if (acc + len >= offset) {
        found = pos + (offset - acc);
        return false;
      }
      acc += len;
      return;
    });
    return found ?? to;
  }, []);

  const updateTagContext = useCallback(() => {
    if (!editor) return;
    const { state, view } = editor;
    const $head = state.selection.$head;
    const blockFrom = $head.start();
    const beforeText = state.doc.textBetween(blockFrom, $head.pos, '\n', '\n');
    const hashIndex = beforeText.lastIndexOf('#');
    if (hashIndex === -1) {
      setTagOpen(false);
      setTagQuery('');
      tagRangeRef.current = null;
      return;
    }

    const prevChar = hashIndex === 0 ? ' ' : beforeText[hashIndex - 1];
    if (prevChar && !/\s/.test(prevChar)) {
      setTagOpen(false);
      setTagQuery('');
      tagRangeRef.current = null;
      return;
    }

    const query = beforeText.slice(hashIndex + 1);
    if (query.includes(' ') || query.includes('\n') || query.includes('#')) {
      setTagOpen(false);
      setTagQuery('');
      tagRangeRef.current = null;
      return;
    }

    const fromPos = posAtTextOffset(state.doc, blockFrom, $head.pos, hashIndex);
    tagRangeRef.current = { from: fromPos, to: $head.pos };

    setTagQuery(query);
    const coords = view.coordsAtPos($head.pos);
    const box = (view.dom as HTMLElement).getBoundingClientRect();
    setTagPos({ left: coords.left - box.left, top: coords.bottom - box.top + 8 });

    if (query.trim() === '') {
      setTagItems(knownTags.slice(0, 6));
      setTagActiveIndex(0);
      setTagOpen(true);
      return;
    }

    const q = query.trim();
    const res = tagFuse.search(q).slice(0, 6).map((r) => r.item.t);
    setTagItems(res.length ? res : knownTags.slice(0, 6));
    setTagActiveIndex(0);
    setTagOpen(true);
  }, [editor, knownTags, posAtTextOffset, tagFuse]);

  useEffect(() => {
    if (!editor) return;
    updateTagContext();
    editor.on('selectionUpdate', updateTagContext);
    editor.on('update', updateTagContext);
    return () => {
      editor.off('selectionUpdate', updateTagContext);
      editor.off('update', updateTagContext);
    };
  }, [editor, updateTagContext]);

  // Load all document names for link suggestions
  useEffect(() => {
    const loadDocs = async () => {
      try {
        const docs = await invoke<string[]>('search_docs_by_prefix', { prefix: '' });
        setAllDocNames(docs);
        linkFuseRef.current = new Fuse(docs.map(d => ({ name: d })), {
          keys: ['name'],
          threshold: 0.3,
        });
      } catch (err) {
        console.error('Failed to load doc names:', err);
      }
    };
    loadDocs();
  }, []);

  const updateLinkContext = useCallback(() => {
    if (!editor) return;
    const { state, view } = editor;
    const $head = state.selection.$head;
    const blockFrom = $head.start();
    const beforeText = state.doc.textBetween(blockFrom, $head.pos, '\n', '\n');

    // Find [[ pattern
    const linkMatch = beforeText.match(/\[\[([^\[\]]*)$/);
    if (!linkMatch) {
      setLinkOpen(false);
      linkRangeRef.current = null;
      return;
    }

    const query = linkMatch[1];
    if (query.includes(' ')) {
      setLinkOpen(false);
      linkRangeRef.current = null;
      return;
    }

    const hashIndex = beforeText.lastIndexOf('[[');
    const fromPos = posAtTextOffset(state.doc, blockFrom, $head.pos, hashIndex);
    linkRangeRef.current = { from: fromPos, to: $head.pos };

    const coords = view.coordsAtPos($head.pos);
    const box = (view.dom as HTMLElement).getBoundingClientRect();
    setLinkPos({ left: coords.left - box.left, top: coords.bottom - box.top + 8 });

    // Fuzzy search with multiple strategies:
    // 1. Exact prefix match
    // 2. Substring match (query appears anywhere in doc name)
    // 3. Fuse.js fuzzy match (character insertion/deletion/substitution)
    const q = query.trim().toLowerCase();
    const results: string[] = [];

    if (q.length > 0) {
      // Strategy 1: prefix match
      const prefixMatches = allDocNames.filter(d => d.toLowerCase().startsWith(q));
      // Strategy 2: substring match
      const substringMatches = allDocNames.filter(d => d.toLowerCase().includes(q));
      // Strategy 3: Fuse.js fuzzy match
      const fuseMatches = linkFuseRef.current
        ? linkFuseRef.current.search(q).slice(0, 6).map(r => r.item.name)
        : [];

      // Combine: prefix > substring > fuzzy, deduplicate while preserving order
      const seen = new Set<string>();
      for (const match of [...prefixMatches, ...substringMatches, ...fuseMatches]) {
        if (!seen.has(match)) {
          seen.add(match);
          results.push(match);
        }
        if (results.length >= 6) break;
      }
    }

    setLinkItems(results.length > 0 ? results : allDocNames.slice(0, 6));
    setLinkActiveIndex(0);
    setLinkOpen(true);
  }, [editor, allDocNames, posAtTextOffset]);

  useEffect(() => {
    if (!editor) return;
    updateLinkContext();
    editor.on('selectionUpdate', updateLinkContext);
    editor.on('update', updateLinkContext);
    return () => {
      editor.off('selectionUpdate', updateLinkContext);
      editor.off('update', updateLinkContext);
    };
  }, [editor, updateLinkContext]);

  const applyLink = useCallback((docName: string) => {
    if (!editor) return;
    const r = linkRangeRef.current;
    if (!r) return;
    editor.chain().focus().insertContentAt({ from: r.from, to: r.to }, `[[${docName}]] `).run();
    setLinkOpen(false);
    linkRangeRef.current = null;
  }, [editor]);

  const applyTag = useCallback((tag: string) => {
    if (!editor) return;
    const r = tagRangeRef.current;
    if (!r) return;
    editor
      .chain()
      .focus()
      .insertContentAt({ from: r.from, to: r.to }, `#${tag} `)
      .run();
    setTagOpen(false);
    setTagQuery('');
    tagRangeRef.current = null;
  }, [editor]);

  const evaluateIcebreaker = useCallback(() => {
    if (!editor) return;
    const stored = localStorage.getItem(ICEBREAKER_KEY);
    const today = todayKey();
    const empty = editor.getText().trim() === '';

    if (empty && stored !== today) {
      if (!icebreakerShownRef.current) {
        const idx = Math.floor(Math.random() * ICEBREAKER_PHRASES.length);
        setIcebreakerText(ICEBREAKER_PHRASES[idx]);
        setIcebreakerEvap(false);
        icebreakerShownRef.current = true;
      }
    } else {
      setIcebreakerText(null);
      setIcebreakerEvap(false);
      icebreakerShownRef.current = false;
    }
  }, [editor]);

  useEffect(() => {
    evaluateIcebreaker();
  }, [evaluateIcebreaker]);

  useEffect(() => {
    if (!isFocusMode) {
      setIsReveal(false);
      return;
    }
  }, [isFocusMode]);

  // Notify parent when editor is ready
  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);


  // Handle external content updates (e.g., loading a file)
  useEffect(() => {
    if (!editor) return;
    const currentContent = (editor.storage as any).markdown.getMarkdown();

    if (initialContent !== currentContent) {
      editor.commands.setContent(initialContent);
    }
  }, [initialContent, editor]);

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      if (!icebreakerText || icebreakerEvap) return;
      const stillEmpty = editor.getText().trim() === '';
      if (!stillEmpty) {
        setIcebreakerEvap(true);
        localStorage.setItem(ICEBREAKER_KEY, todayKey());
        window.setTimeout(() => {
          setIcebreakerText(null);
          setIcebreakerEvap(false);
          icebreakerShownRef.current = false;
        }, 720);
      }
    };
    editor.on('update', update);
    return () => {
      editor.off('update', update);
    };
  }, [editor, icebreakerText, icebreakerEvap]);

  return (
    <div
      className={`relative w-full max-w-[620px] mx-auto px-[40px] ${isFocusMode ? 'is-zen-mode' : ''} ${
        isFocusMode && isReveal ? 'is-zen-reveal' : ''
      }`}
      onMouseMove={() => {
        if (!isFocusMode) return;
        if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
        setIsReveal(true);
      }}
      onMouseLeave={() => {
        if (!isFocusMode) return;
        if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = setTimeout(() => {
          if (!draggingRef.current) setIsReveal(false);
        }, 180);
      }}
      onMouseDown={() => {
        if (!isFocusMode) return;
        draggingRef.current = true;
        setIsReveal(true);
        const onUp = () => {
          draggingRef.current = false;
          setTimeout(() => setIsReveal(false), 300);
          window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mouseup', onUp);
      }}
      onKeyDownCapture={(e) => {
        if (tagOpen) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setTagActiveIndex((i) => (i + 1) % Math.max(1, tagItems.length));
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setTagActiveIndex((i) => (i - 1 + Math.max(1, tagItems.length)) % Math.max(1, tagItems.length));
            return;
          }
          if (e.key === 'Enter' || e.key === 'Tab') {
            const tag = tagItems[tagActiveIndex];
            if (tag) {
              e.preventDefault();
              applyTag(tag);
              return;
            }
          }
        }

        if (linkOpen) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setLinkActiveIndex((i) => (i + 1) % Math.max(1, linkItems.length));
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setLinkActiveIndex((i) => (i - 1 + Math.max(1, linkItems.length)) % Math.max(1, linkItems.length));
            return;
          }
          if (e.key === 'Enter' || e.key === 'Tab') {
            const link = linkItems[linkActiveIndex];
            if (link) {
              e.preventDefault();
              applyLink(link);
              return;
            }
          }
        }

        if (e.key === ' ' && tagQuery.trim() !== '' && tagRangeRef.current) {
          setTagOpen(false);
        }

        // Undo / Redo
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
          e.preventDefault();
          editor?.commands.undo();
          return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
          e.preventDefault();
          editor?.commands.redo();
          return;
        }
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          editor?.commands.redo();
          return;
        }

        if (!isFocusMode) return;
        setIsReveal(false);
      }}
    >
      {icebreakerText && (
        <Icebreaker text={icebreakerText} evaporating={icebreakerEvap} />
      )}

      {tagOpen && tagPos && tagItems.length > 0 && (
        <div
          className="absolute z-50"
          style={{ left: tagPos.left, top: tagPos.top }}
        >
          <div
            className="pointer-events-auto backdrop-blur-md border border-black/5 dark:border-white/[0.12] shadow-[0_8px_30px_rgba(0,0,0,0.06)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.4)] rounded-xl p-1.5 flex flex-col"
            style={{
              backgroundColor: theme === 'night' ? 'rgba(28, 36, 54, 0.85)' : theme === 'paper' ? 'rgba(244, 234, 213, 0.85)' : 'rgba(255, 255, 255, 0.85)',
            }}
          >
            {tagItems.map((t, idx) => (
              <button
                key={t}
                type="button"
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  applyTag(t);
                }}
                className={`block w-full text-left px-3 py-2 my-0.5 rounded-lg text-sm tracking-widest transition-all duration-150 ${
                  idx === tagActiveIndex ? 'bg-black/5 dark:bg-white/10 opacity-100' : 'opacity-80 hover:bg-black/5 dark:hover:bg-white/10 hover:opacity-100'
                }`}
                style={{ color: 'var(--theme-text)' }}
              >
                #{t}
              </button>
            ))}
          </div>
        </div>
      )}

      {linkOpen && linkPos && linkItems.length > 0 && (
        <div
          className="absolute z-50"
          style={{ left: linkPos.left, top: linkPos.top }}
        >
          <div
            className="pointer-events-auto backdrop-blur-md border border-black/5 dark:border-white/[0.12] shadow-[0_8px_30px_rgba(0,0,0,0.06)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.4)] rounded-xl p-1.5 flex flex-col"
            style={{
              backgroundColor: theme === 'night' ? 'rgba(28, 36, 54, 0.85)' : theme === 'paper' ? 'rgba(244, 234, 213, 0.85)' : 'rgba(255, 255, 255, 0.85)',
            }}
          >
            {linkItems.map((doc, idx) => (
              <button
                key={doc}
                type="button"
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  applyLink(doc);
                }}
                className={`block w-full text-left px-3 py-2 my-0.5 rounded-lg text-sm tracking-widest transition-all duration-150 ${
                  idx === linkActiveIndex ? 'bg-black/5 dark:bg-white/10 opacity-100' : 'opacity-80 hover:bg-black/5 dark:hover:bg-white/10 hover:opacity-100'
                }`}
                style={{ color: 'var(--theme-text)' }}
              >
                {doc}
              </button>
            ))}
          </div>
        </div>
      )}

      <EditorContent editor={editor} />
      <style>{`
        .tiptap p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: var(--theme-muted);
          pointer-events: none;
          height: 0;
        }
        /* 仅保留最基础富文本元素的色彩继承 */
        .prose p, .prose strong, .prose em, .prose ol, .prose ul, .prose li {
          color: var(--theme-text) !important;
        }
        
        /* 独裁排版：强制 1.9 行高 + 微弱字距，为中文方块字留呼吸 */
        .prose .tiptap,
        .tiptap p,
        .prose p {
          line-height: 1.9 !important;
          letter-spacing: 0.03em;
        }
        /* 双回车物理留白：区块间 48~64px 呼吸空隙，段落 0 段距由 block margin 承担 */
        .prose .tiptap p {
          margin-bottom: 48px;
        }
        .prose .tiptap p:last-child {
          margin-bottom: 0;
        }

        /* 主题切换的平滑色彩过渡 */
        .prose, .prose * {
          transition: color 0.5s ease-in-out, background-color 0.5s ease-in-out, border-color 0.5s ease-in-out;
        }

    /* 阅后即焚的“幽灵高亮”动画 */
    .ghost-highlight {
      animation: ghostFade 1.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      border-radius: 6px;
    }
    @keyframes ghostFade {
      0% { background-color: rgba(156, 163, 175, 0.2); box-shadow: 0 0 0 4px rgba(156, 163, 175, 0.2); }
      100% { background-color: transparent; box-shadow: 0 0 0 4px transparent; }
    }

        .is-zen-mode .ProseMirror > * {
          opacity: 0.15;
          filter: blur(2px);
          transition: all 0.5s ease;
        }

        .is-zen-mode .ProseMirror > *.zen-active-block {
          opacity: 1;
          filter: none;
        }

        .is-zen-mode .ProseMirror > *.zen-active-block .zen-dim {
          opacity: 0.15;
          filter: blur(2px);
          transition: all 0.5s ease;
        }

        .is-zen-mode .ProseMirror > *.zen-active-block .zen-active-sentence {
          opacity: 1;
          filter: none;
        }

        .is-zen-mode.is-zen-reveal .ProseMirror > * {
          opacity: 1;
          filter: none;
        }

        .is-zen-mode.is-zen-reveal .zen-dim {
          opacity: 1;
          filter: none;
        }

        /* Custom scrollbar hidden but functional */
        .prose {
          overflow-y: auto;
          scrollbar-width: none;
        }
        .prose::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}
