import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, expect, it, vi } from 'vitest';
import { LinkExtension } from './LinkExtension';

let editor: Editor;
afterEach(() => editor?.destroy());

it('renders real decorations at nested document positions and dispatches the clicked name safely', () => {
  const name = 'note " onclick="alert(1)<img src=x>';
  editor = new Editor({
    extensions: [StarterKit, LinkExtension],
    content: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'prefix' }] },
      { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: `before [[${name}]] after` }] }] },
    ] },
  });
  const target = editor.view.dom.querySelector('.silens-link')!;
  expect(target.textContent).toBe(`[[${name}]]`);
  expect(target.getAttribute('data-doc-name')).toBe(name);
  expect(target.hasAttribute('onclick')).toBe(false);
  expect(target.querySelector('img')).toBeNull();
  const listener = vi.fn();
  window.addEventListener('silens-link-click', listener);
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  const pos = editor.view.posAtDOM(target.firstChild!, 2);
  editor.view.someProp('handleClick', handler => handler(editor.view, pos, event));
  expect(listener).toHaveBeenCalledTimes(1);
  expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ docName: name });
  window.removeEventListener('silens-link-click', listener);
  editor.commands.insertContentAt(1, 'extra ');
  expect(editor.view.dom.querySelector('.silens-link')?.textContent).toBe(`[[${name}]]`);
  editor.commands.setContent('<p>no links</p>');
  expect(editor.view.dom.querySelector('.silens-link')).toBeNull();
});
