import type { Metadata } from 'next';
import './globals.css';
import MergeShell from './MergeShell';

export const dynamic = 'force-static';

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
      <body className="antialiased">
        <MergeShell />
        <div hidden>{children}</div>
      </body>
    </html>
  );
}
