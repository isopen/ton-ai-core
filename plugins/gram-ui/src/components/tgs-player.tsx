import { h } from '@ton-ai/atom/jsx-runtime';
import { useState, useEffect, useRef, useCallback } from '@ton-ai/atom/hooks';
import { parseTgs, renderFrame } from '@ton-ai/tgs';
import type { ParsedAnimation } from '@ton-ai/tgs';

const TGS_DEBUG = false;

export interface TgsPlayerProps {
    animationData: string | object;
    width?: number;
    height?: number;
    loop?: boolean;
    autoplay?: boolean;
    speed?: number;
    className?: string;
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
    } = props;

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [playing, setPlaying] = useState(autoplay);
    const animRef = useRef<ParsedAnimation | null>(null);
    const frameRef = useRef(0);
    const rafRef = useRef<number | null>(null);
    const lastTimeRef = useRef(0);

    useEffect(() => {
        try {
            const json = typeof animationData === 'string' ? animationData : JSON.stringify(animationData);
            const parsed = parseTgs(json);
            animRef.current = parsed;
            setError(null);
            frameRef.current = parsed.inFrame;
            lastTimeRef.current = 0;
            if (TGS_DEBUG) {
                console.log('[TGS_LOG] parsed', { w: parsed.width, h: parsed.height, fps: parsed.fps, inFrame: parsed.inFrame, outFrame: parsed.outFrame, layers: parsed.layers.length });
            }
        } catch (e: any) {
            console.log('[TGS_LOG] parse error', e);
            setError(e.message || 'Invalid TGS');
            animRef.current = null;
        }
    }, [animationData]);

    const drawFrame = useCallback((frame: number) => {
        const canvas = canvasRef.current;
        const anim = animRef.current;
        if (!canvas || !anim) return;
        renderFrame(canvas, anim, frame, window.devicePixelRatio || 1);
    }, []);

    useEffect(() => {
        if (!autoplay) return;
        setPlaying(true);
    }, [autoplay, animationData]);

    useEffect(() => {
        if (!playing) {
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

        function tick(timestamp: number) {
            if (!animRef.current) return;

            if (lastTimeRef.current === 0) {
                lastTimeRef.current = timestamp;
            }

            const delta = timestamp - lastTimeRef.current;
            lastTimeRef.current = timestamp;

            let frame = frameRef.current + delta / frameDuration;

            if (frame >= animRef.current.outFrame) {
                if (loop) {
                    frame = animRef.current.inFrame + ((frame - animRef.current.inFrame) % totalFrames);
                } else {
                    frame = animRef.current.outFrame - 1;
                    setPlaying(false);
                }
            }

            frameRef.current = frame;
            drawFrame(frame);
            rafRef.current = requestAnimationFrame(tick);
        }

        lastTimeRef.current = 0;
        rafRef.current = requestAnimationFrame(tick);

        return () => {
            if (rafRef.current != null) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
        };
    }, [playing, loop, speed, drawFrame]);

    const togglePlay = useCallback(() => {
        setPlaying(v => !v);
        if (rafRef.current != null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        lastTimeRef.current = 0;
    }, []);

    if (error) {
        return (
            <div
                class={'TgsPlayer TgsPlayer_error' + (className ? ' ' + className : '')}
                style={{ width: width + 'px', height: height + 'px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f0f0', borderRadius: '8px', fontSize: '12px', color: '#999' }}>
                <span>TGS Error</span>
            </div>
        );
    }

    return (
        <div
            class={'TgsPlayer' + (className ? ' ' + className : '')}
            style={{ width: width + 'px', height: height + 'px' }}
            onClick={togglePlay}
        >
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
        </div>
    );
}
