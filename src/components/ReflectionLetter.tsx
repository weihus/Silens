import { Fragment, type ReactNode, type Ref } from 'react';
import type { ReflectionEpilogue } from '../utils/reflectionAI';
import type { NoteTarget, PeriodReflectionResult, ReflectionPerspective } from '../types';
import { formatReflectionDate, reflectionHasContent, reflectionHeading, reflectionSlotLabel } from '../utils/reflectionPresentation';
import './reflection.css';

export interface ReflectionLetterProps {
  result: PeriodReflectionResult;
  disabled?: boolean;
  onNavigate: (filename: string, target?: NoteTarget) => void | Promise<unknown>;
  onPerspectiveChange: (perspective: ReflectionPerspective) => void;
  onShuffle: () => void;
  letterRef?: Ref<HTMLDivElement>;
  emptyAction?: ReactNode;
  epilogue?: ReflectionEpilogue | null;
}

function Chapter({ title, children }: { title: string; children: ReactNode }) {
  return <section className="reflection-chapter" aria-label={title}>
    <h2 className="reflection-chapter-title">{title}</h2>{children}
  </section>;
}

function Tags({ tags }: { tags: string[] }) {
  return tags.length > 0 ? <span className="reflection-tags">{tags.map(tag => `#${tag}`).join('　')}</span> : null;
}

function approximateChars(value: number): string {
  if (value >= 10000) return `约 ${Number((value / 10000).toFixed(1))} 万字`;
  if (value >= 100) return `约 ${Math.round(value / 100) * 100} 字`;
  return `约 ${Math.round(value)} 字`;
}

