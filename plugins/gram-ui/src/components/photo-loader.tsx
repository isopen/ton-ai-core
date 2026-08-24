import { h } from '@ton-ai/atom/jsx-runtime';
import { memo } from '@ton-ai/atom';

interface PhotoLoaderProps {
  percent: number;
  fileSize?: string;
  className?: string;
  hideIcon?: boolean;
  hidePercent?: boolean;
}

export const PhotoLoader = memo(function PhotoLoader(props: Record<string, any>) {
  const { percent, fileSize, className = '', hideIcon, hidePercent } = props;

  let cls = 'PhotoLoader';
  if (className) cls += ' ' + className;

  return (
    <div class={cls}>
      <div class="PhotoLoader__circle">
        <div class="PhotoLoader__spinner" />
        {hideIcon ? null : (
          <svg class="PhotoLoader__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 4v12" />
            <path d="M6 12l6 6 6-6" />
            <path d="M5 21h14" />
          </svg>
        )}
      </div>
      {hidePercent ? null : (
        <span class="PhotoLoader__status">
          {percent > 0
            ? <span class="PhotoLoader__percent">{Math.round(percent)}%</span>
            : <span class="PhotoLoader__dots"><span class="PhotoLoader__dot" /><span class="PhotoLoader__dot" /><span class="PhotoLoader__dot" /></span>}
        </span>
      )}
      {fileSize ? <span class="PhotoLoader__size">{fileSize}</span> : null}
    </div>
  );
});
