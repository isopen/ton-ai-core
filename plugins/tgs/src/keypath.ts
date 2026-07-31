import type { ParsedAnimation, ParsedLayer, ParsedProperty, ParsedShape } from './types.js';

export enum Property {
    FillColor,
    FillOpacity,
    StrokeColor,
    StrokeOpacity,
    StrokeWidth,
    TrAnchor,
    TrPosition,
    TrScale,
    TrRotation,
    TrOpacity,
    TrimStart,
    TrimEnd,
}

export interface FrameInfo {
    curFrame: number;
}

export type PropertyValue =
    | number
    | number[]
    | ((info: FrameInfo) => number | number[]);

const overrides = new WeakMap<object, PropertyValue>();

/**
 * rlottie keypath matching (lottiekeypath.cpp): segments separated by '.',
 * `*` matches a single segment, `**` matches any number of segments.
 */
export function matchKeyPath(pattern: string, path: string[]): boolean {
    const p = pattern.split('.').filter((s) => s.length > 0);
    const s = path;

    let pi = 0;
    let si = 0;
    let starSi = -1;
    let starPi = -1;

    while (si < s.length) {
        if (pi < p.length && (p[pi] === '**')) {
            starPi = pi++;
            starSi = si;
            continue;
        }
        if (pi < p.length && (p[pi] === '*' || p[pi] === s[si])) {
            pi++;
            si++;
            continue;
        }
        if (starPi !== -1) {
            pi = starPi + 1;
            si = ++starSi;
            continue;
        }
        return false;
    }
    while (pi < p.length && p[pi] === '**') pi++;
    return pi === p.length;
}

function shapeName(shape: ParsedShape): string {
    return shape.name ?? shape.matchName ?? '';
}

function layerPath(layer: ParsedLayer): string[] {
    const segments: string[] = [];
    if (layer.name) segments.push(layer.name);
    else segments.push(`Layer ${layer.index}`);
    return segments;
}

function withOverrides(property: ParsedProperty, value: PropertyValue): ParsedProperty {
    const prop: ParsedProperty = {
        animated: property.animated,
        value: property.value,
        keyframes: property.keyframes,
    };
    if (property.x) prop.x = property.x;
    if (property.y) prop.y = property.y;
    overrides.set(prop, value);
    return prop;
}

interface TransformLike {
    anchor?: ParsedProperty;
    position?: ParsedProperty;
    scale?: ParsedProperty;
    rotation?: ParsedProperty;
    opacity?: ParsedProperty;
}

function applyToProperty(prop: TransformLike, propType: Property, value: PropertyValue): boolean {
    switch (propType) {
        case Property.TrAnchor:
            if (prop.anchor) { prop.anchor = withOverrides(prop.anchor, value); return true; }
            return false;
        case Property.TrPosition:
            if (prop.position) { prop.position = withOverrides(prop.position, value); return true; }
            return false;
        case Property.TrScale:
            if (prop.scale) { prop.scale = withOverrides(prop.scale, value); return true; }
            return false;
        case Property.TrRotation:
            if (prop.rotation) { prop.rotation = withOverrides(prop.rotation, value); return true; }
            return false;
        case Property.TrOpacity:
            if (prop.opacity) { prop.opacity = withOverrides(prop.opacity, value); return true; }
            return false;
        default:
            return false;
    }
}

function applyToShape(shape: ParsedShape, propType: Property, value: PropertyValue): boolean {
    switch (shape.type) {
        case 'fill':
            if (propType === Property.FillColor && shape.color) { shape.color = withOverrides(shape.color, value); return true; }
            if (propType === Property.FillOpacity && shape.opacity) { shape.opacity = withOverrides(shape.opacity, value); return true; }
            return false;
        case 'stroke':
            if (propType === Property.StrokeColor && shape.color) { shape.color = withOverrides(shape.color, value); return true; }
            if (propType === Property.StrokeOpacity && shape.opacity) { shape.opacity = withOverrides(shape.opacity, value); return true; }
            if (propType === Property.StrokeWidth && shape.strokeWidth) { shape.strokeWidth = withOverrides(shape.strokeWidth, value); return true; }
            return false;
        case 'trim':
            if (propType === Property.TrimStart && shape.start) { shape.start = withOverrides(shape.start, value); return true; }
            if (propType === Property.TrimEnd && shape.end) { shape.end = withOverrides(shape.end, value); return true; }
            return false;
        case 'transform':
            return applyToProperty(shape, propType, value);
        default:
            return false;
    }
}

function walkShapes(shapes: ParsedShape[], path: string[], keypath: string, propType: Property, value: PropertyValue): boolean {
    let matched = false;
    for (const shape of shapes) {
        const name = shapeName(shape);
        const full = name ? [...path, name] : path;
        const transformChild = shape.children?.find((c) => c.type === 'transform');
        if (transformChild && matchKeyPath(keypath, [...full, 'Transform'])) {
            if (applyToShape(transformChild, propType, value)) matched = true;
        }
        if (matchKeyPath(keypath, full)) {
            if (applyToShape(shape, propType, value)) matched = true;
        }
        if (shape.children) {
            if (walkShapes(shape.children, full, keypath, propType, value)) matched = true;
        }
    }
    return matched;
}

/**
 * Port of rlottie's Animation::setValue(): override a property by keypath.
 * `value` can be a constant (color [r,g,b] in 0..1, point [x,y], size or
 * number) or a function of FrameInfo evaluated per frame.
 */
export function setValue(
    animation: ParsedAnimation,
    keypath: string,
    propType: Property,
    value: PropertyValue,
): void {
    let matched = false;
    for (const layer of animation.layers) {
        const base = layerPath(layer);
        if (layer.transform && matchKeyPath(keypath, [...base, 'Transform'])) {
            if (applyToProperty(layer.transform, propType, value)) matched = true;
        }
        if (layer.shapes && walkShapes(layer.shapes, base, keypath, propType, value)) {
            matched = true;
        }
    }
    if (!matched) {
        throw new Error(`setValue: no property matched keypath "${keypath}"`);
    }
}

export function getOverride(property: ParsedProperty, frame: number): any | undefined {
    const value = overrides.get(property);
    if (value === undefined) return undefined;
    return typeof value === 'function' ? value({ curFrame: frame }) : value;
}
