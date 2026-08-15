import { h } from '@ton-ai/atom/jsx-runtime';
import { useState, useEffect, useRef, useCallback } from '@ton-ai/atom/hooks';
import { renderFrame } from '@ton-ai/tgs';
import type { LayerOrder, ParsedAnimation } from '@ton-ai/tgs';
import { parseTgsJson } from '../utils/tgs-parse.js';
import { getLogger } from '@ton-ai/gram-debug';

const tgsLog = getLogger('gram-ui:tgs');

let activePlayers = 0;
const MAX_ACTIVE_PLAYERS = 64;
const MAX_PLAYER_TIME = 12000;
const playerWaiters = new Set<() => void>();

const completedAnims = new Map<string, boolean>();

function markCompleted(key: string): void {
    completedAnims.set(key, true);
    if (completedAnims.size > 1024) {
        const oldest = completedAnims.keys().next().value;
        if (oldest != null) completedAnims.delete(oldest);
    }
}

export function resetCompletedAnimations(): void {
    completedAnims.clear();
}

export function isAnimationCompleted(key: string): boolean {
    return completedAnims.get(key) === true;
}

function acquirePlayerSlot(): boolean {
    if (activePlayers < MAX_ACTIVE_PLAYERS) {
        activePlayers++;
        return true;
    }
    return false;
}

function releasePlayerSlot(): void {
    if (activePlayers > 0) activePlayers--;
    for (const w of playerWaiters) {
        if (activePlayers < MAX_ACTIVE_PLAYERS) {
            activePlayers++;
            playerWaiters.delete(w);
            w();
            return;
        }
    }
}

export interface TgsPlayerProps {
    animationData: string | object;
    width?: number;
    height?: number;
    loop?: boolean;
    autoplay?: boolean;
    speed?: number;
    className?: string;
    cacheKey?: string;
    playKey?: string;
    showLastFrame?: boolean;
    onEnd?: () => void;
    onFrameProgress?: (progress: number) => void;
    layerOrder?: LayerOrder;
    hiddenLayers?: (name?: string) => boolean;
}

