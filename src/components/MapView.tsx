'use client';
import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

export interface MapMarker {
  lat: number;
  lng: number;
  color?: string;
  icon?: string;
  html?: string; // popup HTML (escaped by caller)
  href?: string;
  radius?: number; // accuracy circle in metres
}

/** Lightweight Leaflet map (OpenStreetMap tiles). */
export function MapView({ markers, center, zoom = 15, height = 260, fit = true }: { markers: MapMarker[]; center?: [number, number]; zoom?: number; height?: number | string; fit?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !el.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(el.current, { scrollWheelZoom: false, attributionControl: true }).setView(center ?? [markers[0]?.lat ?? 11.1646, markers[0]?.lng ?? 77.6035], zoom);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapRef.current);
        layerRef.current = L.layerGroup().addTo(mapRef.current);
      }
      const layer = layerRef.current!;
      layer.clearLayers();
      const pts: [number, number][] = [];
      for (const m of markers) {
        const icon = L.divIcon({
          className: '',
          html: `<div class="nu-marker" style="width:28px;height:28px;background:${m.color ?? '#e53935'}">${m.icon ?? ''}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
        const mk = L.marker([m.lat, m.lng], { icon }).addTo(layer);
        if (m.html) mk.bindPopup(m.html);
        if (m.href && !m.html) mk.on('click', () => { window.location.href = m.href!; });
        if (m.radius) L.circle([m.lat, m.lng], { radius: m.radius, color: m.color ?? '#2957a4', weight: 1, fillOpacity: 0.08 }).addTo(layer);
        pts.push([m.lat, m.lng]);
      }
      if (fit && pts.length > 1) mapRef.current.fitBounds(pts, { padding: [30, 30], maxZoom: 17 });
      else if (pts.length === 1) mapRef.current.setView(pts[0], zoom);
    })();
    return () => { cancelled = true; };
  }, [markers, center, zoom, fit]);

  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null; }, []);

  return <div ref={el} style={{ height }} className="z-0 w-full overflow-hidden rounded-xl border border-slate-200" />;
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
