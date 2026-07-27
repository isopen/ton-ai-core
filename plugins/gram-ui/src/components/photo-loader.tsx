import { h } from '@ton-ai/atom/jsx-runtime';

interface PhotoLoaderProps {
  percent: number;
  fileSize?: string;
  className?: string;
  hideIcon?: boolean;
  hidePercent?: boolean;
}

export function PhotoLoader(props: PhotoLoaderProps) {
  const { percent, fileSize, className = '', hideIcon, hidePercent } = props;

  let cls = 'PhotoLoader';
  if (className) cls += ' ' + className;

  return (
    <div class={cls}>
      <div class="PhotoLoader__circle">
        <svg class="PhotoLoader__ring" viewBox="0 0 64 64">
          <circle class="PhotoLoader__ring-bg" cx="32" cy="32" r="27" />
          <circle class="PhotoLoader__ring-fg" cx="32" cy="32" r="27" />
        </svg>
        {hideIcon ? null : (
          <svg class="PhotoLoader__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 4v12" />
            <path d="M6 12l6 6 6-6" />
            <path d="M5 21h14" />
          </svg>
        )}
      </div>
      {hidePercent ? null : percent > 0 ? <span class="PhotoLoader__percent">{percent}%</span> : <span class="PhotoLoader__dots"><span class="PhotoLoader__dot" /><span class="PhotoLoader__dot" /><span class="PhotoLoader__dot" /></span>}
      {fileSize ? <span class="PhotoLoader__size">{fileSize}</span> : null}
    </div>
  );
}
