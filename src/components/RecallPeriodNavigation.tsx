import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { calendarDate, periodLabel, periodRange, shiftPeriod, type RecallPeriod, type RecallUnit } from '../utils/recall';

const units: { unit: RecallUnit; label: string }[] = [
  { unit: 'week', label: '周' }, { unit: 'month', label: '月' }, { unit: 'year', label: '年' },
];

export function RecallPeriodNavigation({ period, fallbackAnchor, onChange }: {
  period?: RecallPeriod | null;
  fallbackAnchor?: string;
  onChange: (period: RecallPeriod) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [value, setValue] = useState('');
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const today = calendarDate(new Date().getTime() / 1000);
  const unit = period?.unit ?? 'month';
  const anchor = period?.anchor ?? fallbackAnchor ?? today;
  const current = period && periodRange(period).start === periodRange({ unit, anchor: today }).start;
  const unitLabel = units.find(item => item.unit === unit)!.label;

  useEffect(() => {
    if (!picking) return;
    input.current?.focus();
    const outside = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setPicking(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [picking]);

  const choose = (next: RecallPeriod) => { setPicking(false); onChange(next); };

  return <div className="recall-period" ref={container} onKeyDown={event => {
    if (event.key === 'Escape' && picking && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      setPicking(false);
      trigger.current?.focus();
    }
  }}>
    <div className="recall-period-units" role="group" aria-label="回顾周期">
      {units.map(item => <button key={item.unit} type="button" className="quiet-button" aria-pressed={period?.unit === item.unit}
        onClick={() => choose({ unit: item.unit, anchor })}>{item.label}</button>)}
    </div>
    {period && <>
      <div className="recall-period-heading">
        <button type="button" className="quiet-button recall-period-arrow" aria-label={`上一${unitLabel}`} onClick={() => choose(shiftPeriod(period, -1))}><ChevronLeft size={16} /></button>
        <button ref={trigger} type="button" className="quiet-button recall-period-title" aria-label="选择回顾周期" aria-expanded={picking} aria-haspopup="dialog" onClick={() => {
          setValue(unit === 'year' ? anchor.slice(0, 4) : unit === 'month' ? anchor.slice(0, 7) : anchor);
          setPicking(open => !open);
        }}>{periodLabel(period)}</button>
        <button type="button" className="quiet-button recall-period-arrow" aria-label={`下一${unitLabel}`} onClick={() => choose(shiftPeriod(period, 1))}><ChevronRight size={16} /></button>
      </div>
      {!current && <button type="button" className="quiet-button recall-period-today" onClick={() => choose({ unit, anchor: today })}>回到本{unitLabel}</button>}
    </>}
    {picking && period && <div role="dialog" aria-label="跳转到指定周期" className="recall-period-picker">
      <form onSubmit={event => {
        event.preventDefault();
        if (!value) return;
        const nextAnchor = unit === 'year' ? `${value.padStart(4, '0')}-01-01` : unit === 'month' ? `${value}-01` : value;
        choose({ unit, anchor: nextAnchor });
        trigger.current?.focus();
      }}>
        <label htmlFor="recall-period-input">{unit === 'year' ? '选择年份' : unit === 'month' ? '选择月份' : '选择一周内的日期'}</label>
        <input ref={input} id="recall-period-input" type={unit === 'year' ? 'number' : unit === 'month' ? 'month' : 'date'} required
          min={unit === 'year' ? '1' : unit === 'month' ? '0001-01' : '0001-01-01'} max={unit === 'year' ? '9999' : unit === 'month' ? '9999-12' : '9999-12-31'}
          value={value} onChange={event => setValue(event.target.value)} />
        <div className="flex items-center justify-between gap-3">
          <button type="submit" className="quiet-button rounded px-2 py-1" disabled={!value}>查看</button>
          <button type="button" className="quiet-button rounded p-1" aria-label="关闭周期选择" onClick={() => { setPicking(false); trigger.current?.focus(); }}><X size={14} /></button>
        </div>
      </form>
    </div>}
  </div>;
}
