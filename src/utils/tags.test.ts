import { describe, it, expect, beforeEach } from 'vitest';
import { updateDocTags, loadTagsByDoc, saveTagsByDoc } from './tags';

describe('tags util', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('removes document entry when content no longer contains tags', () => {
    saveTagsByDoc({
      'doc1.md': ['read'],
      'doc2.md': ['write'],
    });

    updateDocTags('doc1.md', 'this has no tag');

    const all = loadTagsByDoc();
    expect(all['doc1.md']).toBeUndefined();
    expect(all['doc2.md']).toEqual(['write']);
  });
});
