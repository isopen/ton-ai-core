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
        <html lang="en" suppressHydrationWarning style={{ overflow: 'hidden', height: '100%' }}>
            <head>
                <script dangerouslySetInnerHTML={{
                    __html: `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)tg-theme=([^;]*)/);if(m){var t=m[1];document.documentElement.setAttribute('data-theme',t);document.documentElement.style.background=t==='light'?'#ffffff':'#121212'}}catch(e){}})()`
                }} />
                <link rel="apple-touch-icon" href="/icon.svg" />
                <meta name="apple-mobile-web-app-capable" content="yes" />
                <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
            </head>
            <body style={{ overflow: 'hidden', margin: 0, height: '100%' }}>{children}</body>
        </html>
    );
}
