import type { Metadata, Viewport } from 'next';
import { Noto_Sans_Tamil, Noto_Sans } from 'next/font/google';
import './globals.css';
import { I18nProvider } from '@/i18n/client';
import { getLang } from '@/i18n/server';

const tamil = Noto_Sans_Tamil({ subsets: ['tamil', 'latin'], variable: '--font-noto-tamil', display: 'swap' });
const latin = Noto_Sans({ subsets: ['latin'], variable: '--font-noto', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'நம்ம ஊர் · Namma Ooru', template: '%s · Namma Ooru' },
  description: 'Single Window Civic Complaint & Resolution Portal — report civic problems in Tamil or English, track them to resolution.',
  applicationName: 'Namma Ooru',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: '#1f7a3a',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={lang} className={`${tamil.variable} ${latin.variable}`}>
      <body className="min-h-dvh antialiased">
        <I18nProvider lang={lang}>{children}</I18nProvider>
      </body>
    </html>
  );
}
