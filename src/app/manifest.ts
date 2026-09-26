import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Namma Ooru — நம்ம ஊர்',
    short_name: 'Namma Ooru',
    description: 'Report civic problems in Tamil or English and track them to resolution.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f6f8f5',
    theme_color: '#1f7a3a',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
