import { h } from '@ton-ai/atom/jsx-runtime';
import { useState, useEffect, useRef, useCallback, useDomEvent } from '@ton-ai/atom/hooks';
import { renderFrame } from '@ton-ai/tgs';
import type { LayerOrder, ParsedAnimation } from '@ton-ai/tgs';
import { parseTgsJson } from '../utils/tgs-parse.js';
import { getLogger } from '@ton-ai/gram-debug';

const tgsLog = getLogger('gram-ui:tgs');

let activePlayers = 0;
const MAX_ACTIVE_PLAYERS = 8;
const MAX_PLAYER_TIME = 12000;
const playerWaiters = new Set<() => void>();

const SCROLL_SETTLE_MS = 90;
let lastScrollAt = 0;
let scrollTrackingAttached = false;
function trackScrollActivity(): void {
    if (scrollTrackingAttached || typeof document === 'undefined') return;
    scrollTrackingAttached = true;
    document.addEventListener('scroll', () => { lastScrollAt = performance.now(); }, true);
}
trackScrollActivity();

function scrollSettled(): boolean {
    return performance.now() - lastScrollAt >= SCROLL_SETTLE_MS;
}

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
    onLoopDone?: () => void;
    onFrameProgress?: (progress: number) => void;
    layerOrder?: LayerOrder;
    hiddenLayers?: (name?: string) => boolean;
    disableClick?: boolean;
    bypassPlayerLimit?: boolean;
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
        onLoopDone,
        onFrameProgress,
        layerOrder,
        hiddenLayers,
        disableClick = false,
        bypassPlayerLimit = false,
    } = props;

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [playing, setPlaying] = useState(() => showLastFrame ? false : autoplay);
    const [inView, setInView] = useState(false);
    const [animVersion, setAnimVersion] = useState(0);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const animRef = useRef<ParsedAnimation | null>(null);
    const frameRef = useRef(0);
    const rafRef = useRef<number | null>(null);
    const lastTimeRef = useRef(0);
    const lastDrawRef = useRef(performance.now() - Math.random() * 33.33);
    const lastDrawnFrameRef = useRef(-1);
    const yieldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const ioRef = useRef<IntersectionObserver | null>(null);
    const onEndRef = useRef(onEnd);
    onEndRef.current = onEnd;
    const onLoopDoneRef = useRef(onLoopDone);
    onLoopDoneRef.current = onLoopDone;
    const onFrameProgressRef = useRef(onFrameProgress);
    onFrameProgressRef.current = onFrameProgress;
    const endFiredRef = useRef(false);

    useEffect(() => {
        const el = rootRef.current;
        if (!el || typeof IntersectionObserver === 'undefined') {
            setInView(true);
            return;
        }
        const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin: '0px' });
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
                const done = showLastFrame;
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
        const dpr = Math.min(window.devicePixelRatio || 1, width <= 128 ? 1.5 : 2);
        renderFrame(canvas, anim, frame, dpr, undefined, undefined, layerOrder, hiddenLayers);
    }, [layerOrder, hiddenLayers, width]);

    useEffect(() => {
        if (!inView) return;
        const anim = animRef.current;
        if (!anim) return;
        const drawNow = () => {
            if (!inView) return;
            const total = anim.outFrame - anim.inFrame;
            const frame = (showLastFrame || (endFiredRef.current && total > 0)) ? anim.outFrame - 1 : anim.inFrame;
            drawFrame(frame);
        };
        if (scrollSettled()) {
            drawNow();
        } else {
            const t = setTimeout(drawNow, SCROLL_SETTLE_MS);
            return () => clearTimeout(t);
        }
    }, [animationData, inView, animVersion, drawFrame, showLastFrame]);

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
        if (showLastFrame) {
            setPlaying(false);
            return;
        }
        setPlaying(autoplay);
    }, [autoplay, animationData, playKey, showLastFrame]);

    const onPlaybackReset = () => {
        if (showLastFrame) {
            const anim = animRef.current;
            if (anim && anim.outFrame - anim.inFrame > 0) {
                frameRef.current = anim.outFrame - 1;
                endFiredRef.current = true;
            }
            setPlaying(false);
            return;
        }
        endFiredRef.current = false;
        frameRef.current = animRef.current ? animRef.current.inFrame : 0;
        lastDrawnFrameRef.current = -1;
        lastTimeRef.current = 0;
        setPlaying(autoplay);
    };
    useDomEvent(window, 'tg-playback-reset', onPlaybackReset, [autoplay, showLastFrame]);

    const retryOnVisibleRef = useRef<null | (() => void)>(null);

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
        let acquired = false;
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
                if (acquired) {
                    acquired = false;
                    releasePlayerSlot();
                }
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
                    if (acquired) {
                        acquired = false;
                        releasePlayerSlot();
                    }
                    return;
                }
                if (document.hidden) {
                    stopRaf();
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
                        const passed = Math.floor((frame - animRef.current.inFrame) / totalFrames);
                        frame = animRef.current.inFrame + ((frame - animRef.current.inFrame) % totalFrames);
                        if (passed > 0) onLoopDoneRef.current?.();
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
                const drawInterval = activePlayers > 12 ? 100 : activePlayers > 8 ? 66 : activePlayers > 4 ? 50 : 33.33;
                const drawFrameIndex = Math.floor(frame);
                if (forceDraw || !el || (drawFrameIndex !== lastDrawnFrameRef.current && timestamp - lastDrawRef.current >= drawInterval)) {
                    try {
                        drawFrame(frame);
                        lastDrawnFrameRef.current = drawFrameIndex;
                        lastDrawRef.current = timestamp;
                    } catch (e) {
                        tgsLog.info('[TGS_LOG] draw error', e);
                        started = false;
                        if (acquired) {
                            acquired = false;
                            releasePlayerSlot();
                        }
                        if (!loop && !endFiredRef.current) {
                            endFiredRef.current = true;
                            onEndRef.current?.();
                        }
                        return;
                    }
                }
                if (timestamp - playStart > MAX_PLAYER_TIME) {
                    started = false;
                    if (acquired) {
                        acquired = false;
                        releasePlayerSlot();
                    }
                    yieldTimerRef.current = setTimeout(() => {
                        yieldTimerRef.current = null;
                        maybeStart();
                    }, 0);
                    return;
                }
                rafRef.current = requestAnimationFrame(tick);
            }
            rafRef.current = requestAnimationFrame(tick);
        };

        let deferredStartTimer: ReturnType<typeof setTimeout> | null = null;
        let acquireRetryTimer: ReturnType<typeof setTimeout> | null = null;
        const maybeStart = () => {
            if (started || !playing || !inView) return;
            if (!scrollSettled()) {
                if (deferredStartTimer == null) {
                    deferredStartTimer = setTimeout(() => {
                        deferredStartTimer = null;
                        maybeStart();
                    }, 40);
                }
                return;
            }
            if (!bypassPlayerLimit) {
                if (!acquirePlayerSlot()) {
                    if (acquireRetryTimer == null) {
                        acquireRetryTimer = setTimeout(() => {
                            acquireRetryTimer = null;
                            maybeStart();
                        }, 200);
                    }
                    return;
                }
                acquired = true;
            }
            start();
        };

        maybeStart();

        retryOnVisibleRef.current = () => {
            if (!started) maybeStart();
        };

        return () => {
            retryOnVisibleRef.current = null;
            if (deferredStartTimer != null) {
                clearTimeout(deferredStartTimer);
                deferredStartTimer = null;
            }
            if (acquireRetryTimer != null) {
                clearTimeout(acquireRetryTimer);
                acquireRetryTimer = null;
            }
            playerWaiters.delete(start);
            stopRaf();
        };
    }, [playing, inView, loop, speed, animVersion, drawFrame, bypassPlayerLimit]);

    useDomEvent(document, 'visibilitychange', () => {
        if (!document.hidden && playing && inView && scrollSettled()) {
            retryOnVisibleRef.current?.();
        }
    }, [playing, inView]);

    const togglePlay = useCallback(() => {
        const anim = animRef.current;
        frameRef.current = anim ? anim.inFrame : 0;
        endFiredRef.current = false;
        lastTimeRef.current = 0;
        setPlaying(true);
    }, []);

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
            onClick={disableClick ? undefined : togglePlay}
        >
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
        </div>
    );
}
