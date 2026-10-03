import Link from 'next/link';

export function Tabs({ tabs, active, base }: { tabs: [string, string][]; active: string; base: string }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map(([k, label]) => (
        <Link key={k} href={`${base}?tab=${k}`} className={`whitespace-nowrap rounded-t-lg px-3 py-2 text-sm font-semibold ${active === k ? 'border border-b-white border-slate-200 bg-white text-navy-800' : 'text-slate-500 hover:text-slate-800'}`}>{label}</Link>
      ))}
    </div>
  );
}
