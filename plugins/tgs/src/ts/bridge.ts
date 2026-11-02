import type {
    CubicBezierEasing, ParsedAnimation, ParsedAsset, ParsedDash, ParsedGradient, ParsedKeyframe, ParsedLayer,
    ParsedMarker, ParsedMask, ParsedProperty, ParsedShape, ParsedText, TextKeyframe, ParsedTransform,
} from './types.js';

type FillRuleName = 'winding' | 'evenodd';
type TrimModeName = 'simultaneously' | 'individually';

class Reader {
    dv: DataView;
    p = 0;
    constructor(bytes: Uint8Array) {
        this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    u8(): number { const v = this.dv.getUint8(this.p); this.p += 1; return v; }
    bool(): boolean { return this.u8() === 1; }
    u32(): number { const v = this.dv.getUint32(this.p, true); this.p += 4; return v; }
    f64(): number { const v = this.dv.getFloat64(this.p, true); this.p += 8; return v; }
    str(): string {
        const len = this.u32();
        const b = new Uint8Array(this.dv.buffer, this.dv.byteOffset + this.p, len);
        this.p += len;
        return new TextDecoder().decode(b);
    }
}

function optF64(r: Reader): number | undefined {
    const t = r.u8();
    if (t === 1) return r.f64();
    if (t === 2) return null as any;
    return undefined;
}

function f64v(r: Reader): number {
    if (r.u8() === 1) return r.f64();
    return null as any;
}

function strv(r: Reader): string { return r.str(); }

function manyF64(r: Reader): number[] {
    const n = r.u32();
    const out: number[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = f64v(r);
    return out;
}

function optManyF64(r: Reader): number[] | undefined {
    if (r.u8() === 0) return undefined;
    return manyF64(r);
}

function optStr(r: Reader): string | undefined {
    if (r.u8() === 0) return undefined;
    return r.str();
}

function jsonValue(r: Reader): any {
    const t = r.u8();
    switch (t) {
        case 0: return null;
        case 1: return r.f64();
        case 2: return manyF64(r);
        case 3: return r.str();
        case 4: return r.bool();
        case 5: {
            const n = r.u32();
            const o: Record<string, any> = {};
            for (let i = 0; i < n; i++) {
                const k = r.str();
                const v = jsonValue(r);
                o[k] = v;
            }
            return o;
        }
        default: throw new Error('bad value tag ' + t);
    }
}

function jsonValueOptional(r: Reader): any | undefined {
    if (r.u8() === 0) return undefined;
    return jsonValue(r);
}

function keyframe(r: Reader): ParsedKeyframe {
    const t = r.f64();
    const s = jsonValue(r);
    const endFrame = optF64(r);
    const hold = r.bool();
    const easing = optEasing(r);
    const e = jsonValueOptional(r);
    const to = optManyF64(r);
    const ti = optManyF64(r);
    const h = jsonValueOptional(r);
    const n = jsonValueOptional(r);
    const kf: ParsedKeyframe = { t, s, endFrame: endFrame as any, hold };
    if (easing !== undefined) kf.easing = easing;
    if (e !== undefined) kf.e = e;
    if (to !== undefined) kf.to = to;
    if (ti !== undefined) kf.ti = ti;
    if (h !== undefined) kf.h = h;
    if (n !== undefined) kf.n = n;
    return kf;
}

function optEasing(r: Reader): CubicBezierEasing | undefined {
    if (r.u8() === 0) return undefined;
    const x1 = r.f64(), y1 = r.f64(), x2 = r.f64(), y2 = r.f64();
    return { x1, y1, x2, y2 };
}

function property(r: Reader): ParsedProperty {
    const animated = r.bool();
    const value = jsonValue(r);
    const p: ParsedProperty = { animated } as ParsedProperty;
    if (value !== null) p.value = value;
    if (r.u8() === 1) {
        const n = r.u32();
        p.keyframes = new Array(n);
        for (let i = 0; i < n; i++) p.keyframes[i] = keyframe(r);
    }
    if (r.u8() === 1) p.x = property(r) as any;
    if (r.u8() === 1) p.y = property(r) as any;
    return p;
}

function optProperty(r: Reader): ParsedProperty | undefined {
    if (r.u8() === 0) return undefined;
    return property(r);
}

function transform(r: Reader): ParsedTransform {
    const tr: ParsedTransform = {} as ParsedTransform;
    tr.opacity = optProperty(r) as any;
    tr.rotation = optProperty(r) as any;
    tr.position = optProperty(r) as any;
    tr.anchor = optProperty(r) as any;
    tr.scale = optProperty(r) as any;
    const skew = optProperty(r);
    if (skew !== undefined) tr.skew = skew;
    const skewAxis = optProperty(r);
    if (skewAxis !== undefined) tr.skewAxis = skewAxis;
    const so = optProperty(r);
    if (so !== undefined) tr.startOpacity = so;
    const eo = optProperty(r);
    if (eo !== undefined) tr.endOpacity = eo;
    return tr;
}

function optTransform(r: Reader): ParsedTransform | undefined {
    if (r.u8() === 0) return undefined;
    return transform(r);
}

function gradient(r: Reader): ParsedGradient {
    const t = r.u8();
    const g: ParsedGradient = {
        type: t as any,
        startPoint: property(r),
        endPoint: property(r),
        stops: property(r),
    } as ParsedGradient;
    const hl = optProperty(r);
    if (hl !== undefined) g.highlightLength = hl;
    const ha = optProperty(r);
    if (ha !== undefined) g.highlightAngle = ha;
    const cp = optF64(r);
    if (cp !== undefined) g.colorPoints = cp as any;
    return g;
}

function optGradient(r: Reader): ParsedGradient | undefined {
    if (r.u8() === 0) return undefined;
    return gradient(r);
}

function dash(r: Reader): ParsedDash {
    const name = optStr(r);
    const value = property(r);
    const d: ParsedDash = {} as ParsedDash;
    if (name !== undefined) d.name = name;
    d.value = value;
    return d;
}

function optDashes(r: Reader): ParsedDash[] | undefined {
    if (r.u8() === 0) return undefined;
    const n = r.u32();
    const out: ParsedDash[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = dash(r);
    return out;
}

function shape(r: Reader): ParsedShape {
    const s: ParsedShape = { type: r.str() } as ParsedShape;
    const name = optStr(r);
    if (name !== undefined) s.name = name;
    const mn = optStr(r);
    if (mn !== undefined) s.matchName = mn;
    const ix = optF64(r);
    if (ix !== undefined) s.index = ix as any;
    if (r.u8() === 1) {
        const n = r.u32();
        s.children = new Array(n);
        for (let i = 0; i < n; i++) s.children[i] = shape(r);
    }
    const pos = optProperty(r);
    if (pos !== undefined) s.position = pos;
    const st = optF64(r);
    if (st !== undefined) s.starType = st as any;
    const pts = optProperty(r);
    if (pts !== undefined) s.points = pts;
    const an = optProperty(r);
    if (an !== undefined) s.anchor = an;
    const sc = optProperty(r);
    if (sc !== undefined) s.scale = sc;
    const rot = optProperty(r);
    if (rot !== undefined) s.rotation = rot;
    const or_ = optProperty(r);
    if (or_ !== undefined) s.outerRadius = or_;
    const ir = optProperty(r);
    if (ir !== undefined) s.innerRadius = ir;
    const or2 = optProperty(r);
    if (or2 !== undefined) s.outerRoundness = or2;
    const ir2 = optProperty(r);
    if (ir2 !== undefined) s.innerRoundness = ir2;
    const si = optProperty(r);
    if (si !== undefined) s.size = si;
    const ra = optProperty(r);
    if (ra !== undefined) s.radius = ra;
    const dir = optF64(r);
    if (dir !== undefined) s.direction = dir as any;
    if (r.u8() === 1) s.rd = shape(r);
    const col = optProperty(r);
    if (col !== undefined) s.color = col;
    const g = optGradient(r);
    if (g !== undefined) s.gradient = g;
    const op = optProperty(r);
    if (op !== undefined) s.opacity = op;
    const sw = optProperty(r);
    if (sw !== undefined) s.strokeWidth = sw;
    const lc = optF64(r);
    if (lc !== undefined) s.lineCap = lc as any;
    const lj = optF64(r);
    if (lj !== undefined) s.lineJoin = lj as any;
    const ml = optF64(r);
    if (ml !== undefined) s.miterLimit = ml as any;
    if (r.u8() === 1) {
        const v = r.u8();
        s.fillRule = (v === 0 ? 'winding' : 'evenodd') as FillRuleName;
    }
    const ds = optDashes(r);
    if (ds !== undefined) s.dashes = ds;
    const cs = optProperty(r);
    if (cs !== undefined) s.copies = cs;
    const co = optProperty(r);
    if (co !== undefined) s.copiesOffset = co;
    const comp = optF64(r);
    if (comp !== undefined) s.composite = comp as any;
    const mm = optF64(r);
    if (mm !== undefined) s.mergeMode = mm as any;
    const tr = optTransform(r);
    if (tr !== undefined) s.transform = tr;
    const s0 = optProperty(r);
    if (s0 !== undefined) s.start = s0;
    const s1 = optProperty(r);
    if (s1 !== undefined) s.end = s1;
    const s2 = optProperty(r);
    if (s2 !== undefined) s.offset = s2;
    if (r.u8() === 1) {
        const v = r.u8();
        s.trimMode = (v === 0 ? 'simultaneously' : 'individually') as TrimModeName;
    }
    const vs = optProperty(r);
    if (vs !== undefined) s.vertices = vs;
    return s;
}

function optShapes(r: Reader): ParsedShape[] | undefined {
    if (r.u8() === 0) return undefined;
    const n = r.u32();
    const out: ParsedShape[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = shape(r);
    return out;
}

function textKeyframe(r: Reader): TextKeyframe {
    const k: TextKeyframe = { at: r.f64(), text: r.str() } as TextKeyframe;
    const fs = optF64(r);
    if (fs !== undefined) k.fontSize = fs as any;
    const ff = optStr(r);
    if (ff !== undefined) k.fontFamily = ff;
    const fc = optManyF64(r);
    if (fc !== undefined) k.fillColor = fc;
    const j = optF64(r);
    if (j !== undefined) k.justify = j as any;
    const lh = optF64(r);
    if (lh !== undefined) k.lineHeight = lh as any;
    const ls = optF64(r);
    if (ls !== undefined) k.tracking = ls as any;
    const sc = optManyF64(r);
    if (sc !== undefined) k.strokeColor = sc;
    const sw = optF64(r);
    if (sw !== undefined) k.strokeWidth = sw as any;
    return k;
}

function text(r: Reader): ParsedText {
    const t: ParsedText = { text: r.str() } as ParsedText;
    const fs = optF64(r);
    if (fs !== undefined) t.fontSize = fs as any;
    const ff = optStr(r);
    if (ff !== undefined) t.fontFamily = ff;
    const fc = optManyF64(r);
    if (fc !== undefined) t.fillColor = fc;
    const j = optF64(r);
    if (j !== undefined) t.justify = j as any;
    const lh = optF64(r);
    if (lh !== undefined) t.lineHeight = lh as any;
    const ls = optF64(r);
    if (ls !== undefined) t.tracking = ls as any;
    const sc = optManyF64(r);
    if (sc !== undefined) t.strokeColor = sc;
    const sw = optF64(r);
    if (sw !== undefined) t.strokeWidth = sw as any;
    if (r.u8() === 1) {
        const n = r.u32();
        t.keyframes = new Array(n);
        for (let i = 0; i < n; i++) t.keyframes[i] = textKeyframe(r);
    }
    return t;
}

function optText(r: Reader): ParsedText | undefined {
    if (r.u8() === 0) return undefined;
    return text(r);
}

function mask(r: Reader): ParsedMask {
    const name = optStr(r);
    const inverted = r.bool();
    const mode = r.u8();
    const path = property(r);
    const op = property(r);
    const ex = property(r);
    const m: ParsedMask = { mode: mode as any, path, opacity: op, expand: ex } as ParsedMask;
    if (name !== undefined) m.name = name;
    if (inverted) m.inverted = true;
    return m;
}

function optMasks(r: Reader): ParsedMask[] | undefined {
    if (r.u8() === 0) return undefined;
    const n = r.u32();
    const out: ParsedMask[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = mask(r);
    return out;
}

function transformLayer(r: Reader): ParsedTransform { return transform(r); }

function layer(r: Reader): ParsedLayer {
    const index = r.f64();
    const type = r.u8();
    const l: ParsedLayer = { index, type: type as any, transform: transformLayer(r) } as ParsedLayer;
    const name = optStr(r);
    if (name !== undefined) l.name = name;
    const pi = optF64(r);
    if (pi !== undefined) l.parentIndex = pi as any;
    const rid = optStr(r);
    if (rid !== undefined) l.refId = rid;
    const inf = optF64(r);
    if (inf !== undefined) l.inFrame = inf as any;
    const outf = optF64(r);
    if (outf !== undefined) l.outFrame = outf as any;
    const st = optF64(r);
    if (st !== undefined) l.startTime = st as any;
    const sr = optF64(r);
    if (sr !== undefined) l.stretch = sr as any;
    const ao = optF64(r);
    if (ao !== undefined) l.autoOrient = ao as any;
    const is3d = optBool(r);
    if (is3d) l.is3d = true;
    const bm = optF64(r);
    if (bm !== undefined) l.blendMode = bm as any;
    const ss = optStr(r);
    if (ss !== undefined) l.solidColor = ss;
    const sw = optF64(r);
    if (sw !== undefined) l.solidWidth = sw as any;
    const sh = optF64(r);
    if (sh !== undefined) l.solidHeight = sh as any;
    const lw = optF64(r);
    if (lw !== undefined) l.layerWidth = lw as any;
    const lh = optF64(r);
    if (lh !== undefined) l.layerHeight = lh as any;
    if (r.u8() === 1) l.matteType = r.u8() as any;
    const mt = optBool(r);
    if (mt) l.matteTarget = true;
    const tr = optProperty(r);
    if (tr !== undefined) l.timeRemap = tr;
    const ms = optMasks(r);
    if (ms !== undefined) l.masks = ms;
    const tx = optText(r);
    if (tx !== undefined) l.text = tx;
    const sh2 = optShapes(r);
    if (sh2 !== undefined) l.shapes = sh2;
    const hd = optBool(r);
    if (hd) l.hidden = true;
    return l;
}

function optBool(r: Reader): boolean | undefined {
    if (r.u8() === 0) return undefined;
    return r.bool();
}

function asset(r: Reader): ParsedAsset {
    const id = optStr(r);
    const w = optF64(r);
    const h = optF64(r);
    const u = optStr(r);
    const p = optStr(r);
    const a: ParsedAsset = {} as ParsedAsset;
    if (id !== undefined) a.id = id;
    if (w !== undefined) a.w = w as any;
    if (h !== undefined) a.h = h as any;
    if (u !== undefined) a.u = u;
    if (p !== undefined) a.p = p;
    if (r.u8() === 1) {
        const n = r.u32();
        a.layers = new Array(n);
        for (let i = 0; i < n; i++) a.layers[i] = layer(r);
    }
    return a;
}

export function decodeAnimation(bytes: Uint8Array): ParsedAnimation | null {
    try {
        const r = new Reader(bytes);
        if (r.str() !== 'TGSB') return null;
        const version = r.u8();
        if (version !== 1) return null;
        r.u8();
        return animation(r);
    } catch {
        return null;
    }
}

function animation(r: Reader): ParsedAnimation {
    const a: ParsedAnimation = {
        width: r.f64(),
        height: r.f64(),
        fps: r.f64(),
        inFrame: r.f64(),
        outFrame: r.f64(),
        duration: r.f64(),
    } as ParsedAnimation;
    const nl = r.u32();
    a.layers = new Array(nl);
    for (let i = 0; i < nl; i++) a.layers[i] = layer(r);
    const na = r.u32();
    a.assets = new Array(na);
    for (let i = 0; i < na; i++) a.assets[i] = asset(r);
    const name = optStr(r);
    if (name !== undefined) a.name = name;
    const ver = optStr(r);
    if (ver !== undefined) a.version = ver;
    a.tgs = r.bool();
    a.is3d = r.bool();
    if (r.u8() === 1) {
        const n = r.u32();
        a.markers = new Array(n);
        for (let i = 0; i < n; i++) {
            const m: ParsedMarker = {} as ParsedMarker;
            const name = optStr(r);
            if (name !== undefined) m.name = name;
            m.startFrame = r.f64();
            m.endFrame = r.f64();
            a.markers[i] = m;
        }
    }
    return a;
}
