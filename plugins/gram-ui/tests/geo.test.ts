/**
 * @jest-environment jsdom
 */

import { render } from '@ton-ai/atom';
import { GeoBubble } from '../dist/components/geo-bubble.js';
import { PollBubble } from '../dist/components/poll-bubble.js';
import { getMediaType, geoCoords, geoMapsUrl, geoEmbedUrl, geoExternalUrl, currentMapProvider, isMapEmbeddable, buildPeerBlurThumb, resolveAvatar, resolveDisplayPeer } from '../dist/utils.js';

if (typeof (global as any).IntersectionObserver === 'undefined') {
    (global as any).IntersectionObserver = class {
        private cb: any;
        constructor(cb: any) {
            this.cb = cb;
            ((global as any).__geoIO = (global as any).__geoIO || []).push(this);
        }
        observe(t: any) { setTimeout(() => { try { this.cb([{ isIntersecting: true, target: t }]); } catch {} }, 0); }
        unobserve() {}
        disconnect() {}
    };
}

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
    const flat: any[] = [];
    const push = (c: any) => {
        if (c == null || c === false || c === true) return;
        if (Array.isArray(c)) { c.forEach(push); return; }
        if (typeof c === 'string' || typeof c === 'number') {
            flat.push({ type: 'TEXT_NODE', props: { nodeValue: String(c) }, children: [], key: null });
        } else {
            flat.push(c);
        }
    };
    children.forEach(push);
    const p = { ...props };
    if (children.length > 0) p.children = children.length === 1 ? children[0] : children;
    return { type, props: p, children: flat, key: (props as any)?.key ?? null };
}

function mount(node: any): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Comp: any = () => node;
    render(Comp, container);
    return container;
}

const geoPoint = { _: 'geoPoint', long: 37.6176, lat: 55.7558, access_hash: 1 };
const geoMsg = (media: any, message = '') => ({
    id: 9001, date: 1788697000, out: false, sender: 'U', message, entities: [],
    media,
});

describe('geo media routing', () => {
    test('valid geo/venue/geolive map to geo kind', () => {
        expect(getMediaType({ _: 'messageMediaGeo', geo: geoPoint })).toBe('geo');
        expect(getMediaType({ _: 'messageMediaVenue', geo: geoPoint, title: 'T', address: 'A', provider: 'foursquare', venue_id: '1', venue_type: 'cafe' })).toBe('geo');
        expect(getMediaType({ _: 'messageMediaGeoLive', geo: geoPoint, period: 900 })).toBe('geo');
        expect(getMediaType(geoMsg({ _: 'messageMediaGeo', geo: geoPoint }).media)).toBe('geo');
        expect(getMediaType(geoMsg({ _: 'messageMediaGeoLive', geo: geoPoint, period: 900 }).media)).toBe('geo');
        expect(getMediaType(geoMsg({ _: 'messageMediaVenue', geo: geoPoint, title: 'T', address: 'A', provider: 'p', venue_id: '1', venue_type: 't' }).media)).toBe('geo');
    });

    test('empty or invalid coords stay unknown', () => {
        expect(getMediaType({ _: 'messageMediaGeo', geo: { _: 'geoPointEmpty' } })).toBe('unknown');
        expect(getMediaType({ _: 'messageMediaGeo' })).toBe('unknown');
        expect(getMediaType({ _: 'messageMediaVenue', geo: { _: 'geoPoint', long: 500, lat: 55 } })).toBe('unknown');
        expect(getMediaType({ _: 'messageMediaGeoLive', geo: { _: 'geoPoint', long: NaN, lat: 55 } })).toBe('unknown');
        expect(getMediaType(geoMsg({ _: 'messageMediaGeo', geo: { _: 'geoPointEmpty' } }).media)).toBe('unknown');
        expect(geoCoords({ _: 'messageMediaGeo' })).toBeNull();
    });

    test('maps url carries coords', () => {
        expect(geoMapsUrl(55.7558, 37.6176)).toBe('https://www.google.com/maps/search/?api=1&query=55.7558,37.6176');
    });

    test('embed and external urls follow provider', () => {
        expect(geoEmbedUrl(55.7558, 37.6176, 'google')).toBe('https://maps.google.com/maps?q=55.7558,37.6176&z=15&output=embed');
        expect(geoExternalUrl(55.7558, 37.6176, 'google')).toBe('https://www.google.com/maps/search/?api=1&query=55.7558,37.6176');
        expect(geoEmbedUrl(55.7558, 37.6176, 'yandex')).toBe('https://yandex.ru/map-widget/v1/?ll=37.6176%2C55.7558&z=15&pt=37.6176,55.7558,pm2rdm');
        expect(geoExternalUrl(55.7558, 37.6176, 'yandex')).toBe('https://yandex.ru/maps/?ll=37.6176%2C55.7558&z=15');
        expect(geoEmbedUrl(55.7558, 37.6176, 'dgis')).toBe('https://2gis.ru/?m=37.6176%2C55.7558%2F15');
        expect(geoExternalUrl(55.7558, 37.6176, 'dgis')).toBe('https://2gis.ru/?m=37.6176%2C55.7558%2F15');
        expect(isMapEmbeddable('google')).toBe(true);
        expect(isMapEmbeddable('yandex')).toBe(true);
        expect(isMapEmbeddable('dgis')).toBe(false);
    });

    test('current provider defaults to google', () => {
        try { delete (document.documentElement as any).dataset.mapProvider; } catch {}
        expect(currentMapProvider()).toBe('google');
        try { (document.documentElement as any).dataset.mapProvider = 'yandex'; } catch {}
        expect(currentMapProvider()).toBe('yandex');
        expect(geoEmbedUrl(55.7558, 37.6176)).toContain('yandex.ru');
        try { (document.documentElement as any).dataset.mapProvider = 'dgis'; } catch {}
        expect(currentMapProvider()).toBe('dgis');
        expect(geoEmbedUrl(55.7558, 37.6176)).toContain('2gis.ru');
        expect(geoExternalUrl(55.7558, 37.6176)).toContain('2gis.ru');
        try { (document.documentElement as any).dataset.mapProvider = 'unknown'; } catch {}
        expect(currentMapProvider()).toBe('google');
        try { (document.documentElement as any).dataset.mapProvider = 'google'; } catch {}
        expect(currentMapProvider()).toBe('google');
    });
});

