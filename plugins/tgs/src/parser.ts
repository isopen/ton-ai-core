import type {
    TgsAnimation, TgsLayer, TgsShape, TgsAsset, TgsMask, TgsTransform, TgsText,
    ParsedAnimation, ParsedLayer, ParsedTransform, ParsedProperty, ParsedShape,
    ParsedAsset, ParsedMask, ParsedGradient, ParsedText, TextKeyframe, LayerInfo, TgsMarker,
} from './types.js';
import {
    LayerType, MatteType, MaskMode, GradientType,
} from './types.js';
import { parseValue } from './keyframes.js';

const SHAPE_TYPE_MAP: Record<string, string> = {
    gr: 'group',
    rc: 'rect',
    el: 'ellipse',
    sh: 'path',
    fl: 'fill',
    sr: 'star',
    mm: 'merge',
    tm: 'trim',
    rp: 'repeater',
    gs: 'gradientStroke',
    gf: 'gradientFill',
    st: 'stroke',
    rd: 'roundedCorner',
    tr: 'transform',
};

function parseTransform(ks?: TgsTransform): ParsedTransform {
    if (!ks) ks = {} as TgsTransform;
    const result: ParsedTransform = {
        opacity: parseValue(ks.o),
        rotation: parseValue(ks.r),
        position: parseValue(ks.p),
        anchor: parseValue(ks.a),
        scale: parseValue(ks.s),
    };
    if (ks.sk) result.skew = parseValue(ks.sk);
    if (ks.sa) result.skewAxis = parseValue(ks.sa);
    if (ks.so) result.startOpacity = parseValue(ks.so);
    if (ks.eo) result.endOpacity = parseValue(ks.eo);
    return result;
}

function parseGradientShape(s: TgsShape): ParsedGradient {
    return {
        type: s.t === 2 ? GradientType.Radial : GradientType.Linear,
        startPoint: parseValue(s.s),
        endPoint: parseValue(s.e),

        highlightLength: s.h ? parseValue(s.h) : undefined,
        highlightAngle: s.a ? parseValue(s.a) : undefined,
        colorPoints: s.g?.p,
        stops: parseValue(s.g?.k),
    };
}

function parseShape(s: TgsShape): ParsedShape | undefined {
    if (s.hd) return undefined;
    const type = SHAPE_TYPE_MAP[s.ty] || s.ty;
    const result: ParsedShape = { type };

    if (s.nm) result.name = s.nm;
    if (s.mn) result.matchName = s.mn;
    if (s.ix != null) result.index = s.ix;
    if (s.it) {
        result.children = s.it.map(parseShape).filter((c): c is ParsedShape => !!c);
    }

    if (type === 'trim') {
        if (s.s) result.start = parseValue(s.s);
        if (s.e) result.end = parseValue(s.e);
        if (s.o) result.offset = parseValue(s.o);

        if (s.m != null) result.trimMode = Number(s.m) === 2 ? 'individually' : 'simultaneously';
        return result;
    }

    if (type === 'fill') {
        if (s.c) result.color = parseValue(s.c);
        if (s.o) result.opacity = parseValue(s.o);
        const rule = (s.r as any);
        if (rule === 2) result.fillRule = 'evenodd';
        else if (rule === 1) result.fillRule = 'winding';
        return result;
    }

    if (type === 'stroke') {
        if (s.c) result.color = parseValue(s.c);
        if (s.o) result.opacity = parseValue(s.o);
        if (s.w) result.strokeWidth = parseValue(s.w);
        if (s.lc != null) result.lineCap = s.lc;
        if (s.lj != null) result.lineJoin = s.lj;
        if (s.ml != null) result.miterLimit = s.ml;
        if (s.d) result.dashes = s.d.map((d) => ({ name: d.n, value: parseValue(d.v) }));
        return result;
    }

    if (type === 'gradientFill' || type === 'gradientStroke') {
        result.gradient = parseGradientShape(s);
        if (s.o) result.opacity = parseValue(s.o);
        if (type === 'gradientStroke') {
            if (s.w) result.strokeWidth = parseValue(s.w);
            if (s.lc != null) result.lineCap = s.lc;
            if (s.lj != null) result.lineJoin = s.lj;
            if (s.ml != null) result.miterLimit = s.ml;
            if (s.d) result.dashes = s.d.map((d) => ({ name: d.n, value: parseValue(d.v) }));
        }
        return result;
    }

    if (type === 'ellipse') {
        if (s.p) result.position = parseValue(s.p);
        if (s.s) result.size = parseValue(s.s);
        if (s.d != null && typeof s.d === 'number') result.direction = s.d;
        return result;
    }

    if (type === 'rect') {
        if (s.p) result.position = parseValue(s.p);
        if (s.s) result.size = parseValue(s.s);
        if (s.r) result.radius = parseValue(s.r);
        if (s.d != null && typeof s.d === 'number') result.direction = s.d;
        if (s.rd) result.rd = { type: 'roundedCorner', radius: parseValue(s.rd) };
        return result;
    }

    if (type === 'roundedCorner') {
        if (s.r) result.radius = parseValue(s.r);
        return result;
    }

    if (type === 'path') {
        if (s.ks) result.vertices = parseValue(s.ks);
        return result;
    }

    if (type === 'star') {
        if (s.p) result.position = parseValue(s.p);
        if (s.sy != null) result.starType = s.sy;
        if (s.pt) result.points = parseValue(s.pt);
        if (s.r) result.rotation = parseValue(s.r);
        if (s.or) result.outerRadius = parseValue(s.or);
        if (s.ir) result.innerRadius = parseValue(s.ir);

        if (s.os != null) result.outerRoundness = parseValue(s.os);
        if (s.is != null) result.innerRoundness = parseValue(s.is);
        return result;
    }

    if (type === 'repeater') {
        if (s.c) result.copies = parseValue(s.c);
        if (s.o) result.copiesOffset = parseValue(s.o);
        if (s.m != null) result.composite = (s.m as any);
        if (s.tr) result.transform = parseTransform(s.tr);
        return result;
    }

    if (type === 'merge') {
        if (s.mm != null) result.mergeMode = s.mm;
        return result;
    }
    if (type === 'transform') {
        if (s.p) result.position = parseValue(s.p);
        if (s.a) result.anchor = parseValue(s.a);
        if (s.s) result.scale = parseValue(s.s);
        if (s.r) result.rotation = parseValue(s.r);
        if (s.o) result.opacity = parseValue(s.o);
        return result;
    }

    return result;
}

