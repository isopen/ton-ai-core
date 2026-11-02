import { h } from '@ton-ai/atom/jsx-runtime';
import { t, S } from '@ton-ai/gram-lang';
import { useState, useEffect, useRef, useCallback, useDomEvent } from '@ton-ai/atom/hooks';
import { renderFrame } from '@ton-ai/tgs';
import type { LayerOrder, ParsedAnimation } from '@ton-ai/tgs';
import { parseTgsJson } from '../utils/tgs-parse.js';
import { getLogger } from '@ton-ai/gram-debug';

const tgsLog = getLogger('gram-ui:tgs');

type PlayerTick = (ts: number, deadline: number) => void;

const PLAYER_DRAW_BUDGET_MS = 6;
const playerTicks = new Set<PlayerTick>();
let playerTickRaf = 0;
let lastTickTs = 0;
let lastGapLoggedAt = 0;
let hudMaxGap = 0;
let hudBudgetDrops = 0;

function schedulePlayerTick(): void {
    if (playerTickRaf || typeof requestAnimationFrame !== 'function') return;
    playerTickRaf = requestAnimationFrame(playerTickStep);
}

function playerTickStep(timestamp: number): void {
    playerTickRaf = 0;
    if (playerTicks.size === 0) {
        lastTickTs = 0;
        return;
    }
    if (lastTickTs > 0) {
        const gap = timestamp - lastTickTs;
        if (gap > hudMaxGap) hudMaxGap = gap;
        if (gap > 60 && timestamp - lastGapLoggedAt > 2000) {
            lastGapLoggedAt = timestamp;
            tgsLog.info('[TGS_LOG] rAF gap ' + Math.round(gap) + 'ms tasks=' + playerTicks.size);
        }
    }
    lastTickTs = timestamp;
    const deadline = performance.now() + PLAYER_DRAW_BUDGET_MS;
    for (const task of Array.from(playerTicks)) {
        try {
            task(timestamp, deadline);
        } catch (e) {
            tgsLog.info('[TGS_LOG] player tick error', e);
        }
        if (playerTicks.has(task)) {
            playerTicks.delete(task);
            playerTicks.add(task);
        }
        if (performance.now() >= deadline) {
            hudBudgetDrops++;
            break;
        }
    }
    if (playerTicks.size > 0) schedulePlayerTick();
}

export function getTgsStats(): { tasks: number; gap: number; drops: number } {
    const s = { tasks: playerTicks.size, gap: Math.round(hudMaxGap), drops: hudBudgetDrops };
    hudMaxGap = 0;
    hudBudgetDrops = 0;
    return s;
}

function addPlayerTick(task: PlayerTick): void {
    playerTicks.add(task);
    schedulePlayerTick();
}

function removePlayerTick(task: PlayerTick): void {
    playerTicks.delete(task);
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
        const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin: '120px' });
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
                setAnimVersion((v) => v + 1);
                if (tgsLog.enabled) {
                    tgsLog.info('[TGS_LOG] parsed', { w: parsed.width, h: parsed.height, fps: parsed.fps, inFrame: parsed.inFrame, outFrame: parsed.outFrame, layers: parsed.layers.length });
                }
            } catch (e: any) {
                if (cancelled) return;
                tgsLog.info('[TGS_LOG] parse error', e);
                setError(e.message || t(S.TGS_INVALID));
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
        const anim = animRef.current;
        if (!anim) return;
        const total = anim.outFrame - anim.inFrame;
        const frame = (showLastFrame || (endFiredRef.current && total > 0)) ? anim.outFrame - 1 : anim.inFrame;
        drawFrame(frame);
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
        setPlaying(autoplay);
    };
    useDomEvent(window, 'tg-playback-reset', onPlaybackReset, [autoplay, showLastFrame]);

    useEffect(() => {
        if (!playing || !inView) return;

        const anim = animRef.current;
        if (!anim) return;

        const totalFrames = anim.outFrame - anim.inFrame;
        if (totalFrames <= 0) return;

        const frameDuration = 1000 / anim.fps / speed;
        let lastTime = 0;
        let nextDrawAt = 0;
        let lastDrawFrameIdx = -1;
        endFiredRef.current = false;

        const task: PlayerTick = (ts, deadline) => {
            const active = animRef.current;
            if (!active) {
                removePlayerTick(task);
                return;
            }
            if (document.hidden) {
                lastTime = 0;
                return;
            }
            if (lastTime === 0) {
                lastTime = ts;
            }
            const delta = ts - lastTime;
            lastTime = ts;
            let frame = frameRef.current + delta / frameDuration;
            let forceDraw = false;
            if (frame >= active.outFrame) {
                if (loop) {
                    const passed = Math.floor((frame - active.inFrame) / totalFrames);
                    frame = active.inFrame + ((frame - active.inFrame) % totalFrames);
                    if (passed > 0) onLoopDoneRef.current?.();
                } else {
                    if (!endFiredRef.current) {
                        endFiredRef.current = true;
                        forceDraw = true;
                        frame = active.outFrame - 1;
                        setPlaying(false);
                        if (playKey) markCompleted(playKey);
                        onEndRef.current?.();
                    } else {
                        frame = active.outFrame - 1;
                    }
                }
            }
            frameRef.current = frame;
            if (onFrameProgressRef.current) {
                const total = active.outFrame - active.inFrame;
                const progress = total > 0
                    ? Math.min(1, Math.max(0, (frame - active.inFrame) / total))
                    : 0;
                onFrameProgressRef.current(progress);
            }
            const iconVotes = playerTicks.size;
            const drawInterval = iconVotes > 16 ? 100 : iconVotes > 10 ? 66 : iconVotes > 5 ? 50 : 33.33;
            const drawFrameIndex = Math.floor(frame);
            const due = ts >= nextDrawAt && drawFrameIndex !== lastDrawFrameIdx;
            if (forceDraw || (due && (bypassPlayerLimit || performance.now() < deadline))) {
                try {
                    drawFrame(frame);
                    lastDrawFrameIdx = drawFrameIndex;
                    nextDrawAt = ts + drawInterval;
                } catch (e) {
                    tgsLog.info('[TGS_LOG] draw error', e);
                    removePlayerTick(task);
                    if (!loop && !endFiredRef.current) {
                        endFiredRef.current = true;
                        onEndRef.current?.();
                    }
                }
            }
        };

        addPlayerTick(task);
        return () => removePlayerTick(task);
    }, [playing, inView, loop, speed, animVersion, drawFrame, bypassPlayerLimit]);

    const togglePlay = useCallback(() => {
        const anim = animRef.current;
        frameRef.current = anim ? anim.inFrame : 0;
        endFiredRef.current = false;
        setPlaying(true);
    }, []);

    if (error) {
        return (
            <div
                class={'TgsPlayer TgsPlayer_error' + (className ? ' ' + className : '')}
                style={{ width: width + 'px', height: height + 'px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', fontSize: '12px', color: '#999' }}>
                <span>{t(S.TGS_ERROR)}</span>
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