describe('GeoBubble', () => {
    test('geo renders map with pin and no live badge', () => {
        const c = mount(h(GeoBubble as any, { m: geoMsg({ _: 'messageMediaGeo', geo: geoPoint }), timeStr: '12:44', out: false, status: 'read' }));
        expect(c.querySelector('.MessageBubble_geo')).toBeTruthy();
        expect(c.querySelector('.tgui-geo-map')).toBeTruthy();
        expect(c.querySelector('.tgui-geo-pin')).toBeTruthy();
        expect(c.querySelector('.tgui-geo-live')).toBeNull();
        expect(c.querySelector('.tgui-geo-title')).toBeNull();
    });

    test('venue renders title and address', () => {
        const c = mount(h(GeoBubble as any, { m: geoMsg({ _: 'messageMediaVenue', geo: geoPoint, title: 'Cafe', address: 'Main 1', provider: 'foursquare', venue_id: '1', venue_type: 'cafe' }), timeStr: '12:44', out: false, status: 'read' }));
        expect(c.querySelector('.tgui-geo-title')?.textContent).toBe('Cafe');
        expect(c.querySelector('.tgui-geo-address')?.textContent).toBe('Main 1');
    });

    test('live renders badge while period lasts', () => {
        const now = Math.floor(Date.now() / 1000);
        const m = geoMsg({ _: 'messageMediaGeoLive', geo: geoPoint, period: 900 });
        (m as any).date = now - 100;
        const c = mount(h(GeoBubble as any, { m, timeStr: '12:44', out: false, status: 'read' }));
        const badge = c.querySelector('.tgui-geo-live');
        expect(badge).toBeTruthy();
        expect(['13:19', '13:20']).toContain(badge?.textContent);
    });

    test('expired live has no badge', () => {
        const now = Math.floor(Date.now() / 1000);
        const m = geoMsg({ _: 'messageMediaGeoLive', geo: geoPoint, period: 60 });
        (m as any).date = now - 3600;
        const c = mount(h(GeoBubble as any, { m, timeStr: '12:44', out: false, status: 'read' }));
        expect(c.querySelector('.tgui-geo-live')).toBeNull();
        expect(c.querySelector('.tgui-geo-map')).toBeTruthy();
    });

    test('caption renders below map', () => {
        const c = mount(h(GeoBubble as any, { m: geoMsg({ _: 'messageMediaGeo', geo: geoPoint }, 'meet here'), timeStr: '12:44', out: false, status: 'read' }));
        expect(c.querySelector('.MessageBubble__text')?.textContent).toContain('meet here');
    });

    test('frame embeds current provider map', async () => {
        const renderFresh = (provider: string) => {
            try { (document.documentElement as any).dataset.mapProvider = provider; } catch {}
            const c = document.createElement('div');
            document.body.appendChild(c);
            const Comp: any = () => h(GeoBubble as any, { m: geoMsg({ _: 'messageMediaGeo', geo: geoPoint }), timeStr: '12:44', out: false, status: 'read' });
            render(Comp, c);
            return c;
        };
        const g = renderFresh('google');
        await new Promise((r) => setTimeout(r, 150));
        expect(g.querySelector('.tgui-geo-frame')?.getAttribute('src')).toContain('maps.google.com');
        const y = renderFresh('yandex');
        await new Promise((r) => setTimeout(r, 150));
        expect(y.querySelector('.tgui-geo-frame')?.getAttribute('src')).toContain('yandex.ru');
        expect(y.querySelector('.tgui-geo-open')).toBeTruthy();
        const d = renderFresh('dgis');
        await new Promise((r) => setTimeout(r, 150));
        expect(d.querySelector('.tgui-geo-frame')).toBeNull();
        expect(d.querySelector('.tgui-geo-open')).toBeTruthy();
        expect(d.querySelector('.tgui-geo-pin')).toBeTruthy();
        try { (document.documentElement as any).dataset.mapProvider = 'google'; } catch {}
    });

    test('frame switches provider on event', async () => {
        const renderFresh = () => {
            const c = document.createElement('div');
            document.body.appendChild(c);
            const Comp: any = () => h(GeoBubble as any, { m: geoMsg({ _: 'messageMediaGeo', geo: geoPoint }), timeStr: '12:44', out: false, status: 'read' });
            render(Comp, c);
            return c;
        };
        try { (document.documentElement as any).dataset.mapProvider = 'google'; } catch {}
        const c = renderFresh();
        await new Promise((r) => setTimeout(r, 150));
        expect(c.querySelector('.tgui-geo-frame')?.getAttribute('src')).toContain('maps.google.com');
        try { (document.documentElement as any).dataset.mapProvider = 'yandex'; } catch {}
        window.dispatchEvent(new Event('tg-map-provider-changed'));
        await new Promise((r) => setTimeout(r, 150));
        expect(c.querySelector('.tgui-geo-frame')?.getAttribute('src')).toContain('yandex.ru');
        try { (document.documentElement as any).dataset.mapProvider = 'google'; } catch {}
    });
});

