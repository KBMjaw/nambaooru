'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import type * as Leaflet from 'leaflet';
import { useI18n } from '@/i18n/client';
import { trMsg } from '@/i18n';
import { api } from '@/lib/client-api';
import { Alert } from '@/components/ui';
import { ConfirmDialog } from '@/components/Modal';
import { escapeHtml } from '@/components/MapView';

/** Tooltip content as a text node: user-supplied names are never parsed as HTML (Leaflet treats strings as innerHTML). */
function textTip(s: string): HTMLElement {
  const el = document.createElement('span');
  el.textContent = s;
  return el;
}

export interface Feature { id: number; feature_type: string; geometry_type: string; geometry: { type: string; coordinates: unknown }; radius_m: number | null; name: string | null; description: string | null; updated_by_name: string | null }
export interface ComplaintPin { code: string; status: string; priority: string; latitude: number; longitude: number; title_en: string | null; icon: string | null }

export const FEATURE_TYPES = ['BOUNDARY', 'STREET', 'DRAINAGE', 'STREETLIGHT', 'WORK_ZONE', 'PUBLIC_ASSET', 'PROBLEM_ZONE', 'OTHER'] as const;
export const FEATURE_COLOR: Record<string, string> = {
  BOUNDARY: '#2957a4', STREET: '#475569', DRAINAGE: '#0284c7', STREETLIGHT: '#d97706', WORK_ZONE: '#e08a1e', PUBLIC_ASSET: '#16a34a', PROBLEM_ZONE: '#dc2626', OTHER: '#7c3aed',
};
const ICON: Record<string, string> = { BOUNDARY: '⬛', STREET: '🛣️', DRAINAGE: '🌊', STREETLIGHT: '💡', WORK_ZONE: '🚧', PUBLIC_ASSET: '🏛️', PROBLEM_ZONE: '⚠️', OTHER: '📍' };

type Drawn = { layer: Leaflet.Layer; geometryType: string; geometry: unknown; radiusM: number | null };

function layerGeometry(layer: Leaflet.Layer): Omit<Drawn, 'layer'> {
  const l = layer as Leaflet.Layer & { getRadius?: () => number; getLatLng?: () => Leaflet.LatLng; toGeoJSON: () => GeoJSON.Feature };
  if (typeof l.getRadius === 'function' && typeof l.getLatLng === 'function' && !(layer as { _icon?: unknown })._icon) {
    const c = l.getLatLng();
    return { geometryType: 'Circle', geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, radiusM: Math.round(l.getRadius()) };
  }
  const g = l.toGeoJSON().geometry as { type: string; coordinates: unknown };
  return { geometryType: g.type, geometry: g, radiusM: null };
}

