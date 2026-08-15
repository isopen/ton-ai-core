import { interpolateKeyframes } from './keyframes.js';
import { bezierLength, bezierSplit, bezierTAtLength, type CubicBezierSeg } from './bezier.js';
import { buildEasing, easingValue } from './easing.js';
import type {
    ParsedAnimation, ParsedLayer, ParsedShape, ParsedAsset, ParsedTransform, ParsedProperty, ParsedText, TextKeyframe,
} from './types.js';
import { MatteType, LayerType } from './types.js';

const EPSILON = 0.000001;
const DASH_TOLERANCE = 0.1;
const DASH_ITER_CAP = 10000;
const SQRT_2 = 1.41421;
const MAX_PARENT_DEPTH = 64;

function vCompare(a: number, b: number): boolean {
    return Math.abs(a - b) < EPSILON;
}

function vIsZero(a: number): boolean {
    return Math.abs(a) <= EPSILON;
}

function colorToStyle(color: any, alpha = 1): string {
    if (typeof color === 'number') {
        const n = color < 0 ? 0xFFFFFFFF + color + 1 : color;
        const r = (n >> 16) & 0xff;
        const g = (n >> 8) & 0xff;
        const b = n & 0xff;
        return `rgba(${r},${g},${b},${alpha})`;
    }
    if (Array.isArray(color)) {
        const r = Math.round(color[0] * 255);
        const g = Math.round(color[1] * 255);
        const b = Math.round(color[2] * 255);
        const a = color.length > 3 ? color[3] * alpha : alpha;
        return `rgba(${r},${g},${b},${a})`;
    }
    if (typeof color === 'string') {
        const m = color.match(/^#?([0-9a-f]{6})$/i);
        if (m) {
            const n = parseInt(m[1], 16);
            return `rgba(${(n >> 16) & 0xff},${(n >> 8) & 0xff},${n & 0xff},${alpha})`;
        }
    }
    return color || '#000';
}

type Mat3 = [number, number, number, number, number, number];

function matTranslate(x: number, y: number): Mat3 {
    return [1, 0, 0, 1, x, y];
}

function matScale(sx: number, sy: number): Mat3 {
    return [sx, 0, 0, sy, 0, 0];
}

function matRotate(deg: number): Mat3 {
    const r = (deg * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    return [c, s, -s, c, 0, 0];
}

function matMul(m1: Mat3, m2: Mat3): Mat3 {
    return [
        m1[0] * m2[0] + m1[2] * m2[1],
        m1[1] * m2[0] + m1[3] * m2[1],
        m1[0] * m2[2] + m1[2] * m2[3],
        m1[1] * m2[2] + m1[3] * m2[3],
        m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
        m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
    ];
}

function matApply(m: Mat3, x: number, y: number): [number, number] {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function matScaleOf(m: Mat3): number {
    const p1 = matApply(m, 0, 0);
    const p2 = matApply(m, SQRT_2, SQRT_2);
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    return Math.sqrt(dx * dx + dy * dy) / 2;
}

function clamp01(v: number): number {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

function positionAngle(prop: any, frame: number): number {
    if (!prop || !prop.animated || !prop.keyframes || prop.keyframes.length === 0) return 0;
    const kfs = prop.keyframes;
    const first = kfs[0];
    const last = kfs[kfs.length - 1];
    if (frame <= first.t) return 0;
    const lastEnd = last.endFrame ?? last.t;
    if (frame >= lastEnd) return 0;

    let lo = 0;
    let hi = kfs.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const kf = kfs[mid];
        const next = kfs[mid + 1];
        const end = kf.endFrame ?? (next ? next.t : kf.t);
        if (frame < kf.t) {
            hi = mid - 1;
        } else if (frame >= end) {
            lo = mid + 1;
        } else {
            if (!kf.to || !kf.ti) return 0;
            const start = Array.isArray(kf.s) ? kf.s : undefined;
            const endVal = Array.isArray(kf.e) ? kf.e : undefined;
            if (!start || !endVal) return 0;
            const duration = Math.max(end - kf.t, 1e-6);
            let progress = clamp01((frame - kf.t) / duration);
            let easing = kf.easing;
            if (!easing && (kf.o || kf.i)) easing = buildEasing(kf.o, kf.i);
            if (easing) progress = easingValue(easing, progress);
            const seg: CubicBezierSeg = {
                p0: [start[0], start[1]],
                p1: [start[0] + kf.to[0], start[1] + kf.to[1]],
                p2: [endVal[0] + kf.ti[0], endVal[1] + kf.ti[1]],
                p3: [endVal[0], endVal[1]],
            };
            const len = bezierLength(seg);
            if (len < 1e-6) return 0;

            const t = bezierTAtLength(seg, progress * len, len);
            const mt = 1 - t;
            const d = t * t;
            const a = -mt * mt;
            const b = 1 - 4 * t + 3 * d;
            const c = 2 * t - 3 * d;
            const dx = a * seg.p0[0] + b * seg.p1[0] + c * seg.p2[0] + d * seg.p3[0];
            const dy = a * seg.p0[1] + b * seg.p1[1] + c * seg.p2[1] + d * seg.p3[1];
            return Math.atan2(dy, dx) * (180 / Math.PI);
        }
    }
    return 0;
}

function matFromTransform(tr: any, frame: number, autoOrient = false): Mat3 {
    const pos = resolveProp(tr?.position, frame, [0, 0]);
    let rot = toNumber(resolveProp(tr?.rotation, frame, 0));
    if (autoOrient) rot += positionAngle(tr?.position, frame);
    const sc = resolveProp(tr?.scale, frame, [100, 100]);
    const sx = Array.isArray(sc) ? toNumber(sc[0]) : toNumber(sc);
    const sy = Array.isArray(sc) ? toNumber(sc[1]) : toNumber(sc);
    const anc = resolveProp(tr?.anchor, frame, [0, 0]);
    let m = matTranslate(toNumber(pos[0]), toNumber(pos[1]));
    m = matMul(m, matRotate(rot));
    m = matMul(m, matScale(sx / 100, sy / 100));
    m = matMul(m, matTranslate(-toNumber(anc[0]), -toNumber(anc[1])));
    return m;
}

function transformRectBounds(m: Mat3, x: number, y: number, w: number, h: number): [number, number, number, number] {
    const p1 = matApply(m, x, y);
    const p2 = matApply(m, x + w, y);
    const p3 = matApply(m, x + w, y + h);
    const p4 = matApply(m, x, y + h);
    const minX = Math.min(p1[0], p2[0], p3[0], p4[0]);
    const minY = Math.min(p1[1], p2[1], p3[1], p4[1]);
    const maxX = Math.max(p1[0], p2[0], p3[0], p4[0]);
    const maxY = Math.max(p1[1], p2[1], p3[1], p4[1]);
    return [minX, minY, maxX - minX, maxY - minY];
}

function intersectRect(a: Rect, b: Rect): Rect | null {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const w = Math.min(a.x + a.w, b.x + b.w) - x;
    const h = Math.min(a.y + a.h, b.y + b.h) - y;
    if (w <= 0 || h <= 0) return null;
    return { x, y, w, h };
}

interface PathCmd {
    type: 'M' | 'L' | 'C' | 'Z';
    pts?: number[];
}

interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

const BEZIER_MAGIC = 0.5522847498;

function vertsToCmds(verts: any[], closed: boolean): PathCmd[] {
    if (!verts || verts.length === 0) return [];
    const cmds: PathCmd[] = [];
    for (let i = 0; i < verts.length; i++) {
        const v = verts[i];
        if (i === 0) {
            cmds.push({ type: 'M', pts: [v.v[0], v.v[1]] });
        } else {
            const prev = verts[i - 1];
            cmds.push({
                type: 'C',
                pts: [prev.v[0] + prev.o[0], prev.v[1] + prev.o[1], v.v[0] + v.i[0], v.v[1] + v.i[1], v.v[0], v.v[1]],
            });
        }
    }
    if (closed && verts.length > 1) {
        const first = verts[0];
        const last = verts[verts.length - 1];
        cmds.push({
            type: 'C',
            pts: [last.v[0] + last.o[0], last.v[1] + last.o[1], first.v[0] + first.i[0], first.v[1] + first.i[1], first.v[0], first.v[1]],
        });
        cmds.push({ type: 'Z' });
    }
    return cmds;
}

function rectToVerts(p: number[], s: number[], r: number): any[] {
    const cx = p[0], cy = p[1];
    const w = s[0] / 2, h = s[1] / 2;
    const cr = Math.min(r || 0, w, h);
    const left = cx - w, right = cx + w, top = cy - h, bottom = cy + h;
    if (cr <= 0) {
        return [
            { v: [right, top], i: [0, 0], o: [0, 0] },
            { v: [right, bottom], i: [0, 0], o: [0, 0] },
            { v: [left, bottom], i: [0, 0], o: [0, 0] },
            { v: [left, top], i: [0, 0], o: [0, 0] },
        ];
    }
    const k = cr * BEZIER_MAGIC;
    return [
        { v: [right, top + cr], i: [0, -k], o: [0, k] },
        { v: [right, bottom - cr], i: [0, -k], o: [0, k] },
        { v: [right - cr, bottom], i: [k, 0], o: [-k, 0] },
        { v: [left + cr, bottom], i: [-k, 0], o: [-k, 0] },
        { v: [left, bottom - cr], i: [0, k], o: [0, -k] },
        { v: [left, top + cr], i: [0, k], o: [0, -k] },
        { v: [left + cr, top], i: [-k, 0], o: [k, 0] },
        { v: [right - cr, top], i: [k, 0], o: [k, 0] },
    ];
}

function ellipseToVerts(p: number[], s: number[]): any[] {
    const cx = p[0], cy = p[1];
    const rx = s[0] / 2, ry = s[1] / 2;
    const kx = rx * BEZIER_MAGIC, ky = ry * BEZIER_MAGIC;
    return [
        { v: [cx, cy - ry], i: [-kx, 0], o: [kx, 0] },
        { v: [cx + rx, cy], i: [0, -ky], o: [0, ky] },
        { v: [cx, cy + ry], i: [kx, 0], o: [-kx, 0] },
        { v: [cx - rx, cy], i: [0, ky], o: [0, -ky] },
    ];
}

function starToVerts(shape: ParsedShape, frame: number): any[] {
    const points = toNumber(resolveProp(shape.points, frame, 5));
    const innerR = toNumber(resolveProp(shape.innerRadius, frame, 0));
    const outerR = toNumber(resolveProp(shape.outerRadius, frame, 0));
    const innerRoundness = toNumber(resolveProp(shape.innerRoundness, frame, 0)) / 100;
    const outerRoundness = toNumber(resolveProp(shape.outerRoundness, frame, 0)) / 100;
    const rotation = toNumber(resolveProp(shape.rotation, frame, 0));
    const pos = resolveProp(shape.position, frame, [0, 0]);
    const cx = toNumber(pos && pos[0]);
    const cy = toNumber(pos && pos[1]);
    const angleDir = 1;

    const verts: any[] = [];
    if (shape.starType === 2) {
        const POLYGON_MAGIC_NUMBER = 0.25;
        let currentAngle = ((0 - 90) * Math.PI) / 180;
        const anglePerPoint = (2 * Math.PI) / Math.floor(points);
        const numPoints = Math.floor(points);
        const roundness = innerRoundness || outerRoundness || 0;
        currentAngle = ((currentAngle - 90) * Math.PI) / 180;
        let x = outerR * Math.cos(currentAngle);
        let y = outerR * Math.sin(currentAngle);
        currentAngle += anglePerPoint * angleDir;
        verts.push({ v: [x, y], i: [0, 0], o: [0, 0] });
        const hasRoundness = !vIsZero(roundness);
        for (let i = 0; i < numPoints; i++) {
            const previousX = x;
            const previousY = y;
            x = outerR * Math.cos(currentAngle);
            y = outerR * Math.sin(currentAngle);
            if (hasRoundness) {
                const cp1Theta = Math.atan2(previousY, previousX) - (Math.PI / 2) * angleDir;
                const cp1Dx = Math.cos(cp1Theta);
                const cp1Dy = Math.sin(cp1Theta);
                const cp2Theta = Math.atan2(y, x) - (Math.PI / 2) * angleDir;
                const cp2Dx = Math.cos(cp2Theta);
                const cp2Dy = Math.sin(cp2Theta);
                const cp1x = outerR * roundness * POLYGON_MAGIC_NUMBER * cp1Dx;
                const cp1y = outerR * roundness * POLYGON_MAGIC_NUMBER * cp1Dy;
                const cp2x = outerR * roundness * POLYGON_MAGIC_NUMBER * cp2Dx;
                const cp2y = outerR * roundness * POLYGON_MAGIC_NUMBER * cp2Dy;
                verts[verts.length - 1].o = [-cp1x, -cp1y];
                verts.push({ v: [x, y], i: [cp2x, cp2y], o: [0, 0] });
            } else {
                verts.push({ v: [x, y], i: [0, 0], o: [0, 0] });
            }
            currentAngle += anglePerPoint * angleDir;
        }
    } else {
        const POLYSTAR_MAGIC_NUMBER = 0.47829 / 0.28;
        let currentAngle = ((0 - 90) * Math.PI) / 180;
        let x = 0;
        let y = 0;
        let partialPointRadius = 0;
        const anglePerPoint = (2 * Math.PI) / points;
        const halfAnglePerPoint = anglePerPoint / 2;
        const partialPointAmount = points - Math.floor(points);
        let longSegment = false;
        const numPoints = Math.ceil(points) * 2;
        const hasRoundness = !vIsZero(innerRoundness) || !vIsZero(outerRoundness);

        if (!vCompare(partialPointAmount, 0)) {
            currentAngle += halfAnglePerPoint * (1 - partialPointAmount) * angleDir;
        }
        if (!vCompare(partialPointAmount, 0)) {
            partialPointRadius = innerR + partialPointAmount * (outerR - innerR);
            x = partialPointRadius * Math.cos(currentAngle);
            y = partialPointRadius * Math.sin(currentAngle);
            currentAngle += (anglePerPoint * partialPointAmount) / 2 * angleDir;
        } else {
            x = outerR * Math.cos(currentAngle);
            y = outerR * Math.sin(currentAngle);
            currentAngle += halfAnglePerPoint * angleDir;
        }

        verts.push({ v: [x, y], i: [0, 0], o: [0, 0] });
        for (let i = 0; i < numPoints; i++) {
            let radius = longSegment ? outerR : innerR;
            let dTheta = halfAnglePerPoint;
            if (!vCompare(partialPointRadius, 0) && i === numPoints - 2) {
                dTheta = (anglePerPoint * partialPointAmount) / 2;
            }
            if (!vCompare(partialPointRadius, 0) && i === numPoints - 1) {
                radius = partialPointRadius;
            }
            const previousX = x;
            const previousY = y;
            x = radius * Math.cos(currentAngle);
            y = radius * Math.sin(currentAngle);
            if (hasRoundness) {
                const cp1Theta = Math.atan2(previousY, previousX) - (Math.PI / 2) * angleDir;
                const cp1Dx = Math.cos(cp1Theta);
                const cp1Dy = Math.sin(cp1Theta);
                const cp2Theta = Math.atan2(y, x) - (Math.PI / 2) * angleDir;
                const cp2Dx = Math.cos(cp2Theta);
                const cp2Dy = Math.sin(cp2Theta);
                const cp1Roundness = longSegment ? innerRoundness : outerRoundness;
                const cp2Roundness = longSegment ? outerRoundness : innerRoundness;
                const cp1Radius = longSegment ? innerR : outerR;
                const cp2Radius = longSegment ? outerR : innerR;
                let cp1x = (cp1Radius * cp1Roundness * POLYSTAR_MAGIC_NUMBER * cp1Dx) / points;
                let cp1y = (cp1Radius * cp1Roundness * POLYSTAR_MAGIC_NUMBER * cp1Dy) / points;
                let cp2x = (cp2Radius * cp2Roundness * POLYSTAR_MAGIC_NUMBER * cp2Dx) / points;
                let cp2y = (cp2Radius * cp2Roundness * POLYSTAR_MAGIC_NUMBER * cp2Dy) / points;
                if (!vCompare(partialPointAmount, 0) && (i === 0 || i === numPoints - 1)) {
                    cp1x *= partialPointAmount;
                    cp1y *= partialPointAmount;
                    cp2x *= partialPointAmount;
                    cp2y *= partialPointAmount;
                }
                verts[verts.length - 1].o = [-cp1x, -cp1y];
                verts.push({ v: [x, y], i: [cp2x, cp2y], o: [0, 0] });
            } else {
                verts.push({ v: [x, y], i: [0, 0], o: [0, 0] });
            }
            currentAngle += dTheta * angleDir;
            longSegment = !longSegment;
        }
    }

    const b = (4 * rotation * Math.PI) / 180;
    const s = Math.sin(b);
    const c = Math.cos(b);
    for (const vtx of verts) {
        const px = vtx.v[0];
        const py = vtx.v[1];
        vtx.v[0] = c * px - s * py + cx;
        vtx.v[1] = s * px + c * py + cy;
        const ix = vtx.i[0];
        const iy = vtx.i[1];
        vtx.i[0] = c * ix - s * iy;
        vtx.i[1] = s * ix + c * iy;
        const ox = vtx.o[0];
        const oy = vtx.o[1];
        vtx.o[0] = c * ox - s * oy;
        vtx.o[1] = s * ox + c * oy;
    }
    return verts;
}

function drawCmds(ctx: CanvasRenderingContext2D, cmds: PathCmd[]) {
    for (const cmd of cmds) {
        if (cmd.type === 'M') {
            ctx.moveTo(cmd.pts![0], cmd.pts![1]);
        } else if (cmd.type === 'L') {
            ctx.lineTo(cmd.pts![0], cmd.pts![1]);
        } else if (cmd.type === 'C') {
            ctx.bezierCurveTo(cmd.pts![0], cmd.pts![1], cmd.pts![2], cmd.pts![3], cmd.pts![4], cmd.pts![5]);
        } else if (cmd.type === 'Z') {
            ctx.closePath();
        }
    }
}

function transformCmds(cmds: PathCmd[], m: Mat3): PathCmd[] {
    const out: PathCmd[] = [];
    for (const cmd of cmds) {
        if (cmd.type === 'M') {
            const p = matApply(m, cmd.pts![0], cmd.pts![1]);
            out.push({ type: 'M', pts: [p[0], p[1]] });
        } else if (cmd.type === 'L') {
            const p = matApply(m, cmd.pts![0], cmd.pts![1]);
            out.push({ type: 'L', pts: [p[0], p[1]] });
        } else if (cmd.type === 'C') {
            const c1 = matApply(m, cmd.pts![0], cmd.pts![1]);
            const c2 = matApply(m, cmd.pts![2], cmd.pts![3]);
            const e = matApply(m, cmd.pts![4], cmd.pts![5]);
            out.push({ type: 'C', pts: [c1[0], c1[1], c2[0], c2[1], e[0], e[1]] });
        } else {
            out.push(cmd);
        }
    }
    return out;
}

function reverseVerts(verts: any[]): any[] {
    const out: any[] = [];
    for (let i = verts.length - 1; i >= 0; i--) {
        const v = verts[i];
        out.push({ v: v.v, i: v.o, o: v.i });
    }
    return out;
}

function shapeCmds(shape: ParsedShape, frame: number): PathCmd[] | null {
    const type = shape.type;

    if (type === 'roundedCorner') return null;

    if (type === 'path') {
        const raw = resolveProp(shape.vertices, frame);
        if (!raw) return null;
        if (typeof raw === 'string') return null;
        const contours: { v: number[][]; i: number[][]; o: number[][]; c: boolean }[] = [];
        if (Array.isArray(raw)) {
            if (raw.length === 0) return null;
            for (const item of raw) {
                if (item && typeof item === 'object' && item.v !== undefined) {
                    contours.push(item as any);
                }
            }
        } else if (raw.v !== undefined) {
            contours.push(raw as any);
        } else {
            return null;
        }
        if (contours.length === 0) return null;
        const verts: any[] = [];
        let closed = true;
        for (const ct of contours) {
            const varr = ct.v as number[][];
            const iarr = ct.i as number[][];
            const oarr = ct.o as number[][];
            if (!varr || varr.length === 0) continue;
            closed = ct.c !== false;
            for (let j = 0; j < varr.length; j++) {
                if (!iarr[j] || !oarr[j]) continue;
                verts.push({ v: varr[j], i: iarr[j], o: oarr[j] });
            }
        }
        if (verts.length === 0) return null;
        return vertsToCmds(verts, closed);
    }

    if (type === 'ellipse') {
        const p = resolveProp(shape.position, frame, [0, 0]);
        const s = resolveProp(shape.size, frame, [100, 100]);
        let verts = ellipseToVerts(p, s);
        if (shape.direction === 3) verts = reverseVerts(verts);
        return vertsToCmds(verts, true);
    }

    if (type === 'rect') {
        const p = resolveProp(shape.position, frame, [0, 0]);
        const s = resolveProp(shape.size, frame, [100, 100]);
        const rd = shape.rd;
        let r = rd
            ? resolveProp(rd.radius, frame, 0)
            : resolveProp(shape.radius, frame, resolveProp(shape.roundness, frame, 0));
        let verts = rectToVerts(p, s, typeof r === 'number' ? r : 0);
        if (shape.direction === 3) verts = reverseVerts(verts);
        return vertsToCmds(verts, true);
    }

    if (type === 'star') {
        return vertsToCmds(starToVerts(shape, frame), true);
    }

    return null;
}

function resolveProp(prop: any, frame: number, def?: any): any {
    if (prop && typeof prop === 'object' && 'animated' in prop) {
        const v = interpolateKeyframes(prop, frame);
        return v ?? def;
    }
    return prop ?? def;
}

function toNumber(v: any): number {
    if (typeof v === 'number') return v;
    if (Array.isArray(v)) return v[0] ?? 0;
    return Number(v) || 0;
}

function lineLength(x1: number, y1: number, x2: number, y2: number): number {
    let x = x2 - x1;
    let y = y2 - y1;
    x = x < 0 ? -x : x;
    y = y < 0 ? -y : y;
    return x > y ? x + 0.375 * y : y + 0.375 * x;
}

function pathLength(cmds: PathCmd[]): number {
    let len = 0;
    let prevX = 0, prevY = 0;
    for (const cmd of cmds) {
        if (cmd.type === 'M') {
            prevX = cmd.pts![0];
            prevY = cmd.pts![1];
        } else if (cmd.type === 'L') {
            len += lineLength(prevX, prevY, cmd.pts![0], cmd.pts![1]);
            prevX = cmd.pts![0];
            prevY = cmd.pts![1];
        } else if (cmd.type === 'C') {
            const p = cmd.pts!;
            len += bezierLength({ p0: [prevX, prevY], p1: [p[0], p[1]], p2: [p[2], p[3]], p3: [p[4], p[5]] });
            prevX = p[4];
            prevY = p[5];
        }
    }
    return len;
}

function noloop(start: number, end: number): [number, number] {
    return [Math.min(start, end), Math.max(start, end)];
}

function loop(start: number, end: number): [number, number] {
    return [Math.max(start, end), Math.min(start, end)];
}

function trimSegment(rawStart: number, rawEnd: number, rawOffset: number): [number, number] {
    let start = rawStart / 100;
    let end = rawEnd / 100;
    const offset = (rawOffset % 360) / 360;
    const diff = Math.abs(start - end);
    if (vCompare(diff, 0)) return [0, 0];
    if (vCompare(diff, 1)) return [0, 1];
    if (offset > 0) {
        start += offset;
        end += offset;
        if (start <= 1 && end <= 1) return noloop(start, end);
        if (start > 1 && end > 1) return noloop(start - 1, end - 1);
        return start > 1 ? loop(start - 1, end) : loop(start, end - 1);
    } else {
        start += offset;
        end += offset;
        if (start >= 0 && end >= 0) return noloop(start, end);
        if (start < 0 && end < 0) return noloop(1 + start, 1 + end);
        return start < 0 ? loop(1 + start, end) : loop(start, 1 + end);
    }
}

function dasher(cmds: PathCmd[], dash: number[]): PathCmd[] {
    const result: PathCmd[] = [];
    const size = 2;
    if (!dash || dash.length === 0) return cmds;
    for (const d of dash) {
        if (!isFinite(d) || d < 0) return cmds;
    }
    if (!dash.some((d) => d > 0)) return cmds;
    let index = 0;
    let currentLength = 0;
    let startNewSegment = true;
    let curPt: [number, number] = [0, 0];
    let discard = false;

    function updateActiveSegment() {
        startNewSegment = true;
        if (discard) {
            discard = false;
            index = (index + 1) % size;
            currentLength = dash[index * 2];
        } else {
            discard = true;
            currentLength = dash[index * 2 + 1];
        }
        if (vIsZero(currentLength)) updateActiveSegment();
    }

    function addLine(p: [number, number]) {
        if (discard) return;
        if (startNewSegment) {
            result.push({ type: 'M', pts: [curPt[0], curPt[1]] });
            startNewSegment = false;
        }
        result.push({ type: 'L', pts: [p[0], p[1]] });
    }

    function addCubic(c1: [number, number], c2: [number, number], e: [number, number]) {
        if (discard) return;
        if (startNewSegment) {
            result.push({ type: 'M', pts: [curPt[0], curPt[1]] });
            startNewSegment = false;
        }
        result.push({ type: 'C', pts: [c1[0], c1[1], c2[0], c2[1], e[0], e[1]] });
    }

    function moveTo(p: [number, number]) {
        discard = false;
        startNewSegment = true;
        curPt = p;
        index = 0;
        currentLength = dash[0];
        if (vIsZero(currentLength)) updateActiveSegment();
    }

    function lineTo(p: [number, number]) {
        const len = lineLength(curPt[0], curPt[1], p[0], p[1]);
        let line = { x1: curPt[0], y1: curPt[1], x2: p[0], y2: p[1] };

        if (len <= currentLength) {
            currentLength -= len;
            addLine(p);
        } else {
            let length = len;
            let iter = 0;
            while (length > currentLength && iter++ < DASH_ITER_CAP) {
                length -= currentLength;
                const t = currentLength / (currentLength + length);
                const splitX = line.x1 + (line.x2 - line.x1) * t;
                const splitY = line.y1 + (line.y2 - line.y1) * t;
                addLine([splitX, splitY]);
                updateActiveSegment();
                line = { x1: splitX, y1: splitY, x2: line.x2, y2: line.y2 };
                curPt = [line.x1, line.y1];
            }
            if (length > DASH_TOLERANCE) {
                currentLength -= length;
                addLine([line.x2, line.y2]);
            }
        }

        if (currentLength < DASH_TOLERANCE) updateActiveSegment();

        curPt = p;
    }

    function cubicTo(c1: [number, number], c2: [number, number], e: [number, number]) {
        let b = { p0: curPt, p1: c1, p2: c2, p3: e };
        let bezLen = bezierLength(b);

        if (bezLen <= currentLength) {
            currentLength -= bezLen;
            addCubic(c1, c2, e);
        } else {
            let iter = 0;
            while (bezLen > currentLength && iter++ < DASH_ITER_CAP) {
                bezLen -= currentLength;
                const t = bezierTAtLength(b, currentLength, bezierLength(b));
                const [left, right] = bezierSplit(b, t);
                addCubic(left.p1, left.p2, left.p3);
                updateActiveSegment();
                b = right;
                curPt = b.p0;
            }
            if (bezLen > DASH_TOLERANCE) {
                currentLength -= bezLen;
                addCubic(b.p1, b.p2, b.p3);
            }
        }

        if (currentLength < DASH_TOLERANCE) updateActiveSegment();

        curPt = e;
    }

    for (const cmd of cmds) {
        if (cmd.type === 'M') {
            moveTo([cmd.pts![0], cmd.pts![1]]);
        } else if (cmd.type === 'L') {
            lineTo([cmd.pts![0], cmd.pts![1]]);
        } else if (cmd.type === 'C') {
            const p = cmd.pts!;
            cubicTo([p[0], p[1]], [p[2], p[3]], [p[4], p[5]]);
        }
    }

    return result;
}

function trimPath(cmds: PathCmd[], start: number, end: number): PathCmd[] {
    if (vCompare(start, end)) return [];
    if ((vCompare(start, 0) && vCompare(end, 1)) || (vCompare(start, 1) && vCompare(end, 0))) {
        return cmds;
    }
    const length = pathLength(cmds);
    if (length <= 0) return [];
    const MAX = Number.MAX_VALUE;
    const dash = start < end
        ? [0, length * start, (end - start) * length, MAX]
        : [length * end, (start - end) * length, (1 - start) * length, MAX];
    return dasher(cmds, dash);
}

interface CapturedPath {
    original: PathCmd[];
    current: PathCmd[];
    matrix: Mat3;
}

interface PaintRec {
    shape: ParsedShape;
    paths: CapturedPath[];
    matrix: Mat3;
    alpha: number;
}

interface TrimRec {
    shape: ParsedShape;
    paths: CapturedPath[];
}

interface WalkState {
    paths: CapturedPath[];
    paints: PaintRec[];
    trims: TrimRec[];
    repeatCopies: RepeatCopyRec[];
}

interface RepeatCopyRec {
    shape: ParsedShape;
    content: ParsedShape[];
    mat: Mat3;
    alpha: number;
}

function repeaterMatrix(tr: ParsedTransform | undefined, frame: number, n: number): Mat3 {
    const pos = tr ? resolveProp(tr.position, frame, [0, 0]) : [0, 0];
    const anchor = tr ? resolveProp(tr.anchor, frame, [0, 0]) : [0, 0];
    const rot = tr ? toNumber(resolveProp(tr.rotation, frame, 0)) : 0;
    const scale = tr ? resolveProp(tr.scale, frame, [100, 100]) : [100, 100];
    const sx = Math.pow(toNumber(scale[0]) / 100, n);
    const sy = Math.pow(toNumber(scale[1]) / 100, n);
    let m = matTranslate(toNumber(pos[0]) * n + toNumber(anchor[0]), toNumber(pos[1]) * n + toNumber(anchor[1]));
    m = matMul(m, matScale(sx, sy));
    m = matMul(m, matRotate(rot * n));
    m = matMul(m, matTranslate(-toNumber(anchor[0]), -toNumber(anchor[1])));
    return m;
}

function maxPropertyNumber(prop: ParsedProperty | undefined, fallback: number): number {
    if (!prop) return fallback;
    let m = fallback;
    const consider = (v: any) => {
        const n = Array.isArray(v) ? v[0] : v;
        if (typeof n === 'number' && Number.isFinite(n) && n > m) m = n;
    };
    consider(prop.value);
    for (const k of prop.keyframes || []) {
        consider(k.s);
        if (k.e !== undefined) consider(k.e);
    }
    return m;
}

function renderRepeatCopies(ctx: CanvasRenderingContext2D, rec: RepeatCopyRec, frame: number) {
    const r = rec.shape;
    const copiesFloat = toNumber(resolveProp(r.copies, frame, 0));
    if (!Number.isFinite(copiesFloat) || copiesFloat <= 0) return;

    const maxCopy = maxPropertyNumber(r.copies, 0);
    const maxCopies = !Number.isFinite(maxCopy) || maxCopy <= 0 ? 0 : Math.min(10000, Math.trunc(maxCopy));
    if (maxCopies <= 0) return;
    const offset = toNumber(resolveProp(r.copiesOffset, frame, 0));
    const tr = r.transform;
    const so = tr ? toNumber(resolveProp(tr.startOpacity, frame, 100)) / 100 : 1;
    const eo = tr ? toNumber(resolveProp(tr.endOpacity, frame, 100)) / 100 : 1;
    const visible = Math.trunc(copiesFloat);
    for (let i = 0; i < maxCopies; i++) {
        let alpha = rec.alpha * (so + (eo - so) * (i / copiesFloat));
        if (i >= visible) alpha = 0;
        if (alpha <= 0) continue;
        const copyMat = matMul(rec.mat, repeaterMatrix(tr, frame, i + offset));
        const w: WalkState = { paths: [], paints: [], trims: [], repeatCopies: [] };
        walkShapeGroup(rec.content, frame, copyMat, alpha, w, 0);
        for (const t of w.trims) applyTrim(t, frame);
        for (const c of w.repeatCopies) renderRepeatCopies(ctx, c, frame);
        drawPaints(ctx, w.paints, frame);
    }
}

function walkShapeGroup(shapes: ParsedShape[], frame: number, mat: Mat3, alpha: number, walk: WalkState, start: number) {
    for (let i = shapes.length - 1; i >= 0; i--) {
        if (shapes[i].type !== 'repeater') continue;
        walk.repeatCopies.push({ shape: shapes[i], content: shapes.slice(0, i), mat, alpha });
        const after = shapes.slice(i + 1);
        if (after.length > 0) walkShapeGroup(after, frame, mat, alpha, walk, walk.paths.length);
        return;
    }

    const ownIndices: number[] = [];
    const pendingPaints: { shape: ParsedShape; matrix: Mat3; alpha: number }[] = [];
    const pendingTrims: { shape: ParsedShape }[] = [];

    for (const shape of shapes) {
        const type = shape.type;

        if (type === 'transform') continue;

        if (type === 'group') {
            let gMat = mat;
            let gAlpha = alpha;
            const kids: ParsedShape[] = [];
            for (const child of shape.children || []) {
                if (child.type === 'transform') {
                    gMat = matMul(mat, matFromTransform(child, frame));
                    gAlpha = alpha * (toNumber(resolveProp(child.opacity, frame, 100)) / 100);
                } else {
                    kids.push(child);
                }
            }
            walkShapeGroup(kids, frame, gMat, gAlpha, walk, walk.paths.length);
            continue;
        }

        if (type === 'trim') {
            pendingTrims.push({ shape });
            continue;
        }

        if (type === 'fill' || type === 'stroke' || type === 'gradientFill' || type === 'gradientStroke') {
            const paintAlpha = alpha * (toNumber(resolveProp(shape.opacity, frame, 100)) / 100);
            pendingPaints.push({ shape, matrix: mat, alpha: paintAlpha });
            continue;
        }

        if (type === 'merge') continue;

        const cmds = shapeCmds(shape, frame);
        if (cmds) {
            ownIndices.push(walk.paths.length);
            walk.paths.push({ original: cmds, current: cmds, matrix: mat });
        }
    }

    const groupPaths = ownIndices.map((i) => walk.paths[i]);
    for (const p of pendingPaints) {
        walk.paints.push({ shape: p.shape, paths: groupPaths, matrix: p.matrix, alpha: p.alpha });
    }
    for (const t of pendingTrims) {
        walk.trims.push({ shape: t.shape, paths: groupPaths });
    }
}

function applyTrim(trim: TrimRec, frame: number) {
    const sRaw = toNumber(resolveProp(trim.shape.start, frame, 0));
    const eRaw = toNumber(resolveProp(trim.shape.end, frame, 100));
    const oRaw = toNumber(resolveProp(trim.shape.offset, frame, 0));
    const [start, end] = trimSegment(sRaw, eRaw, oRaw);

    if (vCompare(start, end)) {
        for (const p of trim.paths) p.current = [];
        return;
    }
    if (vCompare(Math.abs(start - end), 1)) {
        for (const p of trim.paths) p.current = p.original;
        return;
    }

    if (trim.shape.trimMode !== 'individually') {
        for (const p of trim.paths) {
            p.current = trimPath(p.original, start, end);
        }
        return;
    }

    let totalLength = 0;
    for (const p of trim.paths) totalLength += pathLength(p.original);
    const startLen = totalLength * start;
    const endLen = totalLength * end;

    if (startLen < endLen) {
        let curLen = 0;
        for (const p of trim.paths) {
            if (curLen > endLen) {
                p.current = [];
                continue;
            }
            const len = pathLength(p.original);
            if (len <= 0) {
                curLen += len;
                continue;
            }
            if (curLen < startLen && curLen + len < startLen) {
                curLen += len;
                p.current = [];
                continue;
            }
            if (startLen <= curLen && endLen >= curLen + len) {
                curLen += len;
                continue;
            }
            const localStart = (startLen > curLen ? startLen - curLen : 0) / len;
            const localEnd = (curLen + len < endLen ? len : endLen - curLen) / len;
            p.current = trimPath(p.original, localStart, localEnd);
            curLen += len;
        }
    }
}

function paintColorStyle(paint: PaintRec, frame: number): string {
    const alpha = paint.alpha;
    return colorToStyle(resolveProp(paint.shape.color, frame, [0, 0, 0]), alpha);
}

function paintGradient(ctx: CanvasRenderingContext2D, paint: PaintRec, frame: number): CanvasGradient | null {
    const g = paint.shape.gradient;
    if (!g) return null;
    const matrix = paint.matrix;
    const start = resolveProp(g.startPoint, frame, [0, 0]);
    const end = resolveProp(g.endPoint, frame, [0, 0]);
    const s = matApply(matrix, toNumber(start[0]), toNumber(start[1]));
    const e = matApply(matrix, toNumber(end[0]), toNumber(end[1]));
    let grad: CanvasGradient;
    if (g.type === 2) {
        const r = Math.hypot(e[0] - s[0], e[1] - s[1]);
        grad = ctx.createRadialGradient(s[0], s[1], 0, e[0], e[1], r);
    } else {
        grad = ctx.createLinearGradient(s[0], s[1], e[0], e[1]);
    }
    const stops = resolveProp(g.stops, frame, []);
    const alpha = paint.alpha;
    if (Array.isArray(stops)) {
        const flat = Array.isArray(stops[0]);
        if (flat) {
            for (const entry of stops) {
                const off = toNumber(entry[0]);
                grad.addColorStop(Math.max(0, Math.min(1, off)), `rgba(${Math.round(entry[1] * 255)},${Math.round(entry[2] * 255)},${Math.round(entry[3] * 255)},${alpha})`);
            }
        } else {
            const pointCount = g.colorPoints && g.colorPoints > 0 ? g.colorPoints : 0;
            let channels = 4;
            if (pointCount > 0 && stops.length % pointCount === 0) {
                const perPoint = stops.length / pointCount;
                if (perPoint === 4 || perPoint === 5) channels = perPoint;
            }
            const hasAlpha = channels === 5;
            for (let i = 0; i + 3 < stops.length; i += channels) {
                const off = toNumber(stops[i]);
                const r = Math.round(toNumber(stops[i + 1]) * 255);
                const g2 = Math.round(toNumber(stops[i + 2]) * 255);
                const b = Math.round(toNumber(stops[i + 3]) * 255);
                const a = hasAlpha ? toNumber(stops[i + 4]) * alpha : alpha;
                grad.addColorStop(Math.max(0, Math.min(1, off)), `rgba(${r},${g2},${b},${a})`);
            }
        }
    }
    return grad;
}

function drawPaints(ctx: CanvasRenderingContext2D, paints: PaintRec[], frame: number) {
    for (let i = paints.length - 1; i >= 0; i--) {
        const paint = paints[i];
        const type = paint.shape.type;

        const cmds: PathCmd[] = [];
        for (const p of paint.paths) {
            if (p.current.length === 0) continue;
            cmds.push(...transformCmds(p.current, p.matrix));
        }
        if (cmds.length === 0) continue;

        const isFill = type === 'fill' || type === 'gradientFill';
        if (isFill) {
            ctx.beginPath();
            drawCmds(ctx, cmds);
            const grad = paintGradient(ctx, paint, frame);
            if (grad) {
                ctx.fillStyle = grad;
            } else {
                ctx.fillStyle = paintColorStyle(paint, frame);
            }
            const rule = paint.shape.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';
            ctx.fill(rule);
        } else {
            ctx.beginPath();
            drawCmds(ctx, cmds);
            const grad = paintGradient(ctx, paint, frame);
            if (grad) {
                ctx.strokeStyle = grad;
            } else {
                ctx.strokeStyle = paintColorStyle(paint, frame);
            }
            const width = toNumber(resolveProp(paint.shape.strokeWidth, frame, 0)) * matScaleOf(paint.matrix);
            ctx.lineWidth = width;
            const lc = paint.shape.lineCap;
            if (lc != null) ctx.lineCap = (['butt', 'round', 'square'][lc - 1] || 'butt') as CanvasLineCap;
            const lj = paint.shape.lineJoin;
            if (lj != null) ctx.lineJoin = (['miter', 'round', 'bevel'][lj - 1] || 'miter') as CanvasLineJoin;
            if (paint.shape.miterLimit != null) ctx.miterLimit = paint.shape.miterLimit;
            const scale = matScaleOf(paint.matrix);
            const dashInfo: number[] = [];
            if (paint.shape.dashes) {
                for (const d of paint.shape.dashes) {
                    dashInfo.push(toNumber(resolveProp(d.value, frame, 0)));
                }
            }
            let dashOffset = 0;
            let pattern: number[] | null = null;
            if (dashInfo.length > 1) {
                if (dashInfo.length % 2 === 0) {
                    dashInfo.push(dashInfo[dashInfo.length - 1]);
                    dashInfo[dashInfo.length - 2] = dashInfo[dashInfo.length - 3];
                }
                dashOffset = dashInfo[dashInfo.length - 1] * scale;
                pattern = dashInfo.slice(0, -1).map((v) => v * scale);
                let noLength = true;
                let noGap = true;
                for (let i = 0; i < pattern.length; i += 2) {
                    if (!vIsZero(pattern[i])) noLength = false;
                    if (!vIsZero(pattern[i + 1])) noGap = false;
                }
                if (noLength) return;
                if (noGap) pattern = null;
            }
            if (pattern) {
                ctx.setLineDash(pattern);
                ctx.lineDashOffset = dashOffset;
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.lineDashOffset = 0;
            } else {
                ctx.stroke();
            }
        }
    }
}

function renderShapes(ctx: CanvasRenderingContext2D, shapes: ParsedShape[], frame: number, mat: Mat3) {
    const walk: WalkState = { paths: [], paints: [], trims: [], repeatCopies: [] };
    walkShapeGroup(shapes, frame, mat, 1, walk, 0);
    for (const trim of walk.trims) applyTrim(trim, frame);
    for (const copy of walk.repeatCopies) renderRepeatCopies(ctx, copy, frame);
    drawPaints(ctx, walk.paints, frame);
}

function layerVisible(layer: ParsedLayer, frame: number): boolean {
    if (layer.inFrame != null && frame < layer.inFrame) return false;
    if (layer.outFrame != null && frame > layer.outFrame) return false;
    return true;
}

function layerCombinedMatrix(layer: ParsedLayer, frame: number, layerById: Map<number, ParsedLayer>, base: Mat3): Mat3 {
    const chain: Mat3[] = [];
    let parent = layer.parentIndex != null ? layerById.get(layer.parentIndex) : undefined;
    let depth = 0;
    while (parent && depth < MAX_PARENT_DEPTH) {
        chain.push(matFromTransform(parent.transform, frame));
        parent = parent.parentIndex != null ? layerById.get(parent.parentIndex) : undefined;
        depth++;
    }
    let m = base;
    for (let i = chain.length - 1; i >= 0; i--) m = matMul(m, chain[i]);
    m = matMul(m, matFromTransform(layer.transform, frame, layer.autoOrient === 1));
    return m;
}

const bufferPool = new Map<string, HTMLCanvasElement>();
const MAX_BUFFER_POOL_PIXELS = 12_000_000;
let bufferPoolPixels = 0;

function getBuffer(w: number, h: number, tag: string): HTMLCanvasElement {
    const key = tag + ':' + w + 'x' + h;
    let c = bufferPool.get(key);
    if (!c) {
        const el: HTMLCanvasElement | OffscreenCanvas = typeof document !== 'undefined'
            ? document.createElement('canvas')
            : new OffscreenCanvas(w, h);
        el.width = w;
        el.height = h;
        c = el as unknown as HTMLCanvasElement;
        bufferPool.set(key, c);
        bufferPoolPixels += w * h;
        while (bufferPoolPixels > MAX_BUFFER_POOL_PIXELS && bufferPool.size > 1) {
            const oldestKey = bufferPool.keys().next().value;
            if (oldestKey === undefined) break;
            const oldest = bufferPool.get(oldestKey)!;
            bufferPool.delete(oldestKey);
            bufferPoolPixels -= oldest.width * oldest.height;
        }
    }
    return c;
}

export function getBufferPoolStats(): { size: number; pixels: number; maxPixels: number } {
    return { size: bufferPool.size, pixels: bufferPoolPixels, maxPixels: MAX_BUFFER_POOL_PIXELS };
}

function rectOf(x: number, y: number, w: number, h: number): Rect {
    return { x, y, w, h };
}

function applyLuma(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a === 0) continue;
        const lum = Math.trunc(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = lum;
    }
    ctx.putImageData(image, 0, 0);
}

export type LayerOrder = 'default' | 'reversed';

function renderCompLayers(
    ctx: CanvasRenderingContext2D,
    layers: ParsedLayer[],
    frame: number,
    base: Mat3,
    parentAlpha: number,
    clipRect: Rect,
    assets: ParsedAsset[],
    anim: ParsedAnimation,
    layerOrder: LayerOrder = 'default',
    hiddenLayers?: (name?: string) => boolean,
) {
    const layerById = new Map<number, ParsedLayer>();
    for (const l of layers) layerById.set(l.index, l);

    if (layerOrder === 'reversed') {
        const matteFor = new Map<number, ParsedLayer>();
        {
            let matte: ParsedLayer | null = null;
            for (let i = layers.length - 1; i >= 0; i--) {
                const layer = layers[i];
                if (layer.matteType) {
                    matte = layer;
                } else {
                    if (matte) matteFor.set(layer.index, matte);
                    matte = null;
                }
            }
        }

        for (let i = 0; i < layers.length; i++) {
            const layer = layers[i];
            if (layer.matteType) continue;
            if (hiddenLayers?.(layer.name)) continue;
            if (!layerVisible(layer, frame)) continue;
            const matte = matteFor.get(layer.index);
            if (matte) {
                if (layerVisible(matte, frame)) {
                    renderMattePair(ctx, matte, layer, frame, base, parentAlpha, clipRect, assets, layerById, anim, layerOrder);
                }
            } else {
                renderLayer(ctx, layer, frame, base, parentAlpha, clipRect, assets, layerById, anim, layerOrder);
            }
        }
        return;
    }

    let matte: ParsedLayer | null = null;
    for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i];
        if (layer.matteType) {
            matte = layer;
        } else {
            if (layerVisible(layer, frame) && !hiddenLayers?.(layer.name)) {
                if (matte) {
                    if (layerVisible(matte, frame)) {
                        renderMattePair(ctx, matte, layer, frame, base, parentAlpha, clipRect, assets, layerById, anim, layerOrder);
                    }
                } else {
                    renderLayer(ctx, layer, frame, base, parentAlpha, clipRect, assets, layerById, anim, layerOrder);
                }
            }
            matte = null;
        }
    }
}

