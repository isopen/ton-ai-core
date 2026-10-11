import { h } from '@ton-ai/atom/jsx-runtime';
import { Avatar } from '../primitives/avatar.js';
import { ListItem } from '../primitives/list-item.js';
import { Text } from '../primitives/text.js';
import { Badge } from '../primitives/badge.js';
import { Spinner } from '../primitives/spinner.js';
import { EmojiText } from './emoji-text.js';
import { t, S } from '@ton-ai/gram-lang';
import type { AppState, ForumTopic } from '../types.js';
import type { Dispatch } from '../state.js';

const TOPIC_COLORS = ['#2d5a27', '#1a4d8c', '#7a4d1a', '#5a1a4d', '#1a5a5a', '#4d1a1a', '#3a3a5a'];

function topicColor(topic: ForumTopic): string {
  const idx = Math.abs(Number(topic.iconColor) || 0) % TOPIC_COLORS.length;
  return TOPIC_COLORS[idx];
}

function topicInitial(title: string): string {
  const ch = (title || '').trim().charAt(0);
  return ch ? ch.toUpperCase() : '#';
}

export function TopicsView({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const peer = state.selectedPeer;
  const topics = state.topics;
  if (!peer) return null;

  const onSelect = (topic: ForumTopic) => {
    dispatch({
      type: 'SET_SELECTED_TOPIC',
      topic: { peerKey: `${peer.type}_${peer.id}`, topicId: topic.id, title: topic.title },
    });
  };

  return (
    <div class="tgui-topics">
      <div class="tgui-topics-header">
        <Text variant="title">{t(S.TOPICS_TITLE)}</Text>
      </div>
      {state.topicsLoading && topics.length === 0 ? (
        <div class="tgui-topics-loading"><Spinner size="small" /></div>
      ) : topics.length === 0 ? (
        <div class="tgui-topics-empty"><Text variant="desc">{t(S.TOPICS_EMPTY)}</Text></div>
      ) : (
        <div class="tgui-topics-list">
          {topics.map((topic) => (
            <ListItem
              key={topic.id}
              selected={state.selectedTopic?.topicId === topic.id}
              onClick={() => onSelect(topic)}
              before={
                <Avatar
                  url=""
                  blurUrl=""
                  initial={topicInitial(topic.title)}
                  color={topicColor(topic)}
                  size="medium"
                />
              }
              after={
                topic.unreadCount > 0
                  ? <div class="DialogItem__after"><Badge key={topic.unreadCount} count={topic.unreadCount} variant="pill" /></div>
                  : null
              }
            >
              <span class="Text Text_variant_label">
                <EmojiText
                  text={topic.title}
                  documentUrls={state.documentUrls as Record<string, string>}
                  documentSources={state.documentSources}
                  inlineSize={20}
                  singleLine
                  ctx="dialog"
                />
              </span>
            </ListItem>
          ))}
        </div>
      )}
    </div>
  );
}
