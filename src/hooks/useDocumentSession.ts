import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Editor } from '@tiptap/react';
import { applyEncodedContent, decodeEmptyLines, encodeEmptyLines } from '../utils/emptyLines';

import { documentKind, parseDocument, serializeDocument } from '../utils/documents';
import type { DocumentKind } from '../types';

type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

type Session = { filename: string; content: string; saved: string | null; title: string; body: string; kind: DocumentKind };

export function useDocumentSession(editor: Editor | null, onSaved: (filename: string, content: string) => void) {
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [filename, setFilename] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string } | null>(null);
  const session = useRef<Session | null>(null);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    const write = queue.current.catch(() => {}).then(async () => {
      const current = session.current;
      if (!current || current.content === current.saved || (current.saved === null && current.content === '')) return;
      const content = current.content;
      setStatus('saving');
      try {
        await invoke<string>('save_document', {
          content, currentFilename: current.filename, expectedContent: current.saved,
        });
        current.saved = content;
        setStatus(current.content === content ? 'saved' : 'pending');
        setError(null);
        onSavedRef.current(current.filename, content);
      } catch (cause) {
        setStatus('error');
        setError(String(cause).includes('DOCUMENT_CONFLICT')
          ? '这篇笔记已在其他地方修改。可以保留当前副本后重新读取，或先导出文字。'
          : '尚未保存，请检查笔记文件夹是否可用后重试。当前文字仍保留在这里。');
        throw cause;
      }
    });
    queue.current = write;
    await write;
  }, []);

  const scheduleSave = useCallback(() => {
    const current = session.current;
    if (!current) return;
    current.content = current.saved === null && !current.title && !current.body
      ? '' : serializeDocument(current.kind, current.title, current.body);
    const unchanged = current.content === current.saved || (current.saved === null && current.content === '');
    setStatus(unchanged ? 'saved' : 'pending');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush().catch(() => {}); }, 1500);
  }, [flush]);

  const change = useCallback((encoded: string) => {
    if (busy.current || !session.current) return;
    setText(encoded);
    session.current.body = decodeEmptyLines(encoded);
    scheduleSave();
  }, [scheduleSave]);

  const changeTitle = useCallback((value: string) => {
    if (busy.current || !session.current || session.current.kind !== 'article') return;
    const next = value.replace(/[\r\n]+/g, ' ');
    setTitle(next);
    session.current.title = next;
    scheduleSave();
  }, [scheduleSave]);

  const getContent = useCallback(() => session.current?.content ?? '', []);

  const open = useCallback(async (nextFilename: string, allowMissing = false, recovery?: 'reload' | 'preserve', isCurrent?: () => boolean): Promise<boolean> => {
    if (!editor || busy.current || (isCurrent && !isCurrent())) return false;
    if (!recovery && session.current?.filename === nextFilename) return true;
    busy.current = true;
    setLoading(true);
    try {
      if (recovery === 'preserve') {
        if (timer.current) clearTimeout(timer.current);
        await queue.current.catch(() => {});
        const draft = session.current;
        if (draft) {
          const copyName = `${draft.filename.replace(/\.md$/, '')}_副本_${Date.now()}.md`;
          await invoke('save_file_as', { filename: copyName, content: draft.content });
        }
      } else {
        await flush();
      }
      let content: string;
      let saved: string | null;
      try {
        content = await invoke<string>('load_document', { filename: nextFilename });
        saved = content;
      } catch (cause) {
        if (isCurrent && !isCurrent()) return false;
        if (allowMissing && String(cause) === 'DOCUMENT_NOT_FOUND') {
          content = '';
          saved = null;
        } else {
          if (String(cause) === 'DOCUMENT_NOT_FOUND') {
            setNotice({ message: documentKind(nextFilename) === 'journal' ? '这一天还没有笔记' : '这篇笔记不存在或已被移走' });
          } else {
            setError('无法读取笔记，请检查文件夹是否可用。');
          }
          return false;
        }
      }
      if (isCurrent && !isCurrent()) return false;
      const parsed = parseDocument(nextFilename, content);
      const encoded = encodeEmptyLines(parsed.body);
      applyEncodedContent(editor, encoded);
      session.current = { filename: nextFilename, content, saved, ...parsed };
      setText(encoded);
      setTitle(parsed.title);
      setFilename(nextFilename);
      setStatus('saved');
      setError(null);
      onSavedRef.current(nextFilename, content);
      return true;
    } catch (cause) {
      if (recovery === 'preserve') setError(`副本未能保存或笔记未能读取，当前文字保持不变。${String(cause)}`);
      return false;
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [editor, flush]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { text, title, filename, loading, status, error, notice, change, changeTitle, getContent, open, flush };
}