function parseMask(m: TgsMask): ParsedMask {
    const modeMap: Record<string, MaskMode> = {
        a: MaskMode.Add,
        s: MaskMode.Subtract,
        i: MaskMode.Intersect,
        f: MaskMode.Difference,
        n: MaskMode.None,
    };
    return {
        name: m.nm,
        inverted: m.inv === true,
        mode: modeMap[m.mode || 'a'] ?? MaskMode.None,
        path: parseValue(m.pt),
        opacity: parseValue(m.o),
        expand: parseValue(m.x),
    };
}

function parseText(t: TgsText): ParsedText | undefined {
    const kf = t?.d?.k?.[0];
    const s = kf?.s;
    if (!s) return undefined;
    const text: ParsedText = { text: s.t ?? '' };
    if (s.s != null) text.fontSize = s.s;
    if (s.f) text.fontFamily = s.f;
    if (s.fc) text.fillColor = s.fc;
    if (s.j != null) text.justify = s.j;
    if (s.lh != null) text.lineHeight = s.lh;
    if (s.ls != null) text.tracking = s.ls;
    if (s.sc) text.strokeColor = s.sc;
    if (s.sw != null) text.strokeWidth = s.sw;
    const list = t?.d?.k;
    if (Array.isArray(list) && list.length > 1) {
        const kfs: TextKeyframe[] = [];
        for (const k of list) {
            if (!k || k.t == null || !k.s) continue;
            const doc: TextKeyframe = { at: k.t, text: k.s.t ?? '' };
            if (k.s.s != null) doc.fontSize = k.s.s;
            if (k.s.f) doc.fontFamily = k.s.f;
            if (k.s.fc) doc.fillColor = k.s.fc;
            if (k.s.j != null) doc.justify = k.s.j;
            if (k.s.lh != null) doc.lineHeight = k.s.lh;
            if (k.s.ls != null) doc.tracking = k.s.ls;
            if (k.s.sc) doc.strokeColor = k.s.sc;
            if (k.s.sw != null) doc.strokeWidth = k.s.sw;
            kfs.push(doc);
        }
        kfs.sort((a, b) => a.at - b.at);
        if (kfs.length > 1) text.keyframes = kfs;
    }
    return text;
}

