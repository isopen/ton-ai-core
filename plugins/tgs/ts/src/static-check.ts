import type { ParsedAnimation, ParsedLayer } from './types.js';

function walkAnimated(obj: any, seen: Set<object>): boolean {
    if (!obj || typeof obj !== 'object') return false;
    if (seen.has(obj)) return false;
    seen.add(obj);
    if (typeof obj.animated === 'boolean') {
        if (obj.animated) return true;
        return walkAnimated(obj.x, seen) || walkAnimated(obj.y, seen);
    }
    if (Array.isArray(obj)) {
        for (const item of obj) {
            if (walkAnimated(item, seen)) return true;
        }
        return false;
    }
    for (const key of Object.keys(obj)) {
        const v = obj[key];
        if (v && typeof v === 'object' && walkAnimated(v, seen)) return true;
    }
    return false;
}

function isLayerAnimated(layer: ParsedLayer | undefined, seen: Set<object>): boolean {
    if (!layer) return false;
    if (layer.text && Array.isArray(layer.text.keyframes) && layer.text.keyframes.length > 0) return true;
    return walkAnimated(layer, seen);
}

export function hasAnimatedProperties(anim: ParsedAnimation): boolean {
    const seen = new Set<object>();
    for (const layer of anim.layers) {
        if (isLayerAnimated(layer, seen)) return true;
    }
    for (const asset of anim.assets) {
        for (const layer of asset.layers || []) {
            if (isLayerAnimated(layer, seen)) return true;
        }
    }
    return hasTimedLayers(anim);
}

function hasTimedLayers(anim: ParsedAnimation): boolean {
    if (anim.layers.length > 1) {
        for (const layer of anim.layers) {
            if (!layer) continue;
            if (layer.inFrame == null) continue;
            if (layer.inFrame > anim.inFrame) return true;
            if (layer.outFrame != null && layer.outFrame < anim.outFrame) return true;
        }
    }
    for (const asset of anim.assets) {
        const ls = asset.layers || [];
        if (ls.length <= 1) continue;
        const s0 = ls[0].inFrame ?? null;
        const e0 = ls[0].outFrame ?? null;
        for (const layer of ls) {
            if ((layer.inFrame ?? null) !== s0 || (layer.outFrame ?? null) !== e0) return true;
        }
    }
    return false;
}
