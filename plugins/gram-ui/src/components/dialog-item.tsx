import { h } from '../framework/jsx-runtime.js';
import { Avatar } from '../primitives/avatar.js';
import { ListItem } from '../primitives/list-item.js';
import { Text } from '../primitives/text.js';
import { Badge } from '../primitives/badge.js';
import { TypingIndicator } from './typing-indicator.js';
import type { Dialog } from '../types.js';
import { getPeerName, formatDialogDate, getInitials } from '../utils.js';

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

  const before = (
    <div style="position:relative">
      <Avatar url={d.peer.avatarUrl} initial={initial} color={avatarBg} size="medium" />
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
      <Text variant="label">{getPeerName(d.peer, selfUserId)}</Text>
      {typingText ? <TypingIndicator text={typingText} /> : <Text variant="desc">{d.lastMsg || ''}</Text>}
    </ListItem>
  );
}
