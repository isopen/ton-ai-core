import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { createPortal } from '@ton-ai/atom';
import { useState, useEffect, useRef } from '@ton-ai/atom/hooks';
import { t, S, tpl } from '@ton-ai/gram-lang';
import { getLogger } from '@ton-ai/gram-debug';
import { EmojiText } from './emoji-text.js';
import { Checkmark } from './checkmark.js';
import { Radio } from '../primitives/radio.js';
import { Checkbox } from '../primitives/checkbox.js';
import { Image } from '../primitives/image.js';
import { PhotoLoader } from './photo-loader.js';
import { MediaSourceBadge } from './media-source-badge.js';
import { VideoMessage } from './video-message.js';
import { MediaPlayer } from './media-player.js';
import { buildImageSpec, isInlinePhotoSize } from './photo-spec.js';
import { photoAvailability, bestSourceUrl, requestPhoto, requestDocument } from './media-source.js';
import { isAnimatedMedia, getMediaType, buildDocumentThumb } from '../utils.js';
import type { ImageSpec } from '../types.js';

const pollPhotoLog = getLogger('gram-ui:photo');

function toFileSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function pollAnswerKey(m: any, opt: string): string {
  return 'poll:' + String(m?.id ?? '') + ':' + opt;
}

function fmtDur(s: number): string {
  s = Math.max(0, Math.round(s || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function animationsOff(): boolean {
  try {
    if (typeof document !== 'undefined' && (document.documentElement as any)?.dataset?.animations === 'off') return true;
  } catch { return true; }
  return false;
}

const APPEAR_HOLD_MS = 15;
const APPEAR_RUN_MS = 325;
const UPDATE_RUN_MS = 88;

function AnimatedPct({ value, onDone }: { value: number; onDone?: () => void }) {
  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);
  const firstRef = useRef(true);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    const from = firstRef.current ? 0 : shownRef.current;
    const wasFirst = firstRef.current;
    firstRef.current = false;
    if (animationsOff() || value === from) {
      if (shownRef.current !== value) {
        shownRef.current = value;
        setShown(value);
      }
      if (onDone) onDone();
      return;
    }
    const appear = wasFirst && from === 0 && value > from;
    const gliding = appear || value < from;
    const dur = gliding ? APPEAR_RUN_MS : UPDATE_RUN_MS;
    const t0 = performance.now() + (appear ? APPEAR_HOLD_MS : 0);
    const step = (t: number) => {
      const k = Math.min(1, Math.max(0, (t - t0) / dur));
      const e = gliding ? k : 1 - Math.pow(1 - k, 3);
      const cur = from + Math.round((value - from) * e);
      if (cur !== shownRef.current) {
        shownRef.current = cur;
        setShown(cur);
      }
      if (k < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        if (shownRef.current !== value) {
          shownRef.current = value;
          setShown(value);
        }
        if (onDone) onDone();
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [value]);
  return <>{shown + '%'}</>;
}

interface PollAnswerVoters {
  chosen?: boolean;
  correct?: boolean;
  voters: number;
}

export function PollBubble({ m, timeStr, out, status, sameSenderPrev, sameSenderNext, onOpenPhoto, documentUrls, photoSource, documentProgress, documentSources }: {
  m: any;
  timeStr: string;
  out: boolean;
  status: 'pending' | 'sent' | 'delivered' | 'read';
  sameSenderPrev?: boolean;
  sameSenderNext?: boolean;
  onOpenPhoto?: (image: ImageSpec, index: number) => void;
  documentUrls?: Record<number | string, string>;
  photoSource?: string;
  documentProgress?: Record<number | string, number>;
  documentSources?: Record<number | string, string>;
}) {
  const media = m.media || {};
  const poll = media.poll || {};
  const results = media.results || {};
  const answers: any[] = Array.isArray(poll.answers) ? poll.answers : [];
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [fullscreenOpt, setFullscreenOpt] = useState<string | null>(null);
  const prevVotedRef = useRef(false);

  useEffect(() => {
    if (!fullscreenOpt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreenOpt(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fullscreenOpt]);

  const votersByKey = new Map<string, PollAnswerVoters>();
  for (const r of (results.results || [])) {
    if (!r) continue;
    votersByKey.set(String(r.option), { chosen: !!r.chosen, correct: !!r.correct, voters: (r.voters || 0) > 0 ? (r.voters || 0) : (!!r.chosen ? 1 : 0) });
  }
  const total = results.total_voters || 0;
  const closed = poll.closed === true;
  const quiz = poll.quiz === true;
  const multi = poll.multiple_choice === true;
  const voted = Array.from(votersByKey.values()).some((r) => r.chosen);
  const optimisticKey = !multi && !closed && !voted && picked.size === 1 ? Array.from(picked)[0] : null;
  const effTotal = optimisticKey ? (total > 0 ? total + 1 : 1) : total;

  const keyOf = (a: any) => String(a.option);
  const snapRef = useRef<{ votes: Map<string, { voters: number; chosen: boolean }>; total: number } | null>(null);
  const [, setRevTick] = useState(0);
  if (voted || optimisticKey) {
    const snapVotes = new Map<string, { voters: number; chosen: boolean }>();
    for (const a of answers) {
      const sk = keyOf(a);
      const sv = votersByKey.get(sk);
      snapVotes.set(sk, optimisticKey
        ? (sk === optimisticKey ? { voters: 1, chosen: true } : (sv ? { voters: sv.voters, chosen: !!sv.chosen } : { voters: 0, chosen: false }))
        : (sv ? { voters: sv.voters, chosen: !!sv.chosen } : { voters: 0, chosen: false }));
    }
    snapRef.current = { votes: snapVotes, total: effTotal };
  }
  const endReverse = () => {
    snapRef.current = null;
    setRevTick((t) => t + 1);
  };
  let revSnap = !voted && !optimisticKey && !closed && !animationsOff() ? snapRef.current : null;
  let anchorKey: string | null = null;
  if (revSnap) {
    let best = -1;
    for (const a of answers) {
      const ak = keyOf(a);
      const av = votersByKey.get(ak);
      if (av && (av.voters > 0 || total > 0)) continue;
      const srow = revSnap.votes.get(ak);
      if (!srow || srow.voters <= 0) continue;
      if (srow.chosen || srow.voters > best) {
        anchorKey = ak;
        best = srow.voters;
        if (srow.chosen) break;
      }
    }
    if (!anchorKey) {
      snapRef.current = null;
      revSnap = null;
    }
  }
  const canVote = !closed && !voted && !optimisticKey && !revSnap && answers.length > 0;
  const qText = poll.question?.text || '';
  const qEnts = poll.question?.entities || [];
  const capText = m.message || '';
  const capEnts = m.entities || [];
  const attachedPhoto = media.attached_media?.photo || media.photo || null;
  const attachSpec = attachedPhoto ? buildImageSpec({ media: { photo: attachedPhoto } }) : null;
  const attachedDoc: any = media.attached_media?.document || media.document || null;
  const docAttrs: any[] = Array.isArray(attachedDoc?.attributes) ? attachedDoc.attributes : [];
  const attachVideo = !!attachedDoc && (
    (attachedDoc.mime_type || '').toLowerCase().startsWith('video/')
    || docAttrs.some((a: any) => a._ === 'documentAttributeVideo' || a._ === 'documentAttributeAnimated')
  );
  const videoM = attachVideo ? { id: m.id, media: { _: 'messageMediaDocument', document: attachedDoc }, message: '', entities: [] } : null;
  const attachAnimated = videoM ? isAnimatedMedia(videoM.media) : false;
  const { hasAnyUrl } = photoAvailability(attachedPhoto);
  const photoProgress = attachedPhoto?.progress !== undefined ? attachedPhoto.progress : 0;
  const photoFileSize = toFileSize(attachedPhoto?.size);
  const isPreloading = !!attachedPhoto && !hasAnyUrl;
  const photoFailed = attachedPhoto?.failed === true;
  const attachImgWidth = attachSpec ? Math.min(attachSpec.width || 320, 320) : 0;
  const answerMediaSig = answers.map((a: any) => {
    const am = a?.media;
    if (!am) return '-';
    if (am.photo) return 'p:' + (am.photo.sizes || []).filter((s: any) => s.url || s.src).map((s: any) => s.type).join(',');
    if (am.document) return 'd:' + ((documentUrls as any)?.[pollAnswerKey(m, keyOf(a))] ? '1' : '0');
    return '?';
  }).join('|');
  const obsRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (picked.size === 0) {
      if (sending) setSending(false);
      prevVotedRef.current = voted;
      return;
    }
    if (voted || prevVotedRef.current) {
      setPicked(new Set());
      if (sending) setSending(false);
    }
    prevVotedRef.current = voted;
  });

  useEffect(() => {
    const onFail = (e: Event) => {
      const mid = (e as CustomEvent).detail?.messageId;
      if (String(mid) !== String(m.id)) return;
      setSending(false);
      if (!multi) setPicked(new Set());
    };
    window.addEventListener('tg-poll-vote-failed', onFail);
    return () => window.removeEventListener('tg-poll-vote-failed', onFail);
  }, [m.id]);

  useEffect(() => {
    const hasAnswerMedia = answers.some((a: any) => !!a?.media);
    if (!attachedPhoto && !hasAnswerMedia) return;
    const requestAll = () => {
      if (attachedPhoto) {
        requestPhoto(attachedPhoto, m.id, { tag: 'PollBubble' });
      }
      for (const a of answers) {
        const am = a?.media;
        if (!am) continue;
        const okey = pollAnswerKey(m, keyOf(a));
        if (am.photo && Array.isArray(am.photo.sizes)) {
          if (am.photo.failed === true) continue;
          requestPhoto(am.photo, okey, { tag: 'PollBubble' });
          continue;
        }
        const doc = am.document;
        if (doc && doc._ !== 'documentEmpty') {
          if (!(documentUrls as any)?.[okey]) {
            requestDocument(doc, okey, 1, { tag: 'PollBubble' });
          }
        }
      }
    };
    const timer = setTimeout(() => {
      const el = document.getElementById(`msg-${m.id}`);
      if (!el) {
        pollPhotoLog.info('[PollBubble] NO ELEMENT msg-' + m.id);
        requestAll();
        return;
      }
      const obs = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) requestAll();
      }, { rootMargin: '200px' });
      obsRef.current = obs;
      obs.observe(el);
    }, 0);
    return () => {
      clearTimeout(timer);
      if (obsRef.current) {
        obsRef.current.disconnect();
        obsRef.current = null;
      }
    };
  }, [m.id, hasAnyUrl, answerMediaSig]);

  const retryPhoto = () => {
    requestPhoto(attachedPhoto, m.id, { tag: 'PollBubble', force: true });
  };

  const vote = () => {
    if (!multi || picked.size === 0 || sending) return;
    setSending(true);
    window.dispatchEvent(new CustomEvent('tg-send-poll-vote', { detail: { messageId: m.id, options: [...picked] } }));
  };

  const voteNow = (key: string) => {
    if (picked.has(key)) return;
    try {
      const danim = (document.documentElement as any)?.dataset?.animations || '?';
      const rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 0;
      pollPhotoLog.info('[pollscroll] vote msg=' + m.id + ' opt=' + key + ' danim=' + danim + ' rm=' + rm);
    } catch {}
    setPicked(new Set([key]));
    window.dispatchEvent(new CustomEvent('tg-send-poll-vote', { detail: { messageId: m.id, options: [key] } }));
  };

  const togglePicked = (key: string) => {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  };

  const fromPrimitiveLabel = (e: any): boolean => {
    try {
      const t = e?.target as HTMLElement | null;
      return !!t && typeof (t as any).closest === 'function' && !!(t as any).closest('label');
    } catch { return false; }
  };

  let cls = 'MessageBubble MessageBubble_poll';
  cls += out ? ' MessageBubble_out' : ' MessageBubble_in';
  if (sameSenderPrev) cls += ' MessageBubble_group_prev';
  if (sameSenderNext) cls += ' MessageBubble_group_next';

  const fsA = fullscreenOpt ? answers.find((a: any) => keyOf(a) === fullscreenOpt) : null;
  const fsAm = fsA?.media && fsA.media.document && getMediaType(fsA.media) === 'video' ? fsA.media : null;
  let fsW = 0;
  if (fsAm) {
    const fdoc = fsAm.document;
    const fattrs: any[] = Array.isArray(fdoc?.attributes) ? fdoc.attributes : [];
    const fv = fattrs.find((x: any) => x._ === 'documentAttributeVideo');
    const fvw = fv?.w || fdoc?.w || 0;
    const fvh = fv?.h || fdoc?.h || 0;
    const winW = typeof window !== 'undefined' ? window.innerWidth : 720;
    const winH = typeof window !== 'undefined' ? window.innerHeight : 600;
    fsW = Math.max(280, Math.min(fvw || 640, 720, winW - 32));
    if (fvw > 0 && fvh > 0) {
      const capH = Math.max(240, winH - 140);
      const estH = Math.round(fvh * fsW / fvw);
      if (estH > capH) fsW = Math.max(280, Math.round(fsW * capH / estH));
    }
  }
  const fsVm = fsAm ? { id: pollAnswerKey(m, fullscreenOpt || ''), media: fsAm, message: '', entities: [] } : null;

  return (
    <div class={cls} data-zzpicked={Array.from(picked).join(',')} style={(attachSpec || attachVideo) ? 'width:fit-content;max-width:320px' : undefined}>
      <div class="tgui-poll-header">📊 {quiz ? t(S.POLL_QUIZ) : t(S.POLL_TITLE)}{closed ? ' · ' + t(S.POLL_CLOSED) : ''}</div>
      <div class="tgui-poll-question"><EmojiText text={qText} entities={qEnts} documentUrls={documentUrls || {}} /></div>
      {!multi && !poll.public_voters ? <div class="tgui-poll-sub">{t(S.POLL_ANONYMOUS)}</div> : null}
      {multi ? <div class="tgui-poll-sub">{t(S.POLL_MULTI_HINT)}</div> : null}
      {attachSpec ? (
        <div key="cover-photo" class="tgui-poll-attach">
          <div class={'tgui-photo-preview' + (isPreloading ? ' tgui-photo-preview_loading' : '')}>
            <Image key="img" image={attachSpec} maxWidth={320} lazy={false} onOpenViewer={onOpenPhoto && attachSpec ? () => onOpenPhoto(attachSpec, 0) : undefined} />
            {isPreloading && !photoFailed ? <div key="scrim" class="tgui-photo-scrim" /> : null}
            {isPreloading && !photoFailed ? <PhotoLoader key="pl" percent={photoProgress} fileSize={photoFileSize} hidePercent={attachImgWidth > 0 && attachImgWidth < 140} /> : null}
            {isPreloading && photoFailed ? (
              <div key="err" class="tgui-photo-error">
                <div class="tgui-photo-error-text">{t(S.PHOTO_LOAD_FAILED)}</div>
                <button class="tgui-photo-error-retry" type="button" onClick={retryPhoto}>{t(S.PHOTO_RETRY)}</button>
              </div>
            ) : null}
            {photoSource ? <MediaSourceBadge key="src" source={photoSource} /> : null}
          </div>
        </div>
      ) : attachVideo && videoM ? (
        <div key="cover-video" class="tgui-poll-attach tgui-poll-attach_video">
          {attachAnimated ? (
            <MediaPlayer m={videoM} timeStr={timeStr} out={out} status={status} documentUrls={documentUrls || {}} documentProgress={documentProgress} documentSources={documentSources} maxWidth={296} />
          ) : (
            <VideoMessage m={videoM} timeStr={timeStr} out={out} status={status} documentUrls={documentUrls || {}} documentProgress={documentProgress} documentSources={documentSources} maxWidth={296} />
          )}
        </div>
      ) : null}
      {capText ? <div class="tgui-poll-caption"><EmojiText text={capText} entities={capEnts} documentUrls={documentUrls || {}} /></div> : null}
      <div class="tgui-poll-answers">
        {answers.map((a: any) => {
          const key = keyOf(a);
          const serverV = votersByKey.get(key);
          const v = optimisticKey ? (key === optimisticKey ? { chosen: true, voters: 1 } : (serverV || { chosen: false, voters: 0 })) : serverV;
          const serverShowStat = !!serverV && (serverV.voters > 0 || total > 0);
          const showStat = optimisticKey ? true : (serverV ? serverShowStat : (voted || total > 0));
          const snapRow = revSnap ? revSnap.votes.get(key) : undefined;
          const reverseRow = !!revSnap && !serverShowStat && !!snapRow && snapRow.voters > 0;
          const pct = reverseRow ? 0 : (effTotal > 0 && v ? Math.round((v.voters / effTotal) * 100) : 0);
          const frozenPct = reverseRow && revSnap && snapRow ? (revSnap.total > 0 ? Math.round((snapRow.voters / revSnap.total) * 100) : 100) : 0;
          const serverChosen = serverV ? !!serverV.chosen : optimisticKey === key;
          const chosen = !multi && (voted || !!optimisticKey) ? (optimisticKey === key || serverChosen) : (picked.has(key) || serverChosen || (reverseRow && !!snapRow?.chosen));
          const am = a.media;
          let optMedia: any = null;
          if (am && am.photo) {
            const spec = buildImageSpec({ media: { photo: am.photo } });
            if (spec) {
              const sizes = am.photo.sizes || [];
              const anyUrl = sizes.some((s: any) => !isInlinePhotoSize(s) && !!(s.url || s.src));
              const failed = am.photo.failed === true;
              const okey = pollAnswerKey(m, key);
              const bestUrl = bestSourceUrl(spec);
              const openOrRetry = () => {
                if (bestUrl && onOpenPhoto) {
                  onOpenPhoto(spec, 0);
                  return;
                }
                requestPhoto(am.photo, okey, { tag: 'PollBubble' });
              };
              optMedia = (
                <div key="optps" class="tgui-poll-optmedia_small" onClick={(e: any) => { e.stopPropagation(); openOrRetry(); }}>
                  {bestUrl ? <img key="thumb" class="tgui-poll-optthumb" src={bestUrl} alt="" /> : <div key="thumb" class="tgui-poll-optthumb tgui-poll-optthumb_empty" />}
                  {!anyUrl && failed ? (
                    <div key="err" class="tgui-photo-error">
                      <button class="tgui-photo-error-retry" type="button" onClick={(e: any) => { e.stopPropagation(); openOrRetry(); }}>{t(S.PHOTO_RETRY)}</button>
                    </div>
                  ) : null}
                </div>
              );
            }
          } else if (am && am.document && getMediaType(am) === 'video') {
            const doc = am.document;
            const dattrs: any[] = Array.isArray(doc?.attributes) ? doc.attributes : [];
            const vattr = dattrs.find((x: any) => x._ === 'documentAttributeVideo');
            const dur = vattr?.duration || doc?.duration || 0;
            const thumb = buildDocumentThumb(doc);
            optMedia = (
              <div key="optvs" class="tgui-poll-optmedia_small" onClick={(e: any) => { e.stopPropagation(); setFullscreenOpt(key); }}>
                {thumb?.url ? <img key="thumb" class="tgui-poll-optthumb" src={thumb.url} alt="" /> : <div key="thumb" class="tgui-poll-optthumb tgui-poll-optthumb_empty" />}
                <div key="play" class="tgui-poll-optplay">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="8,5 19,12 8,19" />
                  </svg>
                </div>
                <span key="dur" class="MediaCollage__video-duration">{fmtDur(dur)}</span>
              </div>
            );
          }
          return (
            <div
              key={key}
              class={'tgui-poll-answer'
                + ((showStat || reverseRow) ? ' tgui-poll-answer_res' : '')
                + (canVote ? ' tgui-poll-answer_pick' : '')
                + (chosen ? ' tgui-poll-answer_chosen' : '')
                + (optMedia ? ' tgui-poll-answer_hasmedia' : '')}
              onClick={canVote
                ? (e: any) => {
                    if (fromPrimitiveLabel(e)) return;
                    if (multi) {
                      togglePicked(key);
                    } else {
                      voteNow(key);
                    }
                  }
                : undefined}
            >
              <div key="main" class="tgui-poll-optmain">
                <div class="tgui-poll-opttop">
                  {showStat || reverseRow ? <span key="pct" class="tgui-poll-pct"><AnimatedPct value={pct} onDone={reverseRow && key === anchorKey ? endReverse : undefined} /></span> : null}
                  {canVote ? (
                    <span key="markTop" class="tgui-poll-mark">
                      {multi
                        ? <Checkbox size="large" checked={chosen} disabled={false} onChange={() => togglePicked(key)} />
                        : <Radio size="large" checked={chosen} disabled={false} onChange={() => voteNow(key)} />}
                    </span>
                  ) : null}
                  <span key="text" class="tgui-poll-text"><EmojiText text={a.text?.text || ''} entities={a.text?.entities || []} documentUrls={documentUrls || {}} /></span>
                  {showStat || reverseRow ? <span key="cnt" class="tgui-poll-count">{showStat ? (v ? v.voters.toLocaleString('en-US') : '') : String(snapRow && snapRow.voters > 0 ? snapRow.voters : 0)}</span> : null}
                </div>
                {showStat || reverseRow ? (
                  <div key="bot" class="tgui-poll-optbottom">
                    {showStat ? (
                    <span key="markBot" class="tgui-poll-mark">
                      {multi
                        ? <Checkbox size="large" checked={serverChosen} disabled onChange={undefined} />
                        : <Radio size="large" checked={serverChosen} disabled onChange={undefined} />}
                    </span>
                    ) : reverseRow ? (
                    <span key="markBot" class="tgui-poll-mark">
                      {multi
                        ? <Checkbox size="large" checked={!!snapRow?.chosen} disabled onChange={undefined} />
                        : <Radio size="large" checked={!!snapRow?.chosen} disabled onChange={undefined} />}
                    </span>
                    ) : <span key="markBot" class="tgui-poll-mark" />}
                    <div key="track" class="tgui-poll-track"><div key="fill" class={reverseRow ? 'tgui-poll-bar tgui-poll-bar_rev' : 'tgui-poll-bar'} style={`width:${reverseRow ? frozenPct : pct}%`} /></div>
                  </div>
                ) : null}
              </div>
              {optMedia ? <div key="optmedia" class="tgui-poll-optmedia">{optMedia}</div> : null}
            </div>
          );
        })}
      </div>
      {canVote && poll.open_answers === true ? (
        <div class="tgui-poll-add">
          <span class="tgui-poll-add-plus">+</span>
          <span class="tgui-poll-add-text">{t(S.POLL_ADD_ANSWER)}</span>
        </div>
      ) : null}
      {canVote && multi ? (
        <button class="tgui-poll-vote" type="button" disabled={picked.size === 0 || sending} onClick={vote}>{tpl(S.POLL_DONE, { count: picked.size })}</button>
      ) : null}
      <div class="MessageBubble__meta">
        <span class="tgui-poll-total">{effTotal === 1 ? t(S.POLL_VOTE_ONE) : effTotal > 0 ? tpl(S.POLL_VOTES_MANY, { count: effTotal.toLocaleString('en-US') }) : t(S.POLL_NO_VOTES)}</span>
        <span class="MessageBubble__time">{timeStr}</span>
        {out ? <Checkmark status={status} className="MessageBubble__status" /> : null}
      </div>
      {fsVm ? createPortal((
        <div class="tgui-poll-fs" onClick={() => setFullscreenOpt(null)}>
          <div class="tgui-poll-fs_box" style={`width:${fsW}px;max-width:100%`} onClick={(e: any) => e.stopPropagation()}>
            <button class="tgui-poll-fs_close" type="button" onClick={() => setFullscreenOpt(null)}>×</button>
            {isAnimatedMedia(fsVm.media) ? (
              <MediaPlayer m={fsVm} timeStr={timeStr} out={out} status={status} documentUrls={documentUrls || {}} documentProgress={documentProgress} documentSources={documentSources} maxWidth={fsW} />
            ) : (
              <VideoMessage m={fsVm} timeStr={timeStr} out={out} status={status} documentUrls={documentUrls || {}} documentProgress={documentProgress} documentSources={documentSources} maxWidth={fsW} />
            )}
          </div>
        </div>
      ), typeof document !== 'undefined' ? document.body : null) : null}
    </div>
  );
}
