'use client';
import dynamic from 'next/dynamic';
import { useMemo } from 'react';

const MapView = dynamic(() => import('@/components/MapView').then((m) => m.MapView), { ssr: false, loading: () => <div className="h-60 animate-pulse rounded-xl bg-slate-100" /> });

const KIND_COLOR: Record<string, string> = { CITIZEN: '#e53935', INSPECTION: '#7c3aed', PROGRESS: '#d97706', COMPLETION: '#1f7a3a', APPEAL: '#2957a4' };

export function ComplaintMiniMap({ lat, lng, accuracy, approx, points }: { lat: number; lng: number; accuracy: number | null; approx: boolean; points: { lat: number; lng: number; kind: string }[] }) {
  const markers = useMemo(() => [
    { lat, lng, icon: approx ? '≈' : '📍', color: '#e53935', radius: accuracy ?? undefined },
    ...points.filter((p) => p.kind !== 'CITIZEN').map((p) => ({ lat: p.lat, lng: p.lng, color: KIND_COLOR[p.kind], icon: p.kind === 'COMPLETION' ? '✓' : p.kind === 'INSPECTION' ? '🔍' : '•' })),
  ], [lat, lng, accuracy, approx, points]);
  if (lat == null || lng == null) return null;
  return <MapView markers={markers} zoom={17} height={240} />;
}
