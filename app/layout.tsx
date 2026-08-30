import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';
import MergeShell from './MergeShell';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Template',
  description: 'Private, browser-based PDF mail merge.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} antialiased`}>
        <MergeShell />
        <div hidden>{children}</div>
      </body>
    </html>
  );
}