function renderMattePair(
    ctx: CanvasRenderingContext2D,
    matte: ParsedLayer,
    src: ParsedLayer,
    frame: number,
    base: Mat3,
    parentAlpha: number,
    clipRect: Rect,
    assets: ParsedAsset[],
    layerById: Map<number, ParsedLayer>,
    anim: ParsedAnimation,
    layerOrder: LayerOrder = 'default',
) {
    const w = Math.max(1, Math.ceil(clipRect.w));
    const h = Math.max(1, Math.ceil(clipRect.h));
    const localClip = rectOf(0, 0, w, h);
    const shifted = matMul(matTranslate(-clipRect.x, -clipRect.y), base);

    const srcCanvas = getBuffer(w, h, 'matte-src');
    const srcCtx = srcCanvas.getContext('2d')!;
    srcCtx.setTransform(1, 0, 0, 1, 0, 0);
    srcCtx.clearRect(0, 0, w, h);
    srcCtx.save();
    srcCtx.beginPath();
    srcCtx.rect(0, 0, w, h);
    srcCtx.clip();
    renderLayer(srcCtx, src, frame, shifted, parentAlpha, localClip, assets, layerById, anim, layerOrder);
    srcCtx.restore();

    const matteCanvas = getBuffer(w, h, 'matte-layer');
    const matteCtx = matteCanvas.getContext('2d')!;
    matteCtx.setTransform(1, 0, 0, 1, 0, 0);
    matteCtx.clearRect(0, 0, w, h);
    matteCtx.save();
    matteCtx.beginPath();
    matteCtx.rect(0, 0, w, h);
    matteCtx.clip();
    renderLayer(matteCtx, matte, frame, shifted, parentAlpha, localClip, assets, layerById, anim, layerOrder);
    matteCtx.restore();

    const type = matte.matteType ?? MatteType.None;
    if (type === MatteType.Luma || type === MatteType.LumaInv) {
        applyLuma(srcCanvas);
    }

    matteCtx.globalCompositeOperation = (type === MatteType.Alpha || type === MatteType.Luma)
        ? 'destination-in'
        : 'destination-out';
    matteCtx.drawImage(srcCanvas, 0, 0);
    matteCtx.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(matteCanvas, clipRect.x, clipRect.y);
    ctx.restore();
}

