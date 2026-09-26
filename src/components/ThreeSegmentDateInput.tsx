import React from 'react';

export interface PartialDate {
  year?: number;
  month?: number; // 1-12
  day?: number;   // 1-31
}

// 极简三段日期输入：年 / 月 / 日 独立可编辑，任意一个有值即算"已输入"。
// 原生 <input type="date"> 在日历里只选月份/日不填全时 e.target.value 为空，
// 用户以为"改了但没反应"；分段输入彻底绕过该问题。
export const ThreeSegmentDateInput: React.FC<{
  value: PartialDate;
  onChange: (v: PartialDate) => void;
  size?: 'sm' | 'md';
  theme?: 'light' | 'var';
  label?: string;
}> = ({ value, onChange, size = 'md', theme = 'var', label }) => {
  const set = (i: number, raw: string) => {
    const next = { ...value };
    const num = raw === '' ? undefined : (parseInt(raw, 10) || undefined);
    if (i === 0) next.year = num;
    else if (i === 1) next.month = num;
    else next.day = num;
    onChange(next);
  };

  const yearEl = (v?: number) => (v === undefined ? '' : String(v));
  const monthEl = (v?: number) => (v === undefined ? '' : String(v).padStart(2, '0'));
  const dayEl = (v?: number) => (v === undefined ? '' : String(v).padStart(2, '0'));

  const segClass =
    theme === 'light'
      ? 'bg-transparent border-b border-gray-200 focus:outline-none focus:border-gray-400 font-mono'
      : 'bg-transparent border-b border-white/10 focus:outline-none focus:border-white/40 font-mono';

  const segStyle = theme === 'var' ? { color: 'var(--theme-text)' } : undefined;

  const handleFocus = (el: HTMLInputElement) => el.select();

  const segs: [keyof PartialDate, (n?: number) => string][] = [
    ['year', yearEl],
    ['month', monthEl],
    ['day', dayEl],
  ];

  return (
    <div className="flex items-center gap-1">
      {label && (
        <span
          className="text-[9px] font-mono tracking-widest uppercase opacity-40 shrink-0"
          style={theme === 'var' ? { color: 'var(--theme-text)' } : { color: '#9CA3AF' }}
        >
          {label}
        </span>
      )}
      {segs.map(([key, fmt], i) => (
        <React.Fragment key={key}>
          {i > 0 && (
            <span className="opacity-30 text-[10px]" style={segStyle}>–</span>
          )}
          <input
            inputMode="numeric"
            value={fmt(value[key])}
            onChange={(e) => {
              const raw = e.target.value.replace(/\D/g, '');
              set(i, raw);
            }}
            onFocus={(e) => handleFocus(e.target)}
            className={`${segClass} ${size === 'sm' ? 'text-[10px] w-8' : 'text-[13px] w-10'} px-1 py-0.5`}
            style={segStyle}
            placeholder={key === 'year' ? '年' : key === 'month' ? '月' : '日'}
          />
        </React.Fragment>
      ))}
    </div>
  );
};

// 从 PartialDate 推一个"足够完整"的 YYYY-MM-DD。
// 缺日 → 月末日；缺月 → 1 月；缺年 → 当前年。
// 这样"只改月份"或"只改日"都能立即得到可用的日期。
export const toPartialKey = (v: PartialDate): string => {
  const now = new Date();
  const year = v.year ?? now.getFullYear();
  const month = v.month ?? 1;
  const daysInMonth = new Date(year, month, 0).getDate();
  const day = Math.min(v.day ?? daysInMonth, daysInMonth);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};
