import { h } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useRef, useState } from '@ton-ai/atom/hooks';
import { render } from '@ton-ai/atom/render';
import type { Dispatch } from '../state.js';
import { t, S } from '@ton-ai/gram-lang';
import { getLogger } from '@ton-ai/gram-debug';
import { EmojiCanvas } from './emoji-canvas.js';

const log = getLogger('gram-ui:chat-input');

export interface InputEntity {
  offset: number;
  length: number;
  document_id: string;
}

export function serializeInput(root: HTMLDivElement | null): { text: string; entities: InputEntity[] } {
  if (!root) return { text: '', entities: [] };
  let text = '';
  const entities: InputEntity[] = [];
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === 3) {
      text += node.textContent || '';
      continue;
    }
    if (node.nodeType !== 1) continue;
    const el = node as HTMLElement;
    if (el.tagName === 'BR') {
      text += '\n';
      continue;
    }
    const docId = typeof el.getAttribute === 'function' ? el.getAttribute('data-doc-id') : null;
    const alt = (typeof el.getAttribute === 'function' && el.getAttribute('data-alt')) || el.textContent || '';
    if (docId && alt) {
      entities.push({ offset: text.length, length: alt.length, document_id: docId });
      text += alt;
    } else {
      text += el.textContent || '';
    }
  }
  return { text, entities };
}

function insertNodeAtCaret(root: HTMLDivElement, node: Node): void {
  try {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (root.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        root.focus();
        return;
      }
    }
  } catch {}
  root.appendChild(node);
  root.focus();
}

export function insertInputText(root: HTMLDivElement | null, text: string): void {
  if (!root || !text) return;
  insertNodeAtCaret(root, document.createTextNode(text));
  root.dispatchEvent(new Event('input', { bubbles: true }));
}

export function refreshEmojiPreviews(root: HTMLDivElement | null, documentUrls: Record<string, string>): void {
  if (!root) return;
  const spans = root.querySelectorAll('span.ci-emoji');
  for (const node of Array.from(spans)) {
    const el = node as HTMLElement;
    if (el.childNodes.length > 0) continue;
    const docId = typeof el.getAttribute === 'function' ? el.getAttribute('data-doc-id') || '' : '';
    const alt = typeof el.getAttribute === 'function' ? el.getAttribute('data-alt') || '' : '';
    if (!docId || !alt) continue;
    try {
      render(() => h(EmojiCanvas as any, { segments: [{ type: 'emoji', docId, value: alt, custom: true }], documentUrls: documentUrls || {}, size: 22 } as any), el);
    } catch {
      el.textContent = alt;
    }
  }
}

export function insertInputEmoji(root: HTMLDivElement | null, docId: string, alt: string, documentUrls: Record<string, string>): void {
  if (!root || !docId || !alt) return;
  const span = document.createElement('span');
  span.className = 'ci-emoji';
  span.setAttribute('contenteditable', 'false');
  span.setAttribute('data-doc-id', String(docId));
  span.setAttribute('data-alt', alt);
  insertNodeAtCaret(root, span);
  refreshEmojiPreviews(root, documentUrls);
  root.dispatchEvent(new Event('input', { bubbles: true }));
}

const BAR_COUNT = 46;
const MAX_VOICE_SECONDS = 120;

function seededHeights(count: number, seed: number): number[] {
  const out: number[] = [];
  let s = seed || 1;
  for (let i = 0; i < count; i++) {
    s = (s * 9301 + 49297) % 233280;
    out.push(18 + Math.round((s / 233280) * 82));
  }
  return out;
}

function formatTime(s: number): string {
  const v = Math.max(0, Math.round(s));
  return Math.floor(v / 60) + ':' + String(v % 60).padStart(2, '0');
}

function Icon({ d, size = 20 }: { d: any; size?: number }) {
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{d}</svg>
  );
}

