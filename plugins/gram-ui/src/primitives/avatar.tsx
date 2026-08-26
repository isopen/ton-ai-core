import { h } from '@ton-ai/atom/jsx-runtime';
import { Image } from './image.js';
import type { ImageSpec } from '../types.js';

interface AvatarProps {
  url?: string;
  /** Inline low-res preview (data URI): blurred underlay shown while the full
   *  avatar downloads. Telegram Android pattern. */
  blurUrl?: string;
  initial: string;
  color: string;
  size?: 'small' | 'medium' | 'large';
  className?: string;
}

function dimFromSize(size: string): number {
  return size === 'small' ? 40 : size === 'large' ? 56 : 48;
}

export function Avatar({ url, blurUrl, initial, color, size = 'medium', className = '' }: AvatarProps) {
  let cls = 'Avatar Avatar_size_' + size;
  if (className) cls += ' ' + className;
  const dim = dimFromSize(size);
  const imageSpec: ImageSpec | undefined = url ? {
    id: url,
    width: dim,
    height: dim,
    original: { url, width: dim, height: dim },
  } : undefined;
  const initialCls = 'Avatar__initial' + (initial.length > 1 ? ' Avatar__initial_double' : '');
  return (
    <div class={cls} style={`background:${color}`}>
      <span class={initialCls}>{initial}</span>
      {/* Blurred inline preview sits above the tint/initials and below the
          sharp image; TelegramImage fades in over it once loaded. */}
      {blurUrl ? <img class="Avatar__blur" src={blurUrl} alt="" /> : null}
      {imageSpec && <Image image={imageSpec} width={dim} lazy={false} />}
    </div>
  );
}
