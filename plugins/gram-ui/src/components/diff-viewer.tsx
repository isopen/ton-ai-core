import { h } from '@ton-ai/atom/jsx-runtime';
import { useState, useDomEvent } from '@ton-ai/atom/hooks';

export type DiffLineKind = 'ctx' | 'add' | 'del';

export interface DiffLine {
  nOld?: number;
  nNew?: number;
  text: string;
  kind: DiffLineKind;
}

export interface DiffHunk {
  head: string;
  lines: DiffLine[];
}

export function DiffViewer({
  filePath,
  hunks,
  onClose,
}: {
  filePath: string;
  hunks: DiffHunk[];
  onClose: () => void;
}) {
  const [leftOff, setLeftOff] = useState(false);
  const [rightOff, setRightOff] = useState(false);
  useDomEvent(() => (typeof window === 'undefined' ? null : window) as any, 'keydown', ((e: any) => {
    if (e && e.key === 'Escape') onClose();
  }) as any);
  const totalAdd = hunks.reduce((a, hh) => a + hh.lines.filter((l) => l.kind === 'add').length, 0);
  const totalDel = hunks.reduce((a, hh) => a + hh.lines.filter((l) => l.kind === 'del').length, 0);
  return (
    <div class="DiffViewer" role="dialog" aria-label={filePath}>
      <div class="DiffViewer__backdrop" onClick={onClose} />
      <div class="DiffViewer__sheet">
        <div class="DiffViewer__header">
          <button class="DiffViewer__back" onClick={onClose} aria-label="Back">←</button>
          <div class="DiffViewer__titleWrap">
            <div class="DiffViewer__title">{filePath}</div>
            <div class="DiffViewer__sub">+{totalAdd} −{totalDel}</div>
          </div>
          <button
            class={`DiffViewer__toggle${leftOff ? ' is-off' : ''}`}
            onClick={() => setLeftOff(!leftOff)}
            aria-pressed={leftOff ? 'true' : 'false'}
          >
            L
          </button>
          <button
            class={`DiffViewer__toggle${rightOff ? ' is-off' : ''}`}
            onClick={() => setRightOff(!rightOff)}
            aria-pressed={rightOff ? 'true' : 'false'}
          >
            R
          </button>
        </div>
        <div class={`DiffViewer__body${leftOff ? ' hide-left' : ''}${rightOff ? ' hide-right' : ''}`}>
          {leftOff ? null : (
            <div class="DiffViewer__pane DiffViewer__pane_left">
              {hunks.map((hh, hi) => (
                <div class="DiffViewer__hunk" key={hi}>
                  <div class="DiffViewer__hunkHead">{hh.head}</div>
                  {hh.lines.map((l, li) =>
                    l.kind === 'add' ? null : (
                      <div class={`DiffViewer__line is-${l.kind}`} key={li}>
                        <span class="DiffViewer__num">{l.nOld ?? ''}</span>
                        <span class="DiffViewer__code">{l.text}</span>
                      </div>
                    ),
                  )}
                </div>
              ))}
            </div>
          )}
          {rightOff ? null : (
            <div class="DiffViewer__pane DiffViewer__pane_right">
              {hunks.map((hh, hi) => (
                <div class="DiffViewer__hunk" key={hi}>
                  <div class="DiffViewer__hunkHead">{hh.head}</div>
                  {hh.lines.map((l, li) =>
                    l.kind === 'del' ? null : (
                      <div class={`DiffViewer__line is-${l.kind}`} key={li}>
                        <span class="DiffViewer__num">{l.nNew ?? ''}</span>
                        <span class="DiffViewer__code">{l.text}</span>
                      </div>
                    ),
                  )}
                </div>
              ))}
            </div>
          )}
          <div class="DiffViewer__unified">
            {hunks.map((hh, hi) => (
              <div class="DiffViewer__hunk" key={hi}>
                <div class="DiffViewer__hunkHead">{hh.head}</div>
                {hh.lines.map((l, li) => (
                  <div class={`DiffViewer__line is-${l.kind}`} key={li}>
                    <span class="DiffViewer__num">{l.nOld ?? ''}</span>
                    <span class="DiffViewer__num">{l.nNew ?? ''}</span>
                    <span class="DiffViewer__code">{l.text}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
