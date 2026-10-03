/**
 * Minimal, server-rendered charts (no client JS): thin bars with 4px rounded data-ends,
 * values in text ink, hover tooltips, legend for multi-series, and a table view.
 * Palette validated for CVD separation (navy #2957a4 / orange #e08a1e).
 */
export const SERIES = { primary: '#2957a4', secondary: '#e08a1e' };

export function BarList({ items, unit = '', empty = '—' }: { items: { label: string; value: number; href?: string }[]; unit?: string; empty?: string }) {
  if (!items.length) return <p className="py-6 text-center text-sm text-slate-400">{empty}</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-2">
      {items.map((it) => {
        const inner = (
          <>
            <span className="w-28 shrink-0 truncate text-sm text-slate-600 sm:w-36" title={it.label}>{it.label}</span>
            <span className="relative flex h-3.5 flex-1 items-center">
              <span className="h-3.5 rounded-r-[4px]" style={{ width: `${Math.max(2, (it.value / max) * 100)}%`, background: SERIES.primary }} />
              <span className="pointer-events-none absolute -top-8 left-0 z-10 hidden whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow group-hover:block">
                {it.label}: {it.value.toLocaleString('en-IN')}{unit}
              </span>
            </span>
            <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-800">{it.value.toLocaleString('en-IN')}{unit}</span>
          </>
        );
        return (
          <li key={it.label}>
            {it.href ? <a href={it.href} className="group flex items-center gap-2 rounded hover:bg-slate-50">{inner}</a> : <div className="group flex items-center gap-2">{inner}</div>}
          </li>
        );
      })}
    </ul>
  );
}

export function MonthlyColumns({ data, labels }: { data: { month: string; a: number; b: number }[]; labels: { a: string; b: string; table: string; month: string } }) {
  if (!data.length) return <p className="py-6 text-center text-sm text-slate-400">—</p>;
  const max = Math.max(...data.flatMap((d) => [d.a, d.b]), 1);
  const nice = Math.ceil(max / 5) * 5 || 5;
  const H = 140;
  return (
    <div>
      <div className="mb-2 flex gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES.primary }} />{labels.a}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES.secondary }} />{labels.b}</span>
      </div>
      <div className="relative flex items-end gap-3 border-b border-slate-200 pl-7" style={{ height: H }}>
        <span className="absolute left-0 top-0 text-[10px] text-slate-400">{nice}</span>
        <span className="absolute left-0 bottom-0 text-[10px] text-slate-400">0</span>
        <span className="absolute left-7 right-0 top-0 border-t border-slate-100" />
        {data.map((d) => (
          <div key={d.month} className="group relative flex flex-1 items-end justify-center gap-[2px]" style={{ height: H }}>
            <span className="w-full max-w-[18px] rounded-t-[4px]" style={{ height: `${(d.a / nice) * 100}%`, background: SERIES.primary, minHeight: d.a ? 2 : 0 }} />
            <span className="w-full max-w-[18px] rounded-t-[4px]" style={{ height: `${(d.b / nice) * 100}%`, background: SERIES.secondary, minHeight: d.b ? 2 : 0 }} />
            <span className="pointer-events-none absolute -top-12 z-10 hidden whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow group-hover:block">
              {d.month}<br />{labels.a}: {d.a} · {labels.b}: {d.b}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-3 pl-7 pt-1">
        {data.map((d) => <span key={d.month} className="flex-1 text-center text-[10px] text-slate-500">{d.month}</span>)}
      </div>
      <details className="mt-2 text-xs text-slate-600">
        <summary className="cursor-pointer select-none text-slate-500">{labels.table}</summary>
        <table className="table-std mt-1">
          <thead><tr><th>{labels.month}</th><th>{labels.a}</th><th>{labels.b}</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.month}><td>{d.month}</td><td>{d.a}</td><td>{d.b}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}

/** Donut-free proportion meter for a single rate (e.g. SLA compliance). */
export function Meter({ value, label }: { value: number | null; label: string }) {
  const v = value == null ? null : Math.round(value);
  return (
    <div>
      <div className="flex items-baseline justify-between"><span className="text-sm text-slate-600">{label}</span><span className="text-2xl font-extrabold text-slate-800">{v == null ? '—' : `${v}%`}</span></div>
      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${v ?? 0}%`, background: SERIES.primary }} /></div>
    </div>
  );
}
