import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { MarkdownEditor } from './MarkdownEditor';
import { applyEncodedContent, decodeEmptyLines, encodeEmptyLines } from '../utils/emptyLines';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandPalette } from './CommandPalette';

// Mock tauri invoke
const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
}));

// Mock scrollIntoView for JSDOM
Element.prototype.scrollIntoView = vi.fn();

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders backdrop and dialog when open', async () => {
    mockInvoke.mockResolvedValue([]);
    const onOpenChange = vi.fn();

    render(<CommandPalette open={true} onOpenChange={onOpenChange} editor={null} currentFilename={null} />);

    // Check for backdrop
    const backdrop = document.querySelector('[class*="fixed"]');
    expect(backdrop).toBeInTheDocument();
  });

  it('renders search input with correct placeholder', async () => {
    mockInvoke.mockResolvedValue([]);
    render(<CommandPalette open={true} onOpenChange={vi.fn()} editor={null} currentFilename={null} />);

    await waitFor(() => {
      const input = screen.getByPlaceholderText('搜索笔记与灵感...');
      expect(input).toBeInTheDocument();
    });
  });
});

describe('MarkdownEditor regressions with a real editor', () => {
  let editor: Editor;
  const onChange = vi.fn();
  beforeEach(() => {
    cleanup();
    onChange.mockClear();
    mockInvoke.mockResolvedValue(['Alpha']);
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => new DOMRect();
  });

  async function mount() {
    render(<MarkdownEditor theme="paper" onChange={onChange} onTyping={vi.fn()}
      onEditorReady={value => { editor = value; }} targetSearchText={null}
      onConsumedTargetSearchText={vi.fn()} isFocusMode={false} knownTags={['alpha']} />);
    await waitFor(() => expect(editor).toBeDefined());
  }

  it('saves angle-bracket text without rendering HTML', async () => {
    await mount();
    act(() => { editor.commands.insertContent({ type: 'text', text: 'before <script>alert(1)</script> <name> after' }); });
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('&lt;script&gt;'));
    act(() => editor.commands.setContent('```\n<name>\n```'));
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('<name>'));
    expect(editor.view.dom.querySelector('script')).toBeNull();
    expect(editor.getText()).toContain('<name>');
  });

  it('roundtrips imported structure and ordinary empty lines through the existing utility', async () => {
    await mount();
    const markdown = '# Heading\n\n> Quote\n\n```js\nconst x = 1;\n```\n\nText with `code` and ~~strike~~.\n\n---\n\n- item\n\nFirst\n\n\nSecond';
    act(() => applyEncodedContent(editor, encodeEmptyLines(markdown)));
    expect(editor.view.dom.querySelector('h1')?.textContent).toBe('Heading');
    expect(editor.view.dom.querySelector('blockquote')?.textContent).toBe('Quote');
    expect(editor.view.dom.querySelector('pre code')?.textContent).toContain('const x = 1;');
    const saved = decodeEmptyLines((editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown());
    expect(saved).toContain('First\n\n\nSecond');
    const structure = editor.getJSON();
    act(() => applyEncodedContent(editor, encodeEmptyLines(saved)));
    expect(editor.getJSON()).toEqual(structure);
    expect(editor.options.enableInputRules).not.toContain('heading');
    act(() => editor.commands.setContent(''));
    act(() => editor.commands.insertContent({ type: 'text', text: '#' }));
    let handled = false;
    editor.view.someProp('handleTextInput', handler => {
      handled = handler(editor.view, 2, 2, ' ', () => editor.state.tr.insertText(' ')) === true;
      return handled;
    });
    expect(handled).toBe(false);
    expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
  });

  it('preserves consecutive empty lines inside fenced code', async () => {
    await mount();
    act(() => applyEncodedContent(editor, encodeEmptyLines('```\na\n\n\nb\n```')));
    expect(editor.state.doc.firstChild?.textContent).toBe('a\n\n\nb');
    const saved = decodeEmptyLines((editor.storage as any).markdown.getMarkdown());
    expect(saved).toContain('a\n\n\nb');
  });

  it('does not replace IME confirmation, refreshes suggestions after commit and closes on Escape', async () => {
    await mount();
    act(() => editor.commands.insertContent({ type: 'text', text: '#al' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    const dom = editor.view.dom;
    expect(fireEvent.keyDown(dom, { key: 'Enter', isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(dom, { key: 'Enter', keyCode: 229 })).toBe(true);
    fireEvent.compositionStart(dom);
    act(() => editor.commands.insertContent({ type: 'text', text: 'p' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(fireEvent.keyDown(dom, { key: 'Enter' })).toBe(true);
    fireEvent.compositionEnd(dom);
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
    expect(editor.getText()).toBe('#alp');
    fireEvent.keyDown(dom, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    act(() => { editor.commands.setContent(''); editor.commands.insertContent({ type: 'text', text: '#zzzzzz' }); });
    expect(screen.queryByRole('listbox')).toBeNull();
    act(() => { editor.commands.setContent(''); editor.commands.insertContent({ type: 'text', text: '[[zzzzzz' }); });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('MarkdownEditor', () => {
  it('renders correctly', async () => {
    // Dynamic import so vi.mock('@tiptap/pm/state') is already installed
    const { MarkdownEditor } = await import('./MarkdownEditor');

    const onChange = vi.fn();
    const onTyping = vi.fn();
    render(
      <MarkdownEditor
        theme="paper"
        onChange={onChange}
        onTyping={onTyping}
        targetSearchText={null}
        onConsumedTargetSearchText={() => {}}
        isFocusMode={false}
        knownTags={[]}
      />
    );

    const editor = document.querySelector('.tiptap');
    expect(editor).toBeInTheDocument();
    expect(editor).toHaveAttribute('contenteditable', 'true');
  });
});