describe('GeoBubble in polls', () => {
    const geoPoint2 = { _: 'geoPoint', long: 30.3158, lat: 59.9398, access_hash: 2 };
    const pollMsg = (poll: any, attached?: any) => ({
        id: 9101, date: 1788697000, out: false, sender: 'U', message: '', entities: [],
        media: { _: 'messageMediaPoll', poll, results: {}, ...(attached ? { attached_media: attached } : {}) },
    });
    const answers2 = [
        { option: 'a1', text: { text: 'Park' }, media: { _: 'messageMediaGeo', geo: geoPoint2 } },
        { option: 'a2', text: { text: 'No geo' } },
    ];

    test('poll cover geo renders map', () => {
        const c = mount(h(PollBubble as any, { m: pollMsg({ question: { text: 'Where?' }, answers: [{ option: 'a1', text: { text: 'There' } }] }, { _: 'messageMediaGeo', geo: geoPoint2 }), timeStr: '12:44', out: false, status: 'read' }));
        expect(c.querySelector('.tgui-poll-attach_geo .tgui-geo-map')).toBeTruthy();
    });

    test('answer geo renders thumb and opens map on click', () => {
        const realOpen = (window as any).open;
        const seen: string[] = [];
        (window as any).open = (url: string) => { seen.push(url); return null; };
        try {
            try { (document.documentElement as any).dataset.mapProvider = 'google'; } catch {}
            const c = mount(h(PollBubble as any, { m: pollMsg({ question: { text: 'Where?' }, answers: answers2 }), timeStr: '12:44', out: false, status: 'read' }));
            const thumb = c.querySelector('.tgui-poll-optgeo') as HTMLElement;
            expect(thumb).toBeTruthy();
            thumb.click();
            expect(seen.length).toBe(1);
            expect(seen[0]).toBe('https://www.google.com/maps/search/?api=1&query=59.9398,30.3158');
        } finally {
            (window as any).open = realOpen;
        }
    });

    test('invalid answer geo renders no thumb', () => {
        const c = mount(h(PollBubble as any, { m: pollMsg({ question: { text: 'Q' }, answers: [{ option: 'a1', text: { text: 'X' }, media: { _: 'messageMediaGeo', geo: { _: 'geoPointEmpty' } } }] }), timeStr: '12:44', out: false, status: 'read' }));
        expect(c.querySelector('.tgui-poll-optgeo')).toBeNull();
    });
});

