import type { RecallArticle, RecallDay } from '../types';
import { calendarDate, exactTime } from '../utils/recall';

export function ArticleCard({ article, onOpen, onTag, dateMode = 'created', current = false }: {
  article: RecallArticle;
  onOpen?: (filename: string) => void;
  onTag?: (tag: string) => void;
  dateMode?: 'created' | 'modified' | 'none';
  current?: boolean;
}) {
  const excerpt = article.content.split('\n').filter(line => {
    const words = line.trim().split(/\s+/);
    return !words.every(word => word.startsWith('#') && article.tags.includes(word.slice(1)));
  }).join('\n').replace(/^ {0,3}#{1,6}[\t ]+/gm, '').trim();
  const times = `创作：${exactTime(article.created)}\n最后修改：${exactTime(article.modified)}`;
  const timestamp = dateMode === 'modified' ? article.modified : article.created;
  return (
    <div className="recall-note">
      <button type="button" aria-current={current ? 'page' : undefined} aria-description={times.replace('\n', '；')} title={times}
        className="quiet-button recall-note-button" onClick={() => onOpen?.(article.filename)}>
        <span className="recall-note-title">{article.title}</span>
        {excerpt && <span className="recall-note-excerpt line-clamp-2">{excerpt}</span>}
        {dateMode !== 'none' && <time className="recall-note-date" dateTime={new Date(timestamp * 1000).toISOString()}>
          {dateMode === 'modified' ? `修改于 ${calendarDate(article.modified)}` : `创作于 ${article.created_date}`}
        </time>}
      </button>
      {onTag && article.tags.length > 0 && <div className="recall-note-tags">
        {article.tags.map(tag => <button key={tag} type="button" className="quiet-button rounded py-1" onClick={() => onTag(tag)}>#{tag}</button>)}
      </div>}
    </div>
  );
}

export function RecallTimeline({ days, onOpen, onSelectResult, onTag, onBrowseDate }: {
  days: RecallDay[];
  onOpen?: (filename: string) => void;
  onSelectResult?: (filename: string, searchText: string) => void;
  onTag: (tag: string) => void;
  onBrowseDate: (date: string) => void;
}) {
  return (
    <div className="relative pl-5">
      <div className="absolute left-0 top-1 bottom-0 w-px" style={{ backgroundColor: 'var(--theme-border)' }} />
      {days.map(day => (
        <section key={day.date} className="relative mb-12 pl-2" aria-label={`${day.date} 的笔记`}>
          <div className="absolute -left-5 top-2 h-1.5 w-1.5 -translate-x-1/2 rounded-full" style={{ backgroundColor: 'var(--theme-muted)', opacity: 0.45 }} />
          <button type="button" className="quiet-button rounded py-1 text-xs font-mono tracking-wide" style={{ color: 'var(--theme-muted)' }} onClick={() => onBrowseDate(day.date)}>{day.date}</button>
          <div className="mt-5">
            {day.articles.map(article => <ArticleCard key={article.filename} article={article} onOpen={onOpen} onTag={onTag} dateMode="none" />)}
            {day.tags.map(group => (
              <div key={`${group.filename}:${group.tag}`} className="mb-8">
                <button type="button" onClick={() => onTag(group.tag)} className="quiet-button mb-3 rounded py-1 text-xs tracking-wider" style={{ color: 'var(--theme-muted)' }}>#{group.tag}</button>
                <div className="space-y-4">
                  {group.blocks.map((content, index) => ({ content, index, time: content.match(/^(\d{2}:\d{2})/)?.[1] }))
                    .sort((a, b) => a.time && b.time ? a.time.localeCompare(b.time) || a.index - b.index : a.index - b.index)
                    .map(({ content, index }) => {
                    const time = content.match(/^(\d{2}:\d{2})\s*([\s\S]*)/);
                    const target = content.split('\n')[0].trim() || `#${group.tag}`;
                    return <button type="button" key={index} className="quiet-button block w-full rounded text-left text-[13px] leading-[1.8] whitespace-pre-wrap line-clamp-5 break-words"
                      onClick={() => onSelectResult?.(group.filename, target)}>
                      {time && <span className="mr-3 font-mono text-xs" style={{ color: 'var(--theme-muted)' }}>{time[1]}</span>}
                      {time ? time[2] : content}
                    </button>;
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
