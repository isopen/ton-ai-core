import { BasePlugin, type BasePluginConfig } from '@ton-ai/core';
import { parseTgs, configureModelCacheSize, layerInfo } from './parser.js';
import type { ParseOptions } from './parser.js';
import { interpolateKeyframes } from './keyframes.js';
import { setValue, matchKeyPath, Property } from './keypath.js';
import type { PropertyValue } from './keypath.js';
import type { ParsedAnimation, ParsedProperty } from './types.js';
export type {
    TgsAnimation, TgsLayer, TgsShape, TgsAsset, TgsMask, TgsTransform, TgsText,
    TgsValue, TgsEasing, TgsKeyframe, TgsMarker, TgsGradient, TgsDash, TgsTextKeyframe,
    ParsedAnimation, ParsedLayer, ParsedTransform, ParsedProperty, ParsedKeyframe,
    ParsedShape, ParsedAsset, ParsedMask, ParsedText, ParsedGradient, ParsedDash,
    ParsedMarker, LayerInfo, CubicBezierEasing,
} from './types.js';
export type { ParseOptions } from './parser.js';
export type { FrameInfo, PropertyValue } from './keypath.js';
export {
    parseTgs, configureModelCacheSize, layerInfo,
} from './parser.js';
export { interpolateKeyframes, lerpValue, parseValue } from './keyframes.js';
export { hasAnimatedProperties } from './static-check.js';
export { setValue, matchKeyPath, getOverride, Property } from './keypath.js';
export { CubicBezier, buildEasing } from './easing.js';
export { bezierLength, bezierPointAt, bezierTAtLength, bezierSplit } from './bezier.js';
export { renderFrame } from './renderer.js';
export type { LayerOrder } from './renderer.js';
export {
    LayerType, MatteType, MaskMode, GradientType,
} from './types.js';

const GZIP_MAGIC: [number, number] = [0x1f, 0x8b];

export async function inflateTgs(data: Uint8Array): Promise<string> {
    if (data.length < 2 || data[0] !== GZIP_MAGIC[0] || data[1] !== GZIP_MAGIC[1]) {
        return new TextDecoder().decode(data);
    }
    const g: any = globalThis;
    const DecompressionStream = g.DecompressionStream;
    if (!DecompressionStream) {
        throw new Error('DecompressionStream not available in this environment');
    }
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    await writer.write(data);
    await writer.close();
    const reader = ds.readable.getReader();
    const decoder = new TextDecoder();
    let out = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
    return out;
}

export async function loadTgs(data: string | Uint8Array, options?: ParseOptions): Promise<ParsedAnimation> {
    const json = typeof data === 'string' ? data : await inflateTgs(data);
    return parseTgs(json, options);
}

export function frameAtPos(animation: ParsedAnimation, pos: number): number {
    const total = animation.outFrame - animation.inFrame;
    let frame = animation.inFrame + Math.floor(pos * total);
    if (frame < animation.inFrame) frame = animation.inFrame;
    if (frame > animation.outFrame) frame = animation.outFrame;
    return frame;
}

interface TgsParserConfig extends BasePluginConfig {
    cacheSize?: number;
}

export class TgsPlugin extends BasePlugin<TgsParserConfig> {
    readonly metadata = {
        name: 'tgs',
        version: '0.1.0',
        description: 'TGS (Telegram Lottie) parser and renderer',
    };

    parse(json: string, options?: ParseOptions) {
        return parseTgs(json, options);
    }

    interpolate(property: ParsedProperty, frame: number) {
        return interpolateKeyframes(property, frame);
    }

    setValue(animation: ParsedAnimation, keypath: string, propType: Property, value: PropertyValue): void {
        setValue(animation, keypath, propType, value);
    }

    frameAtPos(animation: ParsedAnimation, pos: number): number {
        return frameAtPos(animation, pos);
    }

    layers(animation: ParsedAnimation) {
        return layerInfo(animation);
    }

    protected async onInit(): Promise<void> {
        const size = this.config?.cacheSize;
        if (typeof size === 'number') configureModelCacheSize(size);
        this.context.logger.info('TGS Parser initialized');
    }
}
