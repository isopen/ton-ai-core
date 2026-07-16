import { h } from '../framework/jsx-runtime.js';

interface AvatarProps {
  url?: string;
  initial: string;
  color: string;
  size?: 'small' | 'medium' | 'large';
  className?: string;
}

export function Avatar({ url, initial, color, size = 'medium', className = '' }: AvatarProps) {
  let cls = 'Avatar Avatar_size_' + size;
  if (className) cls += ' ' + className;
  return (
    <div class={cls} style={`background:${color}`}>
      {url
        ? <img src={url} alt="" class="Avatar__img" />
        : initial}
    </div>
  );
}