function precompChildren(layer: ParsedLayer, assets: ParsedAsset[]): ParsedLayer[] {
    if (layer.refId) {
        const asset = assets.find(a => a.id === layer.refId);
        if (asset && asset.layers) return asset.layers;
    }
    return [];
}

function renderPrecomp(
    ctx: CanvasRenderingContext2D,
    layer: ParsedLayer,
    frame: number,
    m: Mat3,
    opacity: number,
    clipRect: Rect,
    assets: ParsedAsset[],
    layerById: Map<number, ParsedLayer>,
    anim: ParsedAnimation,
    layerOrder: LayerOrder = 'default',
) {
    const children = precompChildren(layer, assets);

    let mappedFrame: number;
    const tm = layer.timeRemap;
    if (tm && tm.animated && tm.keyframes && tm.keyframes.length > 0) {
        const t = toNumber(interpolateKeyframes(tm, frame));
        const frameDuration = Math.max(anim.outFrame - anim.inFrame, 0);
        const pos = frameDuration > 0 ? t * anim.fps / frameDuration : 0;
        mappedFrame = Math.round(Math.min(1, Math.max(0, pos)) * frameDuration);
    } else {
        mappedFrame = frame - (layer.startTime ?? 0);
    }
    mappedFrame = Math.trunc(mappedFrame / (layer.stretch ?? 1));

    const hasSize = (layer.layerWidth ?? 0) > 0 && (layer.layerHeight ?? 0) > 0;
    let layerClip: Rect | null = clipRect;
    if (hasSize) {
        const [bx, by, bw, bh] = transformRectBounds(m, 0, 0, layer.layerWidth!, layer.layerHeight!);
        layerClip = intersectRect(clipRect, rectOf(bx, by, bw, bh));
    }
    if (!layerClip) return;

    const complexContent = children.length > 1;
    const childAlpha = complexContent ? 1 : opacity;

    if (!vCompare(opacity, 1) && complexContent) {
        const w = Math.max(1, Math.ceil(layerClip.w));
        const h = Math.max(1, Math.ceil(layerClip.h));
        const buf = getBuffer(w, h, 'precomp');
        const bctx = buf.getContext('2d')!;
        bctx.setTransform(1, 0, 0, 1, 0, 0);
        bctx.clearRect(0, 0, w, h);
        bctx.save();
        bctx.beginPath();
        bctx.rect(0, 0, w, h);
        bctx.clip();
        renderCompLayers(
            bctx, children, mappedFrame,
            matMul(matTranslate(-layerClip.x, -layerClip.y), m),
            childAlpha, rectOf(0, 0, w, h), assets, anim, layerOrder,
        );
        bctx.restore();
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = opacity;
        ctx.drawImage(buf, layerClip.x, layerClip.y);
        ctx.restore();
        return;
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(layerClip.x, layerClip.y, layerClip.w, layerClip.h);
    ctx.clip();
    renderCompLayers(ctx, children, mappedFrame, m, childAlpha, layerClip, assets, anim, layerOrder);
    ctx.restore();
}

const imageBitmaps = new Map<string, ImageBitmap | null>();
const imageDecodes = new Map<string, Promise<ImageBitmap | null>>();
const MAX_IMAGE_BITMAPS = 200;

function evictOldestImageCache(): void {
    if (imageBitmaps.size < MAX_IMAGE_BITMAPS) return;
    const oldest = imageBitmaps.keys().next().value;
    if (oldest === undefined) return;
    const bmp = imageBitmaps.get(oldest);
    if (bmp) {
        try { bmp.close(); } catch {}
    }
    imageBitmaps.delete(oldest);
}

function decodeImageAsset(a: ParsedAsset): ImageBitmap | null {
    if (!a.p) return null;
    if (imageBitmaps.has(a.id)) return imageBitmaps.get(a.id) || null;
    if (imageDecodes.has(a.id)) return null;
    const raw = a.p;
    const b64 = raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw;
    const p = (async () => {
        try {
            if (typeof createImageBitmap !== 'function' || typeof atob !== 'function') return null;
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return await createImageBitmap(new Blob([bytes]));
        } catch {
            return null;
        } finally {
            imageDecodes.delete(a.id);
        }
    })();
    imageDecodes.set(a.id, p);
    void p.then((b) => { evictOldestImageCache(); imageBitmaps.set(a.id, b); });
    return null;
}

function renderImage(ctx: CanvasRenderingContext2D, layer: ParsedLayer, m: Mat3, opacity: number, clipRect: Rect, assets: ParsedAsset[]) {
    if (!layer.refId) return;
    const asset = assets.find((a) => a.id === layer.refId);
    if (!asset || !asset.p) return;
    const bmp = decodeImageAsset(asset);
    if (!bmp) return;
    const w = asset.w || bmp.width || 1;
    const h = asset.h || bmp.height || 1;
    if (vCompare(opacity, 1)) {
        ctx.save();
        ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
        ctx.drawImage(bmp, 0, 0, w, h);
        ctx.restore();
        return;
    }
    const bw = Math.max(1, Math.ceil(clipRect.w));
    const bh = Math.max(1, Math.ceil(clipRect.h));
    const buf = getBuffer(bw, bh, 'image');
    const bctx = buf.getContext('2d')!;
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, bw, bh);
    bctx.save();
    bctx.beginPath();
    bctx.rect(0, 0, bw, bh);
    bctx.clip();
    const m2 = matMul(matTranslate(-clipRect.x, -clipRect.y), m);
    bctx.setTransform(m2[0], m2[1], m2[2], m2[3], m2[4], m2[5]);
    bctx.drawImage(bmp, 0, 0, w, h);
    bctx.restore();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = opacity;
    ctx.drawImage(buf, clipRect.x, clipRect.y);
    ctx.restore();
}