const P_ATTACH = <path d="M7 12.5l7.5-7.5a3.5 3.5 0 015 5L11 18.5a5.5 5.5 0 01-7.8-7.8L12 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />;
const P_SMILEY = [
  <circle cx="12" cy="12" r="8.3" fill="none" stroke="currentColor" stroke-width="1.7" />,
  <circle cx="9" cy="10.5" r="1.1" fill="currentColor" />,
  <circle cx="15" cy="10.5" r="1.1" fill="currentColor" />,
  <path d="M8.3 14c1 1.3 2.3 2 3.7 2s2.7-.7 3.7-2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />,
];
const P_SEND = <path d="M4 12l16.5-8-6 16.5-3.3-6.6L4 12z" fill="currentColor" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />;
const P_MIC = [
  <rect x="9" y="3.5" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.7" />,
  <path d="M6 11.5a6 6 0 0012 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />,
  <line x1="12" y1="17.5" x2="12" y2="20.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />,
  <line x1="8.5" y1="20.5" x2="15.5" y2="20.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />,
];
const P_CLOSE = <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />;
const P_PLAY = <polygon points="8,5 19,12 8,19" fill="currentColor" />;
const P_PAUSE = [
  <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />,
  <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />,
];
const P_GALLERY = [
  <rect x="3.5" y="4.5" width="17" height="15" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.6" />,
  <circle cx="9" cy="9.5" r="1.5" fill="currentColor" />,
  <path d="M4.5 16l4.5-4.5 3 2.7 3.3-3.5 4.7 4.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />,
];
const P_CAMERA = [
  <path d="M4 8.5a1.5 1.5 0 011.5-1.5h2l1-2h7l1 2h2A1.5 1.5 0 0120 8.5v9A1.5 1.5 0 0118.5 19h-13A1.5 1.5 0 014 17.5v-9z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />,
  <circle cx="12" cy="13" r="3.4" fill="none" stroke="currentColor" stroke-width="1.6" />,
];
const P_FILE = [
  <path d="M6.5 3.5h8l3 3v14h-11z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />,
  <path d="M14.5 3.5v3h3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />,
];
const P_LOCATION = [
  <path d="M12 21s-6.5-5.9-6.5-11A6.5 6.5 0 0118.5 10c0 5.1-6.5 11-6.5 11z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />,
  <circle cx="12" cy="10" r="2.3" fill="none" stroke="currentColor" stroke-width="1.6" />,
];
const P_MORE = [
  <circle cx="5.5" cy="12" r="1.8" fill="currentColor" />,
  <circle cx="12" cy="12" r="1.8" fill="currentColor" />,
  <circle cx="18.5" cy="12" r="1.8" fill="currentColor" />,
];

let _typingTimer: any = null;

function emitTyping() {
  if (_typingTimer) clearTimeout(_typingTimer);
  _typingTimer = setTimeout(() => { _typingTimer = null; window.dispatchEvent(new CustomEvent('tg-typing-stop')); }, 3000);
  window.dispatchEvent(new CustomEvent('tg-typing'));
}

function emitTypingStop() {
  if (_typingTimer) { clearTimeout(_typingTimer); _typingTimer = null; }
  window.dispatchEvent(new CustomEvent('tg-typing-stop'));
}

type Mode = 'idle' | 'recording' | 'ready';

