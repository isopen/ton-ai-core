import { h } from '@ton-ai/atom/jsx-runtime';
import { Avatar } from '../primitives/avatar.js';
import { ListItem } from '../primitives/list-item.js';
import { Text } from '../primitives/text.js';
import { Badge } from '../primitives/badge.js';
import { TypingIndicator } from './typing-indicator.js';
import { EmojiText } from './emoji-text.js';
import type { Dialog } from '../types.js';
import { getPeerName, formatDialogDate, getInitials, buildPeerBlurThumb } from '../utils.js';

interface DialogItemProps {
  d: Dialog;
  selected: boolean;
  collapsed: boolean;
  typingText: string;
  selfUserId?: string;
  onClick: () => void;
}

export function DialogItem(props: DialogItemProps) {
  const { d, selected, collapsed, typingText, selfUserId, onClick } = props;
  const avatarBg = d.peer.avatarUrl ? 'transparent' : (d.peer.type === 'user' ? '#1a4d8c' : '#2d5a27');
  const initial = getInitials(d.peer);
  // Split avatar sources Telegram-style:
  //   blur — inline stripped-size preview (computed in the worker, zero network)
  //   url  — full downloaded file (blob:), fades in over the blur
  const rawUrl = d.peer.avatarUrl || '';
  const isFullFile = rawUrl.startsWith('blob:') || /^https?:/.test(rawUrl);
  const blurThumb = d.peer.blurUrl || buildPeerBlurThumb(d.peer.photo)
    || (/^data:image/.test(rawUrl) ? rawUrl : '');
  const fullUrl = isFullFile ? rawUrl : '';

  const before = (
    <div style="position:relative">
      <Avatar url={fullUrl} blurUrl={blurThumb} initial={initial} color={avatarBg} size="medium" />
      {collapsed && d.unreadCount > 0
        ? <Badge key={d.unreadCount} count={d.unreadCount} variant="circle" max={9} />
        : null}
    </div>
  );

  const after = (
    <div class="DialogItem__after">
      <Text variant="caption">{formatDialogDate(d.date)}</Text>
      {d.unreadCount > 0 ? <Badge key={d.unreadCount} count={d.unreadCount} variant="pill" /> : null}
    </div>
  );

  return (
    <ListItem
      before={before}
      after={after}
      selected={selected}
      collapsed={collapsed}
      onClick={onClick}
    >
      <span class="Text Text_variant_label"><EmojiText text={getPeerName(d.peer, selfUserId)} documentUrls={{}} inlineSize={20} singleLine ctx="dialog" /></span>
      {typingText ? <TypingIndicator text={typingText} /> : <span class="Text Text_variant_desc"><EmojiText text={d.lastMsg || ''} entities={d.lastMsgEntities} documentUrls={{}} inlineSize={17} singleLine ctx="dialog" /></span>}
    </ListItem>
  );
}
