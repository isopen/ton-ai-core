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
    return false;
}
