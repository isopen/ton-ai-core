import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
    manifest: '/manifest.json',
    title: 'TON AI Gram',
};

export const viewport: Viewport = {
    themeColor: '#0d0d0d',
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" style={{ overflow: 'hidden', height: '100%', background: '#0d0d0d' }}>
            <head>
                <link rel="apple-touch-icon" href="/icon.svg" />
                <meta name="apple-mobile-web-app-capable" content="yes" />
                <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
            </head>
            <body style={{ overflow: 'hidden', margin: 0, height: '100%' }}>{children}</body>
        </html>
    );
}