function renderSolid(ctx: CanvasRenderingContext2D, layer: ParsedLayer, m: Mat3, opacity: number) {
    const sw = layer.solidWidth ?? 0;
    const sh = layer.solidHeight ?? 0;
    const cmds: PathCmd[] = [
        { type: 'M', pts: [sw, 0] },
        { type: 'L', pts: [sw, sh] },
        { type: 'L', pts: [0, sh] },
        { type: 'L', pts: [0, 0] },
        { type: 'Z' },
    ];
    ctx.beginPath();
    drawCmds(ctx, transformCmds(cmds, m));
    ctx.fillStyle = colorToStyle(layer.solidColor, opacity);
    ctx.fill();
}

interface TextDoc {
    text: string;
    fontSize?: number;
    fontFamily?: string;
    fillColor?: number[];
    justify?: number;
    lineHeight?: number;
    tracking?: number;
    strokeColor?: number[];
    strokeWidth?: number;
}

function textDocAt(text: ParsedText, frame: number): TextDoc {
    const base: TextDoc = {
        text: text.text,
        fontSize: text.fontSize,
        fontFamily: text.fontFamily,
        fillColor: text.fillColor,
        justify: text.justify,
        lineHeight: text.lineHeight,
        tracking: text.tracking,
        strokeColor: text.strokeColor,
        strokeWidth: text.strokeWidth,
    };
    let cur: TextKeyframe | undefined;
    for (const k of text.keyframes ?? []) {
        if (k.at <= frame) cur = k;
        else break;
    }
    if (!cur) return base;
    return {
        text: cur.text != null ? cur.text : base.text,
        fontSize: cur.fontSize ?? base.fontSize,
        fontFamily: cur.fontFamily ?? base.fontFamily,
        fillColor: cur.fillColor ?? base.fillColor,
        justify: cur.justify ?? base.justify,
        lineHeight: cur.lineHeight ?? base.lineHeight,
        tracking: cur.tracking ?? base.tracking,
        strokeColor: cur.strokeColor ?? base.strokeColor,
        strokeWidth: cur.strokeWidth ?? base.strokeWidth,
    };
}