describe('GeoBubble viewport parking', () => {
    test('iframe unmounts when scrolled out and remounts on return', async () => {
        const c = document.createElement('div');
        document.body.appendChild(c);
        const Comp: any = () => h(GeoBubble as any, { m: geoMsg({ _: 'messageMediaGeo', geo: geoPoint }), timeStr: '12:44', out: false, status: 'read' });
        render(Comp, c);
        await new Promise((r) => setTimeout(r, 150));
        const map = c.querySelector('.tgui-geo-map') as HTMLElement;
        expect(c.querySelector('.tgui-geo-frame')).toBeTruthy();
        const ios = (global as any).__geoIO as any[];
        const io = ios[ios.length - 1];
        io.cb([{ isIntersecting: false, target: map }]);
        await new Promise((r) => setTimeout(r, 150));
        expect(c.querySelector('.tgui-geo-frame')).toBeNull();
        expect(c.querySelector('.tgui-geo-map')).toBeTruthy();
        io.cb([{ isIntersecting: true, target: map }]);
        await new Promise((r) => setTimeout(r, 150));
        expect(c.querySelector('.tgui-geo-frame')).toBeTruthy();
    });
});

describe('Peer blur cache', () => {
    test('buildPeerBlurThumb reads sizes once per photo object', () => {
        let reads = 0;
        const photo: any = {};
        Object.defineProperty(photo, 'sizes', { get() { reads += 1; return []; }, enumerable: true });
        expect(buildPeerBlurThumb(photo)).toBe('');
        expect(buildPeerBlurThumb(photo)).toBe('');
        expect(reads).toBe(1);
    });

    test('resolveAvatar returns stable values for same peer', () => {
        const peer = { avatarUrl: '', photo: { sizes: [] } };
        const a = resolveAvatar(peer);
        const b = resolveAvatar(peer);
        expect(a).toEqual(b);
        expect(a).toEqual({ url: '', blurUrl: '' });
    });

    test('resolveAvatar keeps only fetchable urls', () => {
        const thumb = 'data:image/jpeg;base64,/9j/4AA=';
        expect(resolveAvatar({ avatarUrl: thumb, blurUrl: thumb })).toEqual({ url: '', blurUrl: thumb });
        expect(resolveAvatar({ avatarUrl: 'foo/bar' })).toEqual({ url: '', blurUrl: '' });
        expect(resolveAvatar({ avatarUrl: 'blob:abc' })).toEqual({ url: 'blob:abc', blurUrl: '' });
    });

    test('resolveDisplayPeer prefers dialog peer over stale selection', () => {
        const stale = { type: 'user', id: '7', firstName: 'A' };
        const fresh = { type: 'user', id: '7', firstName: 'A', avatarUrl: 'blob:x', blurUrl: 'blob:x' };
        const dialogs = [{ peer: { type: 'user', id: '9' } }, { peer: fresh }];
        expect(resolveDisplayPeer(dialogs as any, stale)).toBe(fresh);
        expect(resolveAvatar(resolveDisplayPeer(dialogs as any, stale))).toEqual({ url: 'blob:x', blurUrl: 'blob:x' });
    });

    test('resolveDisplayPeer falls back to selection without dialog match', () => {
        const stale = { type: 'user', id: '7' };
        expect(resolveDisplayPeer([{ peer: { type: 'user', id: '9' } }] as any, stale)).toBe(stale);
        expect(resolveDisplayPeer([] as any, stale)).toBe(stale);
        expect(resolveDisplayPeer([] as any, null)).toBeNull();
    });
});
