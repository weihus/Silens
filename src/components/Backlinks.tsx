import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { NoteTarget } from '../types';

interface Backlink {
  filename: string;
  snippet: string;
  search_text: string;
  occurrence: number;
}

interface BacklinksProps {
  filename: string;
  revision: number;
  onNavigate: (filename: string, searchText: NoteTarget) => void;
}

export function Backlinks({ filename, revision, onNavigate }: BacklinksProps) {
  const [links, setLinks] = useState<Backlink[]>([]);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    let request = 0;
    const refresh = async () => {
      const id = ++request;
      try {
        const result = await invoke<Backlink[]>('query_backlinks', { filename });
        if (active && id === request) {
          setLinks(result);
          setFailed(false);
        }
      } catch {
        if (active && id === request) {
          setLinks([]);
          setFailed(true);
        }
      }
    };
    void refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
    };
  }, [filename, revision, retry]);

  if (!links.length && !failed) return null;

  return (
    <section aria-label="反向链接" className="w-full max-w-[620px] mx-auto px-[40px] mt-12 text-sm" style={{ color: 'var(--theme-muted)' }}>
      {failed ? (
        <button className="quiet-button rounded px-2 py-2 text-left" onClick={() => setRetry(n => n + 1)}>
          引用暂时无法读取，点击重试
        </button>
      ) : (
        <details className="border-t pt-4" style={{ borderColor: 'var(--theme-border)' }}>
          <summary className="cursor-pointer py-2">被 {links.length} 篇笔记引用</summary>
          <ul className="mt-2 space-y-1">
            {links.map(link => (
              <li key={link.filename}>
                <button
                  className="quiet-button w-full rounded-lg px-3 py-3 text-left"
                  onClick={() => onNavigate(link.filename, { text: link.search_text, occurrence: link.occurrence })}
                >
                  <span className="block break-all" style={{ color: 'var(--theme-text)' }}>{link.filename.replace(/\.md$/, '')}</span>
                  <span className="mt-1 block leading-relaxed break-words">{link.snippet}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