function renderText(ctx: CanvasRenderingContext2D, layer: ParsedLayer, m: Mat3, opacity: number, frame: number) {
    const t = layer.text;
    if (!t || !t.text) return;
    const doc = textDocAt(t, frame);
    const size = doc.fontSize && doc.fontSize > 0 ? doc.fontSize : 24;
    const rawFamily = (doc.fontFamily || '').split(',')[0]?.trim() || '';
    const keep = ['Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Times New Roman', 'Georgia', 'Garamond', 'Courier New', 'sans-serif', 'serif', 'monospace'];
    const font = keep.some((f) => f.toLowerCase() === rawFamily.toLowerCase()) ? rawFamily : 'sans-serif';
    ctx.save();
    const base = ctx.getTransform();
    const cm = matMul([base.a, base.b, base.c, base.d, base.e, base.f], m);
    ctx.setTransform(cm[0], cm[1], cm[2], cm[3], cm[4], cm[5]);
    ctx.font = `${size}px ${font}`;
    const justify = doc.justify ?? 0;
    ctx.textAlign = justify === 1 ? 'right' : justify === 2 ? 'center' : 'left';
    ctx.textBaseline = 'middle';
    const lh = doc.lineHeight && doc.lineHeight > 0 ? doc.lineHeight : Math.round(size * 1.2);
    const lines = String(doc.text).split('\n');
    const y0 = -((lines.length - 1) * lh) / 2;
    const strokeW = doc.strokeWidth || 0;
    const hasStroke = strokeW > 0 && !!doc.strokeColor;
    for (let i = 0; i < lines.length; i++) {
        const y = y0 + i * lh;
        if (hasStroke) {
            ctx.strokeStyle = colorToStyle(doc.strokeColor, opacity);
            ctx.lineWidth = strokeW;
            ctx.strokeText(lines[i], 0, y);
        }
        ctx.fillStyle = colorToStyle(doc.fillColor || [1, 1, 1, 1], opacity);
        ctx.fillText(lines[i], 0, y);
    }
    ctx.restore();
}

