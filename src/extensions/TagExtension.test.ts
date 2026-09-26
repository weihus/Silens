import { describe, it, expect } from 'vitest';
import { TAG_INPUT_REGEX, transformHashtagsToTagSpans } from './TagExtension';

describe('TagExtension', () => {
  it('matches tags at the beginning of a line without consuming the previous newline', () => {
    const input = '\n#读书 ';
    const match = input.match(TAG_INPUT_REGEX);

    expect(match).toBeTruthy();
    expect(match?.[0]).toBe('#读书 ');
    expect(match?.[1]).toBe('');
    expect(match?.[2]).toBe('读书');
  });

  it('does not treat newline as trigger whitespace for tag completion', () => {
    const input = '#读书\n';
    const match = input.match(TAG_INPUT_REGEX);

    expect(match).toBeNull();
  });

  it('does not move a hashtag to the previous line during parse DOM normalization', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>上一行文本</p><p>#读书 笔记</p>';

    transformHashtagsToTagSpans(container);

    const span = container.querySelector('span[data-tag="读书"]');
    expect(span).toBeTruthy();
    expect(span?.textContent).toBe('#读书');
    expect(span?.parentElement?.tagName).toBe('P');
    expect(container.querySelectorAll('p')[1]?.textContent?.trim()).toBe('#读书 笔记');
  });
});
