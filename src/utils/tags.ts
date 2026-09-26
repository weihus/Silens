/** Normalize a tag label: trim, cap at 40 chars. */
export function normalizeTag(raw: string) {
  const t = raw.trim();
  if (!t) return '';
  return t.length > 40 ? t.slice(0, 40) : t;
}

export function extractTagsFromText(text: string): string[] {
  const tags = new Set<string>();
  const re = /(^|\s)(#[^\s#，。！？；：、,.!?;:()（）【】\[\]{}<>"']{1,40})/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tag = normalizeTag(m[2].slice(1));
    if (tag) tags.add(tag);
  }
  return Array.from(tags);
}

export type TagsByDoc = Record<string, string[]>;

const TAGS_BY_DOC_KEY = 'silens_tags_by_doc_v1';

export function loadTagsByDoc(): TagsByDoc {
  const raw = localStorage.getItem(TAGS_BY_DOC_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

export function saveTagsByDoc(next: TagsByDoc) {
  localStorage.setItem(TAGS_BY_DOC_KEY, JSON.stringify(next));
}

export function updateDocTags(filename: string, content: string) {
  const tags = extractTagsFromText(content);
  const all = loadTagsByDoc();

  if (tags.length === 0) {
    delete all[filename];
  } else {
    all[filename] = tags;
  }

  saveTagsByDoc(all);
  return tags;
}

export function computeTagFrequency(tagsByDoc: TagsByDoc) {
  const freq = new Map<string, number>();
  for (const tags of Object.values(tagsByDoc)) {
    for (const t of tags) {
      freq.set(t, (freq.get(t) ?? 0) + 1);
    }
  }
  return freq;
}