function renderLayer(
    ctx: CanvasRenderingContext2D,
    layer: ParsedLayer,
    frame: number,
    base: Mat3,
    parentAlpha: number,
    clipRect: Rect,
    assets: ParsedAsset[],
    layerById: Map<number, ParsedLayer>,
    anim: ParsedAnimation,
    layerOrder: LayerOrder = 'default',
) {
    if (!layerVisible(layer, frame)) return;

    const m = layerCombinedMatrix(layer, frame, layerById, base);

    const opacity = parentAlpha * (toNumber(resolveProp(layer.transform.opacity, frame, 100)) / 100);
    if (vIsZero(opacity)) return;

    if (layer.type === LayerType.Shape) {
        if (vCompare(opacity, 1)) {
            renderShapes(ctx, layer.shapes || [], frame, m);
        } else {
            const w = Math.max(1, Math.ceil(clipRect.w));
            const h = Math.max(1, Math.ceil(clipRect.h));
        const buf = getBuffer(w, h, 'shape');
            const bctx = buf.getContext('2d')!;
            bctx.setTransform(1, 0, 0, 1, 0, 0);
            bctx.clearRect(0, 0, w, h);
            bctx.save();
            bctx.beginPath();
            bctx.rect(0, 0, w, h);
            bctx.clip();
            renderShapes(bctx, layer.shapes || [], frame, matMul(matTranslate(-clipRect.x, -clipRect.y), m));
            bctx.restore();
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = opacity;
            ctx.drawImage(buf, clipRect.x, clipRect.y);
            ctx.restore();
        }
    } else if (layer.type === LayerType.Precomp) {
        renderPrecomp(ctx, layer, frame, m, opacity, clipRect, assets, layerById, anim, layerOrder);
    } else if (layer.type === LayerType.Solid) {
        renderSolid(ctx, layer, m, opacity);
    } else if (layer.type === LayerType.Text) {
        renderText(ctx, layer, m, opacity, frame);
    } else if (layer.type === LayerType.Image) {
        renderImage(ctx, layer, m, opacity, clipRect, assets);
    }
}

export function renderFrame(
    canvas: HTMLCanvasElement,
    anim: ParsedAnimation,
    frame: number,
    dpr: number,
    displayW?: number,
    displayH?: number,
    layerOrder: LayerOrder = 'default',
    hiddenLayers?: (name?: string) => boolean,
) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dispW = displayW ?? (canvas.clientWidth || anim.width);
    const dispH = displayH ?? (canvas.clientHeight || anim.height);
    if (dispW === 0 || dispH === 0) return;

    const w = Math.round(dispW * dpr);
    const h = Math.round(dispH * dpr);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const root = compositionMatrix(anim, canvas.width, canvas.height);
    const clip: Rect = { x: 0, y: 0, w: canvas.width, h: canvas.height };
    renderCompLayers(ctx, anim.layers, frame, root, 1, clip, anim.assets, anim, layerOrder, hiddenLayers);
}

function compositionMatrix(anim: ParsedAnimation, w: number, h: number): Mat3 {
    const sx = w / anim.width;
    const sy = h / anim.height;
    const scale = Math.min(sx, sy);
    const tx = (w - anim.width * scale) / 2;
    const ty = (h - anim.height * scale) / 2;
    return matMul(matTranslate(tx, ty), matScale(scale, scale));
}