export function SendInput({ dispatch, onEmojiToggle, documentUrls }: { dispatch: Dispatch; onEmojiToggle: () => void; documentUrls?: Record<string, string> }) {
  const [mode, setMode] = useState<Mode>('idle');
  const [hasText, setHasText] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);
  const [recSeed, setRecSeed] = useState(3);
  const [voice, setVoice] = useState<{ url: string; seconds: number; blob: Blob | null } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [composing, setComposing] = useState(false);

  const editRef = useRef<HTMLDivElement | null>(null);
  const barsRef = useRef<HTMLDivElement | null>(null);
  const timeRef = useRef<HTMLSpanElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef(0);
  const startRef = useRef(0);
  const secondsRef = useRef(0);
  const playRafRef = useRef(0);

  const stopLoops = () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    if (playRafRef.current) { cancelAnimationFrame(playRafRef.current); playRafRef.current = 0; }
  };

  const releaseVoice = () => {
    stopLoops();
    if (audioRef.current) { try { audioRef.current.pause(); } catch {} audioRef.current = null; }
    if (voice && voice.url) { try { URL.revokeObjectURL(voice.url); } catch {} }
  };

  const resetToIdle = () => {
    releaseVoice();
    setVoice(null);
    setPlaying(false);
    setMode('idle');
  };

  useEffect(() => {
    return () => {
      stopLoops();
      if (audioRef.current) { try { audioRef.current.pause(); } catch {} }
      if (streamRef.current) { try { streamRef.current.getTracks().forEach((tr) => tr.stop()); } catch {} }
      if (voice && voice.url) { try { URL.revokeObjectURL(voice.url); } catch {} }
    };
  }, []);

  const urlsRef = useRef<Record<string, string>>(documentUrls || {});
  urlsRef.current = documentUrls || {};

  useEffect(() => {
    const onInsertText = (e: Event) => {
      insertInputText(editRef.current, String((e as CustomEvent).detail?.text || ''));
    };
    const onInsertEmoji = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      insertInputEmoji(editRef.current, String(detail.docId || ''), String(detail.alt || ''), urlsRef.current);
    };
    window.addEventListener('tg-insert-text', onInsertText);
    window.addEventListener('tg-insert-emoji', onInsertEmoji);
    return () => {
      window.removeEventListener('tg-insert-text', onInsertText);
      window.removeEventListener('tg-insert-emoji', onInsertEmoji);
    };
  }, []);

  useEffect(() => {
    refreshEmojiPreviews(editRef.current, documentUrls || {});
  }, [documentUrls]);

  const readRich = () => serializeInput(editRef.current);

  const doSend = () => {
    const { text, entities } = readRich();
    if (!text.trim() && entities.length === 0) return;
    if (editRef.current) editRef.current.textContent = '';
    setHasText(false);
    dispatch({ type: 'TICK' } as any);
    emitTypingStop();
    window.dispatchEvent(new CustomEvent('tg-send-message', { detail: { text, entities } }));
    editRef.current?.focus();
  };

  const onEditInput = () => {
    const s = readRich();
    const empty = !s.text.trim() && s.entities.length === 0;
    setHasText((prev) => (prev === !empty ? prev : !empty));
    if (!empty) emitTyping();
  };

  const attachKind = (kind: string) => {
    window.dispatchEvent(new CustomEvent('tg-attach-' + kind));
  };

  const startRecording = async () => {
    try {
      const md = navigator?.mediaDevices;
      const MR = (window as any).MediaRecorder;
      if (!md?.getUserMedia || typeof MR !== 'function') return;
      const stream = await md.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const rec = new MR(stream);
      recorderRef.current = rec;
      rec.ondataavailable = (e: any) => { if (e?.data) chunksRef.current.push(e.data); };
      rec.start();
      secondsRef.current = 0;
      startRef.current = 0;
      setRecSeed(1 + Math.floor(Math.random() * 100000));
      setMode('recording');
    } catch (e) {
      log.warn('[chat-input] mic unavailable:', (e as any)?.message || e);
      if (streamRef.current) { try { streamRef.current.getTracks().forEach((tr) => tr.stop()); } catch {} streamRef.current = null; }
    }
  };

  const finishRecording = (send: boolean) => {
    const rec = recorderRef.current;
    recorderRef.current = null;
    stopLoops();
    if (streamRef.current) { try { streamRef.current.getTracks().forEach((tr) => tr.stop()); } catch {} streamRef.current = null; }
    const secs = Math.max(1, Math.round(secondsRef.current));
    if (!rec) { resetToIdle(); return; }
    try {
      rec.onstop = () => {
        const blob = chunksRef.current.length > 0 ? new Blob(chunksRef.current, { type: (rec as any).mimeType || 'audio/webm' }) : null;
        chunksRef.current = [];
        if (!send || !blob) { resetToIdle(); return; }
        const url = URL.createObjectURL(blob);
        setVoice({ url, seconds: secs, blob });
        setPlaying(false);
        setMode('ready');
      };
      rec.stop();
    } catch {
      resetToIdle();
    }
  };

  useEffect(() => {
    if (mode !== 'recording') return;
    const tick = (ts: number) => {
      if (startRef.current === 0) startRef.current = ts;
      secondsRef.current = (ts - startRef.current) / 1000;
      if (timeRef.current) timeRef.current.textContent = formatTime(secondsRef.current);
      const bars = barsRef.current;
      if (bars) {
        const live = bars.querySelectorAll('.ci-waveform__bar.is-live');
        live.forEach((b) => { (b as HTMLElement).style.height = (25 + Math.random() * 70) + '%'; });
      }
      if (secondsRef.current >= MAX_VOICE_SECONDS) { finishRecording(true); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; } };
  }, [mode]);

  const togglePlay = () => {
    if (!voice) return;
    if (playing) {
      if (audioRef.current) { try { audioRef.current.pause(); } catch {} }
      if (playRafRef.current) { cancelAnimationFrame(playRafRef.current); playRafRef.current = 0; }
      setPlaying(false);
      return;
    }
    try {
      let audio = audioRef.current;
      if (!audio) {
        audio = new Audio(voice.url);
        audioRef.current = audio;
        audio.onended = () => {
          setPlaying(false);
          const bars = barsRef.current;
          if (bars) bars.querySelectorAll('.ci-waveform__bar').forEach((b) => b.classList.remove('is-played'));
          if (timeRef.current) timeRef.current.textContent = formatTime(voice.seconds);
        };
      }
      void audio.play().catch(() => setPlaying(false));
      setPlaying(true);
      const bars = barsRef.current ? Array.from(barsRef.current.querySelectorAll('.ci-waveform__bar')) : [];
      const total = bars.length;
      const started = performance.now();
      const dur = Math.max(1, voice.seconds) * 1000;
      const step = (ts: number) => {
        const p = Math.min(1, (ts - started) / dur);
        const n = Math.round(total * p);
        bars.forEach((b, i) => b.classList.toggle('is-played', i < n));
        if (timeRef.current) timeRef.current.textContent = formatTime(voice.seconds * (1 - p));
        if (p < 1 && audioRef.current && !audioRef.current.paused) {
          playRafRef.current = requestAnimationFrame(step);
        }
      };
      playRafRef.current = requestAnimationFrame(step);
    } catch {
      setPlaying(false);
    }
  };

  const sendVoice = () => {
    if (!voice) { resetToIdle(); return; }
    window.dispatchEvent(new CustomEvent('tg-send-voice', { detail: { seconds: voice.seconds, blob: voice.blob, url: voice.url } }));
    resetToIdle();
  };

  const heights = seededHeights(BAR_COUNT, recSeed);

  const toolbar = (
    <div class="ci-toolbar">
      <button type="button" class="ci-icon-btn" aria-label="Attach file" onClick={() => attachKind('file')}><Icon d={P_ATTACH} /></button>
      <button type="button" class="ci-icon-btn" aria-label="Gallery" onClick={() => attachKind('gallery')}><Icon d={P_GALLERY} /></button>
      <button type="button" class="ci-icon-btn" aria-label="Camera" onClick={() => attachKind('camera')}><Icon d={P_CAMERA} /></button>
      <button type="button" class="ci-icon-btn" aria-label="File" onClick={() => attachKind('file')}><Icon d={P_FILE} /></button>
      <button type="button" class="ci-icon-btn" aria-label="Location" onClick={() => attachKind('location')}><Icon d={P_LOCATION} /></button>
      <button type="button" class="ci-icon-btn" aria-label="More" onClick={() => attachKind('more')}><Icon d={P_MORE} /></button>
    </div>
  );

  if (mode === 'recording') {
    return (
      <div class="ci-root">
        <div class="chat-input chat-input--recording">
          <button type="button" class="ci-cancel-btn" aria-label="Cancel recording" onClick={() => finishRecording(false)}><Icon d={P_CLOSE} size={15} /></button>
          <div class="ci-waveform">
            <div class="ci-waveform__bars" ref={(el: HTMLDivElement | null) => { barsRef.current = el; }}>
              {heights.map((hb, i) => (
                <span class={'ci-waveform__bar' + (i >= heights.length - 10 ? ' is-live' : '')} style={`height:${hb}%`} />
              ))}
            </div>
            <span class="ci-waveform__time" ref={(el: HTMLSpanElement | null) => { timeRef.current = el; }}>0:00</span>
          </div>
          <button type="button" class="ci-action-btn" data-state="recording" aria-label="Stop recording" onClick={() => finishRecording(true)}><Icon d={P_MIC} size={19} /></button>
        </div>
      </div>
    );
  }

  if (mode === 'ready' && voice) {
    return (
      <div class="ci-root">
        <div class="chat-input chat-input--voice-ready">
          <button type="button" class="ci-play-btn" aria-label="Play voice" onClick={togglePlay}>
            {playing ? <Icon d={P_PAUSE} size={15} /> : <Icon d={P_PLAY} size={15} />}
          </button>
          <div class="ci-waveform">
            <div class="ci-waveform__bars" ref={(el: HTMLDivElement | null) => { barsRef.current = el; }}>
              {heights.map((hb) => (
                <span class="ci-waveform__bar" style={`height:${hb}%`} />
              ))}
            </div>
            <span class="ci-waveform__time" ref={(el: HTMLSpanElement | null) => { timeRef.current = el; }}>{formatTime(voice.seconds)}</span>
          </div>
          <button type="button" class="ci-cancel-btn" aria-label="Delete voice" onClick={resetToIdle}><Icon d={P_CLOSE} size={15} /></button>
          <button type="button" class="ci-action-btn" data-state="active" aria-label="Send voice" onClick={sendVoice}><Icon d={P_SEND} size={19} /></button>
        </div>
      </div>
    );
  }

  const sendState = hasText ? 'active' : 'inactive';
  return (
    <div class="ci-root">
      {showToolbar ? toolbar : null}
      <div class="chat-input chat-input--standard" data-role="bar">
        <button type="button" class="ci-icon-btn" aria-label="Attach" onClick={() => setShowToolbar((v) => !v)}><Icon d={P_ATTACH} size={21} /></button>
        <div class="ci-field">
          <div
            id="tg-msg-input"
            class="ci-field__text"
            contentEditable="true"
            data-placeholder={t(S.CHAT_PLACEHOLDER)}
            ref={(el: HTMLDivElement | null) => { editRef.current = el; }}
            onInput={onEditInput}
            onKeyDown={(e: any) => {
              if (e.key === 'Enter' && !e.shiftKey && !composing && !(e as any).isComposing) { e.preventDefault(); doSend(); }
            }}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onBlur={emitTypingStop}
          />
          <button type="button" class="ci-emoji-btn" id="tg-emoji-btn" title={t(S.EMOJI_TITLE)} aria-label="Emoji" onClick={onEmojiToggle}><Icon d={P_SMILEY} /></button>
        </div>
        <button
          type="button"
          id="tg-send-msg-btn"
          class="ci-action-btn"
          data-role="action"
          data-state={sendState}
          aria-label={hasText ? 'Send message' : 'Record voice'}
          onClick={() => { if (hasText) doSend(); else void startRecording(); }}
        >
          <Icon d={hasText ? P_SEND : P_MIC} size={19} />
        </button>
      </div>
    </div>
  );
}
