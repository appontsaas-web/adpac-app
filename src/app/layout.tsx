import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AdPac — Google Ads AI Management',
  description: 'AI-assisted Google Ads management, phase 1.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