export function ReflectionLetter({ result, disabled = false, onNavigate, onPerspectiveChange, onShuffle, letterRef, epilogue, emptyAction }: ReflectionLetterProps) {
  const { overview, themes, articles, sampledQuotes } = result;
  const heading = reflectionHeading(result.query);
  const hasContent = reflectionHasContent(result);
  const all = result.query.perspective.kind === 'all';
  const tags = themes.topTags.filter(tag => tag.count > 0);
  const day = overview.richestDay;
  const daySource = day?.previewSource;
  const dayFilename = daySource?.filename || day?.articles[0]?.filename;
  const time = overview.favoriteTimeBucket;
  const counts = [
    overview.activeDaysCount > 0 ? <span key="days">在 <strong className="reflection-number">{overview.activeDaysCount}</strong> 个日子落笔</span> : null,
    overview.dailyBlocksCount > 0 ? <span key="blocks">留下 <strong className="reflection-number">{overview.dailyBlocksCount}</strong> 段日常随想</span> : null,
    overview.titledArticlesCount > 0 ? <span key="articles">写下 <strong className="reflection-number">{overview.titledArticlesCount}</strong> 篇独立篇目</span> : null,
  ].filter(Boolean);
  const hasOverview = counts.length > 0 || !!day || !!(time && time.sampleCount > 0);
  const hasThemes = (all && (tags.length > 0 || themes.untaggedBlocksCount > 0)) || themes.deepWorks.length > 0;
  const navigate = (filename: string, target?: NoteTarget) => {
    if (!disabled) void onNavigate(filename, target);
  };
  const card = (label: string, filename: string, children: ReactNode, target?: NoteTarget, className = '') => (
    <button type="button" className={`reflection-card ${className}`} aria-label={label} disabled={disabled}
      onClick={() => navigate(filename, target)}>{children}</button>
  );
  const dayContent = day && <>
    <span className="reflection-eyebrow">丰盈的一天</span>
    <time className="reflection-card-title" dateTime={day.date}>{formatReflectionDate(day.date)}</time>
    <Tags tags={day.tags} />
    {day.untaggedBlocksCount > 0 && <span className="reflection-meta">你留下了 {day.untaggedBlocksCount} 则未命名的独白。</span>}
    {day.articles.length > 0 && <span className="reflection-meta">这一天的篇目：{day.articles.map(article => article.title).join('、')}</span>}
    {day.preview && <span className="reflection-excerpt">{day.preview}</span>}
    {dayFilename && <span className="reflection-card-trail">回到这一天 <span aria-hidden="true">↗</span></span>}
  </>;

  return <div ref={letterRef} className="reflection-letter" data-reflection-letter>
    <header className="reflection-letter-header">
      <p className="reflection-eyebrow">写给走过这段时光的你</p>
      <h1>{epilogue?.poeticTitle ?? heading.title}</h1>
      {epilogue && <p className="reflection-subtitle">{heading.title}</p>}
      <p className="reflection-subtitle">{heading.subtitle}</p>
      <span className="reflection-header-rule" aria-hidden="true" />
    </header>

    {!hasContent ? <div className="reflection-empty">
      <p>这段时光留白如纸，尚无落笔痕迹</p>
      {emptyAction && <div data-export-exclude>{emptyAction}</div>}
    </div> : <>
      {hasOverview && <Chapter title="光阴刻度">
        {counts.length > 0 && <p className="reflection-prose">这段时光里，你{counts.map((part, index) => <Fragment key={index}>{index > 0 && '，'}{part}</Fragment>)}。</p>}
        {time && time.sampleCount > 0 && <p className="reflection-prose">你常在{time.name}落笔，让思绪慢慢落在纸上。</p>}
        {day && (dayFilename
          ? card(`回到 ${day.date}`, dayFilename, dayContent, daySource?.contextAnchor ?? undefined, 'reflection-day')
          : <div className="reflection-card reflection-day">{dayContent}</div>)}
      </Chapter>}

      {hasThemes && <Chapter title="万象与深潜">
        {all && tags.length > 0 && <p className="reflection-prose">你的目光，常停留在<span className="reflection-inline-tags">{tags.map(tag => `#${tag.tag}`).join('、')}</span>。这些文字，留下了你在意的事。</p>}
        {all && themes.untaggedBlocksCount > 0 && <div className="reflection-untagged">
          <p className="reflection-prose">还有 {themes.untaggedBlocksCount} 则片段，你让它们自在地留在纸上，尚未命名。</p>
          <button type="button" className="reflection-text-action" aria-label="拾起未命名的瞬间" data-export-exclude disabled={disabled}
            onClick={() => { if (!disabled) onPerspectiveChange({ kind: 'untagged' }); }}>拾起未命名的瞬间 <span aria-hidden="true">↗</span></button>
        </div>}
        {themes.deepWorks.length > 0 && <div className="reflection-deep-works">
          <h3>字里行间的回响</h3>
          {themes.totalDistinctWorksCount > 0 && <p className="reflection-prose">你与 {themes.totalDistinctWorksCount} 部作品在文字里相遇。有些名字，值得再停留一会儿。</p>}
          {themes.deepWorks.map((work, index) => <div key={`${work.workName}:${index}`}>{card(`回到作品 · ${work.workName}`, work.representativeQuote.filename, <>
            <span className="reflection-card-title">《{work.workName}》</span>
            {(work.distinctDaysCount > 0 || work.mentionCount > 0 || work.effectiveChars > 0) && <span className="reflection-meta">{[
              work.distinctDaysCount > 0 ? `${work.distinctDaysCount} 个日子里的相遇` : '',
              work.mentionCount > 0 ? `${work.mentionCount} 次提及` : '',
              work.effectiveChars > 0 ? `着墨${approximateChars(work.effectiveChars)}` : '',
            ].filter(Boolean).join(' · ')}</span>}
            <span className="reflection-excerpt">{work.representativeQuote.content}</span>
          </>, work.representativeQuote.contextAnchor ?? undefined, 'reflection-work')}</div>)}
        </div>}
      </Chapter>}

      {(articles.longestBrewed.length > 0 || articles.mostReferenced.length > 0) && <Chapter title="慢火长卷">
        {articles.longestBrewed.length > 0 && <div className="reflection-article-group">
          <h3>与你慢慢生长</h3>
          {articles.longestBrewed.map(article => <div key={article.filename}>{card(`打开篇目 · ${article.title}`, article.filename, <>
            <span className="reflection-card-title">{article.title}</span>
            <span className="reflection-meta">始于 {formatReflectionDate(article.createdDate)}<br />最近写于 {formatReflectionDate(article.modifiedDate)}</span>
            {article.spanDays > 0 && <span className="reflection-prose">从初稿到这次落笔，陪伴了你 {article.spanDays} 天。</span>}
          </>)}</div>)}
        </div>}
        {articles.mostReferenced.length > 0 && <div className="reflection-article-group">
          <h3>被你再次想起</h3>
          {articles.mostReferenced.map(article => <div className="reflection-reference" key={article.filename}>
            {card(`打开篇目 · ${article.title}`, article.filename, <>
              <span className="reflection-card-title">{article.title}</span>
              {(article.sourceCount > 0 || article.referenceCount > 0) && <span className="reflection-meta">{[
                article.sourceCount > 0 ? `被 ${article.sourceCount} 篇其他文字回望` : '',
                article.referenceCount > 0 ? `共 ${article.referenceCount} 次` : '',
              ].filter(Boolean).join('，')}。</span>}
            </>)}
            {article.sources.map(source => <div key={source.filename}>{card(`回到回望来源 · ${source.title}`, source.filename, <>
              <span className="reflection-eyebrow">回望来自 · {source.title}</span>
              {source.referenceCount > 0 && <span className="reflection-meta">{source.referenceCount} 次回望</span>}
              {source.preview && <span className="reflection-excerpt">{source.preview}</span>}
            </>, source.contextAnchor ?? undefined, 'reflection-source')}</div>)}
          </div>)}
        </div>}
      </Chapter>}

      {sampledQuotes.length > 0 && <Chapter title="吉光片羽">
        <div className="reflection-chapter-intro"><p className="reflection-prose">再读一遍，与你当时的心绪相逢。</p>
          <button type="button" className="reflection-text-action" aria-label="换一束光" data-export-exclude disabled={disabled}
            onClick={() => { if (!disabled) onShuffle(); }}><span aria-hidden="true">↻</span> 换一束光</button>
        </div>
        {sampledQuotes.map(quote => <div key={`${quote.slot}:${quote.blockId}`}>{card(`回到${reflectionSlotLabel(quote.slot)} · ${quote.date}`, quote.filename, <>
          <span className="reflection-eyebrow">{reflectionSlotLabel(quote.slot)}</span>
          <span className="reflection-excerpt">{quote.content}</span>
          <span className="reflection-quote-footer"><time dateTime={quote.date}>{formatReflectionDate(quote.date)}</time><Tags tags={quote.tags} /></span>
        </>, quote.contextAnchor ?? undefined, 'reflection-quote')}</div>)}
      </Chapter>}
    </>}

    <div data-reflection-ai-slot>{epilogue && <section className="reflection-chapter reflection-ai-epilogue" aria-label="AI 时光按语">
      <h2 className="reflection-chapter-title">写在信笺的末尾</h2>
      <p className="reflection-prose" style={{ whiteSpace: 'pre-wrap' }}>{epilogue.epilogue}</p>
      <p className="reflection-meta">AI 按语 · 为这段时光而写</p>
    </section>}</div>
    <footer className="reflection-letter-seal"><span className="reflection-seal-mark" aria-hidden="true">拾遗</span>
      <span>Silens</span><span className="reflection-seal-note">留一页，给走过的时光</span>
    </footer>
  </div>;
}