export function TgsPlayer(props: TgsPlayerProps) {
    const {
        animationData,
        width = 200,
        height = 200,
        loop = true,
        autoplay = true,
        speed = 1,
        className,
        cacheKey,
        playKey,
        showLastFrame,
        onEnd,
        onFrameProgress,
        layerOrder,
        hiddenLayers,
    } = props;

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [playing, setPlaying] = useState(() => (playKey != null && completedAnims.get(playKey)) || showLastFrame ? false : autoplay);
    const [inView, setInView] = useState(true);
    const [animVersion, setAnimVersion] = useState(0);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const animRef = useRef<ParsedAnimation | null>(null);
    const frameRef = useRef(0);
    const rafRef = useRef<number | null>(null);
    const lastTimeRef = useRef(0);
    const lastDrawRef = useRef(0);
    const yieldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const ioRef = useRef<IntersectionObserver | null>(null);
    const onEndRef = useRef(onEnd);
    onEndRef.current = onEnd;
    const onFrameProgressRef = useRef(onFrameProgress);
    onFrameProgressRef.current = onFrameProgress;
    const endFiredRef = useRef(false);

    useEffect(() => {
        const el = rootRef.current;
        if (!el || typeof IntersectionObserver === 'undefined') return;
        const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin: '80px' });
        ioRef.current = io;
        io.observe(el);
        return () => {
            if (ioRef.current) {
                ioRef.current.disconnect();
                ioRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const json = typeof animationData === 'string' ? animationData : JSON.stringify(animationData);
                const parsed = await parseTgsJson(json, cacheKey);
                if (cancelled) return;
                animRef.current = parsed;
                setError(null);
                const done = (playKey != null && completedAnims.get(playKey) === true) || showLastFrame;
                if (done && parsed.outFrame - parsed.inFrame > 0) {
                    frameRef.current = parsed.outFrame - 1;
                    endFiredRef.current = true;
                    setPlaying(false);
                } else {
                    frameRef.current = parsed.inFrame;
                    endFiredRef.current = false;
                }
                lastTimeRef.current = 0;
                setAnimVersion((v) => v + 1);
                if (tgsLog.enabled) {
                    tgsLog.info('[TGS_LOG] parsed', { w: parsed.width, h: parsed.height, fps: parsed.fps, inFrame: parsed.inFrame, outFrame: parsed.outFrame, layers: parsed.layers.length });
                }
            } catch (e: any) {
                if (cancelled) return;
                tgsLog.info('[TGS_LOG] parse error', e);
                setError(e.message || 'Invalid TGS');
                animRef.current = null;
            }
        })();
        return () => { cancelled = true; };
    }, [animationData, cacheKey, playKey, showLastFrame]);

    const drawFrame = useCallback((frame: number) => {
        const canvas = canvasRef.current;
        const anim = animRef.current;
        if (!canvas || !anim) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        renderFrame(canvas, anim, frame, dpr, undefined, undefined, layerOrder, hiddenLayers);
    }, [layerOrder, hiddenLayers]);

    useEffect(() => {
        if (!inView) return;
        const anim = animRef.current;
        if (!anim) return;
        const total = anim.outFrame - anim.inFrame;
        const frame = endFiredRef.current && total > 0 ? anim.outFrame - 1 : anim.inFrame;
        drawFrame(frame);
    }, [animationData, inView, animVersion, drawFrame]);

    useEffect(() => {
        if (!inView || loop || !onEndRef.current) return;
        const anim = animRef.current;
        if (!anim) return;
        if (anim.outFrame - anim.inFrame > 0) return;
        if (endFiredRef.current) return;
        endFiredRef.current = true;
        if (playKey) markCompleted(playKey);
        const t = setTimeout(() => onEndRef.current?.(), 120);
        return () => clearTimeout(t);
    }, [inView, loop, animVersion, playKey]);

    useEffect(() => {
        if ((playKey != null && completedAnims.get(playKey)) || showLastFrame) return;
        setPlaying(autoplay);
    }, [autoplay, animationData, playKey, showLastFrame]);

    useEffect(() => {
        if (!playing || !inView) {
            if (rafRef.current != null) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
            return;
        }

        const anim = animRef.current;
        if (!anim) return;

        const totalFrames = anim.outFrame - anim.inFrame;
        if (totalFrames <= 0) return;

        const frameDuration = 1000 / anim.fps / speed;

        let started = false;
        const stopRaf = () => {
            if (yieldTimerRef.current != null) {
                clearTimeout(yieldTimerRef.current);
                yieldTimerRef.current = null;
            }
            if (rafRef.current != null) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
            if (started) {
                started = false;
                releasePlayerSlot();
            }
        };

        let playStart = 0;
        const start = () => {
            if (started) return;
            started = true;
            lastTimeRef.current = 0;
            playStart = performance.now();
            endFiredRef.current = false;
            function tick(timestamp: number) {
                if (!animRef.current) {
                    started = false;
                    releasePlayerSlot();
                    return;
                }
                if (lastTimeRef.current === 0) {
                    lastTimeRef.current = timestamp;
                }
                const delta = timestamp - lastTimeRef.current;
                lastTimeRef.current = timestamp;
                let frame = frameRef.current + delta / frameDuration;
                let forceDraw = false;
                if (frame >= animRef.current.outFrame) {
                    if (loop) {
                        frame = animRef.current.inFrame + ((frame - animRef.current.inFrame) % totalFrames);
                    } else {
                        if (!endFiredRef.current) {
                            endFiredRef.current = true;
                            forceDraw = true;
                            frame = animRef.current.outFrame - 1;
                            setPlaying(false);
                            if (playKey) markCompleted(playKey);
                            onEndRef.current?.();
                        } else {
                            frame = animRef.current.outFrame - 1;
                        }
                    }
                }
                frameRef.current = frame;
                if (onFrameProgressRef.current) {
                    const animProg = animRef.current;
                    const total = animProg.outFrame - animProg.inFrame;
                    const progress = total > 0
                        ? Math.min(1, Math.max(0, (frame - animProg.inFrame) / total))
                        : 0;
                    onFrameProgressRef.current(progress);
                }
                const el = canvasRef.current;
                if (forceDraw || !el || timestamp - lastDrawRef.current >= 33.33) {
                    try {
                        drawFrame(frame);
                        lastDrawRef.current = timestamp;
                    } catch (e) {
                        tgsLog.info('[TGS_LOG] draw error', e);
                        started = false;
                        releasePlayerSlot();
                        if (!loop && !endFiredRef.current) {
                            endFiredRef.current = true;
                            onEndRef.current?.();
                        }
                        return;
                    }
                }
                if (timestamp - playStart > MAX_PLAYER_TIME) {
                    started = false;
                    releasePlayerSlot();
                    yieldTimerRef.current = setTimeout(() => {
                        yieldTimerRef.current = null;
                        if (!acquirePlayerSlot()) {
                            playerWaiters.add(start);
                        } else {
                            start();
                        }
                    }, 0);
                    return;
                }
                rafRef.current = requestAnimationFrame(tick);
            }
            rafRef.current = requestAnimationFrame(tick);
        };

        if (!acquirePlayerSlot()) {
            playerWaiters.add(start);
        } else {
            start();
        }

        return () => {
            playerWaiters.delete(start);
            stopRaf();
        };
    }, [playing, inView, loop, speed, animVersion, drawFrame]);

    const togglePlay = useCallback(() => {
        if ((playKey != null && completedAnims.get(playKey)) || showLastFrame) return;
        setPlaying(v => !v);
        if (rafRef.current != null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        lastTimeRef.current = 0;
    }, [playKey, showLastFrame]);

    if (error) {
        return (
            <div
                class={'TgsPlayer TgsPlayer_error' + (className ? ' ' + className : '')}
                style={{ width: width + 'px', height: height + 'px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', fontSize: '12px', color: '#999' }}>
                <span>TGS Error</span>
            </div>
        );
    }

    return (
        <div
            ref={rootRef}
            class={'TgsPlayer' + (className ? ' ' + className : '')}
            style={{ width: width + 'px', height: height + 'px' }}
            onClick={togglePlay}
        >
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
        </div>
    );
}
