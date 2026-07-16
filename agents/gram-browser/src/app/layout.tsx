import type { Metadata } from 'next';

export const metadata: Metadata = {};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" style={{ overflow: 'hidden', height: '100%', background: '#0d0d0d' }}>
            <body style={{ overflow: 'hidden', margin: 0, height: '100%' }}>{children}</body>
        </html>
    );
}
