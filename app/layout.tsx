/**
 * Root layout: fonts (next/font/local, self-hosted woff2 in app/fonts), metadata, and the pre-paint boot script
 * that sets html[data-mode] = 'immersive' | 'static' before first paint (no JS → no attribute → the
 * CSS renders the static layout). html.scroll-locked is server-rendered so the page cannot scroll
 * under the loading screen before hydration (it only applies in immersive mode; see lib/scroll.ts).
 */
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import localFont from 'next/font/local';
import { SITE } from '@/data/chapters';
import './globals.css';

// Self-hosted latin subsets (SIL OFL 1.1, see app/fonts/OFL.txt): no network needed at build time.
const serif = localFont({
  src: [
    { path: './fonts/InstrumentSerif-Regular-latin.woff2', weight: '400', style: 'normal' },
    { path: './fonts/InstrumentSerif-Italic-latin.woff2', weight: '400', style: 'italic' },
  ],
  display: 'swap',
  variable: '--font-instrument-serif',
  fallback: ['ui-serif', 'Georgia', 'serif'],
});
const sans = localFont({
  src: './fonts/Geist-Variable-latin.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-geist-sans',
  fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
});
const mono = localFont({
  src: './fonts/GeistMono-Variable-latin.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-geist-mono',
  fallback: ['ui-monospace', 'SFMono-Regular', 'monospace'],
});

export const metadata: Metadata = {
  title: SITE.title,
  description: SITE.description,
  openGraph: { title: SITE.title, description: SITE.description, type: 'website' },
  twitter: { card: 'summary', title: SITE.title, description: SITE.description },
};

export const viewport: Viewport = {
  themeColor: '#020308',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

// Runs before first paint. WebGPU present, or a WebGL2 context can be created → immersive.
const BOOT = `(function(){try{var d=document.documentElement,m='static';if('gpu' in navigator){m='immersive'}else{var c=document.createElement('canvas');if(c.getContext('webgl2'))m='immersive'}d.dataset.mode=m}catch(e){document.documentElement.dataset.mode='static'}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable} scroll-locked`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
