import { render, screen, waitFor } from '@testing-library/react';
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