/** Draw / edit ward boundaries and assets (Leaflet + Geoman). Saved to the database through the API; the API re-checks jurisdiction. */
export function WardMapEditor({ wardId, portal, canEdit, center, initialFeatures, complaints, complaintBase }: {
  wardId: number; portal: 'ADMIN' | 'OFFICE'; canEdit: boolean; center: [number, number]; initialFeatures: Feature[]; complaints: ComplaintPin[]; complaintBase: string;
}) {
  const { t } = useI18n();
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const featLayer = useRef<Leaflet.FeatureGroup | null>(null);
  const layersById = useRef(new Map<number, Leaflet.Layer>());
  const [features, setFeatures] = useState<Feature[]>(initialFeatures);
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const [form, setForm] = useState({ featureType: 'BOUNDARY', name: '', description: '' });
  const [editing, setEditing] = useState<Feature | null>(null);
  const [archive, setArchive] = useState<Feature | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [filter, setFilter] = useState<string>('');
  const q = `?portal=${portal}`;

  const reload = useCallback(async () => {
    const r = await api<{ features: Feature[] }>(`/api/ward-maps?ward=${wardId}&portal=${portal}`);
    setFeatures(r.features);
  }, [wardId, portal]);

  // Map init (once)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      await import('@geoman-io/leaflet-geoman-free');
      if (cancelled || !el.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(el.current, { scrollWheelZoom: true }).setView(center, 16);
      mapRef.current = map;
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, attribution: '© OpenStreetMap' }).addTo(map);
      featLayer.current = L.featureGroup().addTo(map);
      const pins = L.layerGroup().addTo(map);
      for (const c of complaints) {
        const icon = L.divIcon({ className: '', html: `<div class="nu-marker" style="width:26px;height:26px;background:${c.priority === 'HIGH' || c.priority === 'CRITICAL' ? '#dc2626' : '#2957a4'}">${escapeHtml(c.icon ?? '•')}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
        const m = L.marker([c.latitude, c.longitude], { icon, pmIgnore: true } as Leaflet.MarkerOptions).addTo(pins);
        m.bindTooltip(textTip(`${c.code} · ${c.status}`));
        m.on('click', () => { window.location.href = `${complaintBase}/${encodeURIComponent(c.code)}`; });
      }
      if (canEdit) {
        const pm = (map as unknown as { pm: { addControls: (o: object) => void; setGlobalOptions: (o: object) => void } }).pm;
        pm.addControls({ position: 'topleft', drawMarker: true, drawPolyline: true, drawPolygon: true, drawRectangle: true, drawCircle: true, drawCircleMarker: false,
          drawText: false, editMode: true, dragMode: true, cutPolygon: false, removalMode: false, rotateMode: false });
        pm.setGlobalOptions({ snappable: true, continueDrawing: false });
        map.on('pm:create', (e: unknown) => {
          const layer = (e as { layer: Leaflet.Layer }).layer;
          setDrawn({ layer, ...layerGeometry(layer) });
        });
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null; }, []);

  // (Re)draw saved features whenever the list changes
  useEffect(() => {
    let alive = true;
    const draw = () => {
      const L = LRef.current; const group = featLayer.current;
      if (!L || !group) { if (alive) setTimeout(draw, 150); return; }
      group.clearLayers(); layersById.current.clear();
      const bounds: Leaflet.LatLngExpression[] = [];
      for (const f of features.filter((x) => !filter || x.feature_type === filter)) {
        const color = FEATURE_COLOR[f.feature_type] ?? '#2957a4';
        let layer: Leaflet.Layer;
        if (f.geometry_type === 'Circle') {
          const [lng, lat] = f.geometry.coordinates as [number, number];
          layer = L.circle([lat, lng], { radius: f.radius_m ?? 10, color, weight: 2, fillOpacity: 0.15 });
          bounds.push([lat, lng]);
        } else if (f.geometry_type === 'Point') {
          const [lng, lat] = f.geometry.coordinates as [number, number];
          layer = L.marker([lat, lng], { icon: L.divIcon({ className: '', html: `<div class="nu-marker" style="width:24px;height:24px;background:${color}">${ICON[f.feature_type] ?? '📍'}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }) });
          bounds.push([lat, lng]);
        } else {
          const gj = L.geoJSON(f.geometry as GeoJSON.Geometry, { style: { color, weight: f.feature_type === 'BOUNDARY' ? 3 : 4, fillOpacity: f.feature_type === 'BOUNDARY' ? 0.06 : 0.18, dashArray: f.feature_type === 'DRAINAGE' ? '6 4' : undefined } });
          layer = gj.getLayers()[0];
          const b = gj.getBounds(); bounds.push(b.getNorthEast(), b.getSouthWest());
        }
        (layer as Leaflet.Layer & { bindTooltip: (c: HTMLElement) => void }).bindTooltip(textTip(`${ICON[f.feature_type] ?? ''} ${f.name ?? f.feature_type}`));
        if (canEdit) {
          layer.on('pm:edit', async () => {
            const g = layerGeometry(layer);
            try { await api(`/api/ward-maps/${f.id}${q}`, { method: 'PATCH', body: { geometry: g.geometry, geometryType: g.geometryType, radiusM: g.radiusM } }); setMsg({ tone: 'success', text: `${f.name ?? f.feature_type}: ${t('profile.saved')}` }); }
            catch (e) { setMsg({ tone: 'error', text: trMsg(t, (e as Error).message) }); }
          });
        }
        group.addLayer(layer);
        layersById.current.set(f.id, layer);
      }
      if (bounds.length && mapRef.current) mapRef.current.fitBounds(L.latLngBounds(bounds as Leaflet.LatLngExpression[]), { padding: [30, 30], maxZoom: 18 });
    };
    draw();
    return () => { alive = false; };
  }, [features, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveDrawn() {
    if (!drawn) return;
    setMsg(null);
    try {
      await api(`/api/ward-maps${q}`, { body: { wardId, featureType: form.featureType, geometryType: drawn.geometryType, geometry: drawn.geometry, radiusM: drawn.radiusM, name: form.name || null, description: form.description || null } });
      mapRef.current?.removeLayer(drawn.layer);
      setDrawn(null); setForm({ featureType: form.featureType, name: '', description: '' });
      await reload();
      setMsg({ tone: 'success', text: t('admin.featureSaved') });
    } catch (e) { setMsg({ tone: 'error', text: trMsg(t, (e as Error).message) }); }
  }
  async function saveMeta() {
    if (!editing) return;
    try { await api(`/api/ward-maps/${editing.id}${q}`, { method: 'PATCH', body: { featureType: editing.feature_type, name: editing.name, description: editing.description } }); setEditing(null); await reload(); }
    catch (e) { setMsg({ tone: 'error', text: trMsg(t, (e as Error).message) }); }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-2">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        {canEdit && <p className="text-xs text-slate-500">✏️ {t('admin.drawHelp')}</p>}
        <div ref={el} style={{ height: 520 }} className="z-0 w-full overflow-hidden rounded-xl border border-slate-200" />
        <div className="flex flex-wrap gap-2 text-xs">
          {FEATURE_TYPES.map((ft) => <span key={ft} className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: FEATURE_COLOR[ft] }} />{t(`feature.${ft}` as never)}</span>)}
          <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full bg-navy-600" />{t('nav.complaints')}</span>
        </div>
      </div>
      <div className="space-y-3">
        {drawn && (
          <div className="card space-y-2 border-navy-200 p-3">
            <p className="font-bold">➕ {t('admin.newFeature')} ({drawn.geometryType}{drawn.radiusM ? ` · ${drawn.radiusM} m` : ''})</p>
            <select className="input" value={form.featureType} onChange={(e) => setForm((s) => ({ ...s, featureType: e.target.value }))}>
              {FEATURE_TYPES.map((ft) => <option key={ft} value={ft}>{t(`feature.${ft}` as never)}</option>)}
            </select>
            <input className="input" placeholder={t('admin.featureName')} value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
            <textarea className="input" rows={2} placeholder={t('admin.description')} value={form.description} onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))} />
            <div className="flex gap-2">
              <button className="btn btn-outline btn-sm" onClick={() => { mapRef.current?.removeLayer(drawn.layer); setDrawn(null); }}>{t('common.cancel')}</button>
              <button className="btn btn-primary btn-sm" onClick={saveDrawn}>{t('common.save')}</button>
            </div>
          </div>
        )}
        <div className="card p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="font-bold">🗂️ {t('admin.features')} ({features.length})</p>
            <select className="input w-40 py-1 text-xs" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">{t('common.all')}</option>{FEATURE_TYPES.map((ft) => <option key={ft} value={ft}>{t(`feature.${ft}` as never)}</option>)}
            </select>
          </div>
          {features.length === 0 ? <p className="text-sm text-slate-500">{canEdit ? t('admin.noFeaturesEdit') : t('admin.noFeatures')}</p> : (
            <ul className="max-h-[420px] space-y-1.5 overflow-y-auto text-sm">
              {features.filter((x) => !filter || x.feature_type === filter).map((f) => (
                <li key={f.id} className="rounded-lg border border-slate-100 p-2">
                  {editing?.id === f.id ? (
                    <div className="space-y-1.5">
                      <select className="input py-1" value={editing.feature_type} onChange={(e) => setEditing({ ...editing, feature_type: e.target.value })}>
                        {FEATURE_TYPES.map((ft) => <option key={ft} value={ft}>{t(`feature.${ft}` as never)}</option>)}
                      </select>
                      <input className="input py-1" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder={t('admin.featureName')} />
                      <textarea className="input py-1" rows={2} value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
                      <div className="flex gap-1"><button className="btn btn-outline btn-sm" onClick={() => setEditing(null)}>{t('common.cancel')}</button><button className="btn btn-primary btn-sm" onClick={saveMeta}>{t('common.save')}</button></div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <button className="min-w-0 text-left [overflow-wrap:anywhere]" onClick={() => { const l = layersById.current.get(f.id) as (Leaflet.Layer & { getBounds?: () => Leaflet.LatLngBounds; getLatLng?: () => Leaflet.LatLng }) | undefined; if (l?.getBounds) mapRef.current?.fitBounds(l.getBounds(), { maxZoom: 19 }); else if (l?.getLatLng) mapRef.current?.setView(l.getLatLng(), 19); }}>
                        <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: FEATURE_COLOR[f.feature_type] }} />
                        <b>{f.name || t(`feature.${f.feature_type}` as never)}</b> <span className="text-xs text-slate-500">{f.geometry_type}{f.radius_m ? ` · ${Math.round(f.radius_m)} m` : ''}</span>
                        {f.description && <div className="text-xs text-slate-600">{f.description}</div>}
                        {f.updated_by_name && <div className="text-[10px] text-slate-400">{f.updated_by_name}</div>}
                      </button>
                      {canEdit && <div className="flex shrink-0 gap-1"><button className="btn btn-ghost btn-sm" onClick={() => setEditing(f)}>✏️</button><button className="btn btn-ghost btn-sm text-red-600" onClick={() => setArchive(f)} aria-label={t('admin.archive')}>🗑️</button></div>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <ConfirmDialog open={!!archive} onClose={() => setArchive(null)} reasonRequired danger title={`${t('admin.archive')}: ${archive?.name ?? archive?.feature_type ?? ''}`} message={t('admin.archiveMsg')}
        confirmLabel={t('admin.archive')}
        onConfirm={async (reason) => {
          try { await api(`/api/ward-maps/${archive!.id}${q}`, { method: 'PATCH', body: { status: 'INACTIVE', reason } }); setArchive(null); await reload(); }
          catch (e) { setMsg({ tone: 'error', text: trMsg(t, (e as Error).message) }); setArchive(null); }
        }} />
    </div>
  );
}
