import { h } from '@ton-ai/atom/jsx-runtime';
import { useState, useEffect, useRef } from '@ton-ai/atom/hooks';
import { EmojiText } from './emoji-text.js';
import { Checkmark } from './checkmark.js';
import { Image } from '../primitives/image.js';
import { buildImageSpec, chatPhotoPrio, firstMissingSizeType } from './photo-spec.js';
import type { ImageSpec } from '../types.js';

interface PollAnswerVoters {
  chosen?: boolean;
  correct?: boolean;
  voters: number;
}

export function PollBubble({ m, timeStr, out, status, sameSenderPrev, sameSenderNext, onOpenPhoto, documentUrls }: {
  m: any;
  timeStr: string;
  out: boolean;
  status: 'pending' | 'sent' | 'delivered' | 'read';
  sameSenderPrev?: boolean;
  sameSenderNext?: boolean;
  onOpenPhoto?: (image: ImageSpec, index: number) => void;
  documentUrls?: Record<number | string, string>;
}) {
  const media = m.media || {};
  const poll = media.poll || {};
  const results = media.results || {};
  const answers: any[] = Array.isArray(poll.answers) ? poll.answers : [];
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const votersByKey = new Map<string, PollAnswerVoters>();
  let hasResults = false;
  for (const r of (results.results || [])) {
    if (!r) continue;
    hasResults = true;
    votersByKey.set(String(r.option), { chosen: !!r.chosen, correct: !!r.correct, voters: r.voters || 0 });
  }
  const total = results.total_voters || 0;
  const closed = poll.closed === true;
  const quiz = poll.quiz === true;
  const multi = poll.multiple_choice === true;
  const canVote = !hasResults && !closed && answers.length > 0;

  const keyOf = (a: any) => String(a.option);
  const qText = poll.question?.text || '';
  const qEnts = poll.question?.entities || [];
  const capText = m.message || '';
  const capEnts = m.entities || [];
  const attachedPhoto = media.attached_media?.photo || null;
  const attachSpec = attachedPhoto ? buildImageSpec({ media: { photo: attachedPhoto } }) : null;
  const attachedDoc: any = media.attached_media?.document || null;
  const docAttrs: any[] = Array.isArray(attachedDoc?.attributes) ? attachedDoc.attributes : [];
  const attachVideo = !!attachedDoc && (
    (attachedDoc.mime_type || '').toLowerCase().startsWith('video/')
    || docAttrs.some((a: any) => a._ === 'documentAttributeVideo' || a._ === 'documentAttributeAnimated')
  );
  const attachVideoUrl = attachVideo ? (documentUrls?.[m.id] || '') : '';
  const attachRequestedRef = useRef(false);

  useEffect(() => {
    if (attachedPhoto) {
      const need = firstMissingSizeType(attachedPhoto, chatPhotoPrio());
      if (need) {
        window.dispatchEvent(new CustomEvent('tg-download-photo', {
          detail: { photo: attachedPhoto, sizeType: need.sizeType, messageId: m.id },
        }));
      }
      return;
    }
    if (attachVideo && !attachRequestedRef.current) {
      attachRequestedRef.current = true;
      window.dispatchEvent(new CustomEvent('tg-download-document', {
        detail: { document: attachedDoc, messageId: m.id, priority: 1 },
      }));
    }
  }, [m.id]);

  const vote = () => {
    if (picked.size === 0) return;
    window.dispatchEvent(new CustomEvent('tg-send-poll-vote', { detail: { messageId: m.id, options: [...picked] } }));
    setPicked(new Set());
  };

  let cls = 'MessageBubble MessageBubble_poll';
  cls += out ? ' MessageBubble_out' : ' MessageBubble_in';
  if (sameSenderPrev) cls += ' MessageBubble_group_prev';
  if (sameSenderNext) cls += ' MessageBubble_group_next';

  return (
    <div class={cls} style={(attachSpec || attachVideo) ? 'width:fit-content;max-width:320px' : undefined}>
      {attachSpec ? (
        <div class="tgui-poll-attach">
          <Image image={attachSpec} maxWidth={320} lazy={false} onOpenViewer={onOpenPhoto && attachSpec ? () => onOpenPhoto(attachSpec, 0) : undefined} />
        </div>
      ) : attachVideo ? (
        <div class="tgui-poll-attach">
          {attachVideoUrl ? (
            <video src={attachVideoUrl} controls playsinline preload="metadata" />
          ) : (
            <div class="tgui-poll-attach-loading">⏬</div>
          )}
        </div>
      ) : null}
      {capText ? <div class="tgui-poll-caption"><EmojiText text={capText} entities={capEnts} documentUrls={{}} /></div> : null}
      <div class="tgui-poll-header">{quiz ? 'Викторина' : 'Опрос'}{closed ? ' · закрыт' : ''}</div>
      <div class="tgui-poll-question"><EmojiText text={qText} entities={qEnts} documentUrls={{}} /></div>
      <div class="tgui-poll-answers">
        {answers.map((a: any) => {
          const key = keyOf(a);
          const v = votersByKey.get(key);
          const pct = total > 0 && v ? Math.round((v.voters / total) * 100) : 0;
          const chosen = v ? !!v.chosen : picked.has(key);
          const showBar = hasResults || total > 0;
          return (
            <div
              key={key}
              class={'tgui-poll-answer'
                + (showBar ? ' tgui-poll-answer_res' : '')
                + (canVote ? ' tgui-poll-answer_pick' : '')
                + (chosen ? ' tgui-poll-answer_chosen' : '')}
              onClick={canVote
                ? () => setPicked((prev) => {
                    const n = new Set(prev);
                    if (n.has(key)) n.delete(key);
                    else { if (!multi) n.clear(); n.add(key); }
                    return n;
                  })
                : undefined}
            >
              {showBar ? <div class="tgui-poll-bar" style={`width:${pct}%`} /> : null}
              <span class="tgui-poll-mark">{chosen ? (multi ? '☑' : '●') : (multi ? '☐' : '○')}</span>
              <span class="tgui-poll-text"><EmojiText text={a.text?.text || ''} entities={a.text?.entities || []} documentUrls={{}} /></span>
              {showBar ? <span class="tgui-poll-pct">{pct}%</span> : null}
            </div>
          );
        })}
      </div>
      {canVote && picked.size > 0 ? (
        <button class="tgui-poll-vote" type="button" onClick={vote}>Голосовать</button>
      ) : null}
      <div class="MessageBubble__meta">
        <span class="tgui-poll-total">{total > 0 ? `${total} голосов` : 'Нет голосов'}</span>
        <span class="MessageBubble__time">{timeStr}</span>
        {out ? <Checkmark status={status} className="MessageBubble__status" /> : null}
      </div>
    </div>
  );
}