function parseLayer(l: TgsLayer): ParsedLayer | undefined {
    if (!l.ks || (l.parent != null && l.parent === l.ind)) return undefined;

    const typeMap: Record<number, LayerType> = {
        0: LayerType.Precomp, 1: LayerType.Solid, 2: LayerType.Image,
        3: LayerType.Null, 4: LayerType.Shape, 5: LayerType.Text,
    };

    const result: ParsedLayer = {
        index: l.ind,
        type: typeMap[l.ty] ?? LayerType.Shape,
        transform: parseTransform(l.ks),
    };

    if (l.nm) result.name = l.nm;
    if (l.parent != null) result.parentIndex = l.parent;
    if (l.refId) result.refId = l.refId;
    if (l.ip != null) result.inFrame = l.ip;
    if (l.op != null) result.outFrame = l.op;
    if (l.st != null) result.startTime = l.st;
    if (l.sr != null) result.stretch = l.sr;
    if (l.ao != null) result.autoOrient = l.ao;
    if (l.ddd) result.is3d = true;
    if (l.bm != null) result.blendMode = l.bm;
    if (l.sc) result.solidColor = l.sc;
    if (l.sw != null) result.solidWidth = l.sw;
    if (l.sh != null) result.solidHeight = l.sh;

    if (l.w != null) result.layerWidth = l.w;
    if (l.h != null) result.layerHeight = l.h;
    if (l.tt != null) {
        const matteMap: Record<number, MatteType> = {
            1: MatteType.Alpha, 2: MatteType.AlphaInv, 3: MatteType.Luma, 4: MatteType.LumaInv,
        };
        result.matteType = matteMap[l.tt] ?? MatteType.None;
    }
    if (l.td != null) result.matteTarget = true;
    if (l.tm) result.timeRemap = parseValue(l.tm);
    if (Array.isArray(l.masksProperties)) {
        result.masks = l.masksProperties.map(parseMask);
    }
    if (l.t) result.text = parseText(l.t);
    if (Array.isArray(l.shapes)) {
        result.shapes = l.shapes.map(parseShape).filter((s): s is ParsedShape => !!s);
    }

    if (l.hd) {
        result.type = LayerType.Null;
        result.hidden = true;
        delete result.shapes;
        delete result.masks;
        delete result.text;
        delete result.refId;
        delete result.matteType;
        delete result.matteTarget;
    }

    return result;
}

function parseMarkers(markers?: TgsMarker[]): ParsedAnimation['markers'] {
    if (!Array.isArray(markers)) return undefined;
    return markers.map((m) => ({
        name: m.cm,
        startFrame: m.tm,
        endFrame: m.tm + m.dr,
    }));
}

export interface ParseOptions {
    key?: string;
    cache?: boolean;
}

const DEFAULT_CACHE_SIZE = 10;
let modelCacheSize = DEFAULT_CACHE_SIZE;
const modelCache = new Map<string, ParsedAnimation>();

export function configureModelCacheSize(size: number): void {
    modelCacheSize = size;
    if (size === 0) modelCache.clear();
}

function cacheGet(key: string): ParsedAnimation | undefined {
    const value = modelCache.get(key);
    if (value) {
        modelCache.delete(key);
        modelCache.set(key, value);
    }
    return value;
}

function cachePut(key: string, value: ParsedAnimation): void {
    if (modelCacheSize <= 0) return;
    cacheGet(key);
    modelCache.set(key, value);
    while (modelCache.size > modelCacheSize) {
        const oldest = modelCache.keys().next().value as string;
        modelCache.delete(oldest);
    }
}

function parseAnimation(data: TgsAnimation): ParsedAnimation {
    const layers = data.layers.map(parseLayer).filter((l): l is ParsedLayer => !!l);
    const assets: ParsedAsset[] = (data.assets || []).map((a: TgsAsset) => ({
        id: a.id,
        w: a.w,
        h: a.h,
        u: a.u,
        p: a.p,
        layers: a.layers ? a.layers.map(parseLayer).filter((l): l is ParsedLayer => !!l) : undefined,
    }));

    return {
        width: data.w || 512,
        height: data.h || 512,
        fps: data.fr || 30,
        inFrame: data.ip || 0,
        outFrame: data.op || 0,
        duration: ((data.op || 0) - (data.ip || 0)) / (data.fr || 30),
        layers,
        assets,
        name: data.nm,
        version: data.v,
        tgs: data.tgs === 1,
        is3d: data.ddd === 1,
        markers: parseMarkers(data.markers),
    };
}

export function parseTgs(json: string, options?: ParseOptions): ParsedAnimation {
    let data: TgsAnimation;
    try {
        data = JSON.parse(json);
    } catch {
        throw new Error('Invalid TGS JSON');
    }

    if (!data.layers || !Array.isArray(data.layers)) {
        throw new Error('TGS has no layers');
    }

    const key = options?.key;
    if (key) {
        const cached = cacheGet(key);
        if (cached) return cached;
    }

    const animation = parseAnimation(data);

    if (key) cachePut(key, animation);
    return animation;
}

export function layerInfo(animation: ParsedAnimation): LayerInfo[] {
    return animation.layers.map((l) => ({
        name: l.name,
        inFrame: l.inFrame ?? animation.inFrame,
        outFrame: l.outFrame ?? animation.outFrame,
    }));
}

export { parseValue };
