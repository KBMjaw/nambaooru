'use client';
import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import { useI18n } from '@/i18n/client';
import type { MessageKey } from '@/i18n';
import { STATUS_COLOR } from '@/components/badges';
import { escapeHtml } from '@/components/MapView';

const MapView = dynamic(() => import('@/components/MapView').then((m) => m.MapView), { ssr: false, loading: () => <div className="h-72 animate-pulse rounded-xl bg-slate-100" /> });

export interface MapComplaint { code: string; lat: number; lng: number; status: string; priority: string; icon: string | null; category_en: string; category_ta: string; ward_number: number | null; approx: boolean }

export function ComplaintsMap({ items, height = 420, linkBase = '/office/complaints' }: { items: MapComplaint[]; height?: number; linkBase?: string }) {
  const { t, lang } = useI18n();
  const markers = useMemo(() => items.map((c) => ({
    lat: c.lat, lng: c.lng, color: STATUS_COLOR[c.status] ?? '#64748b', icon: c.icon ?? '📌',
    html: `<div style="min-width:170px"><b>${escapeHtml(c.code)}</b><br/>${escapeHtml(lang === 'ta' ? c.category_ta : c.category_en)}<br/>` +
      `${escapeHtml(t(`status.${c.status}` as MessageKey))} · ${escapeHtml(t(`priority.${c.priority}` as MessageKey))}<br/>` +
      `${c.ward_number != null ? `${escapeHtml(t('complaint.ward'))} ${c.ward_number}` : ''}${c.approx ? ' (≈)' : ''}<br/>` +
      `<a href="${linkBase}/${encodeURIComponent(c.code)}" style="color:#1d4589;font-weight:700">${escapeHtml(t('office.openDetail'))} →</a></div>`,
  })), [items, lang, t, linkBase]);
  const present = [...new Set(items.map((i) => i.status))];
  return (
    <div>
      <MapView markers={markers} height={height} zoom={14} center={items.length ? undefined : [11.1646, 77.6035]} />
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
        {present.map((s) => (
          <span key={s} className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full border-2 border-white shadow" style={{ background: STATUS_COLOR[s] }} />{t(`status.${s}` as MessageKey)}</span>
        ))}
        <span className="text-slate-400">· {t('office.mapHint')} (≈ = ward centre, no GPS)</span>
      </div>
    </div>
  );
}
