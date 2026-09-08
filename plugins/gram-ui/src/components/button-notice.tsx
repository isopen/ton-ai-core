import { h } from '@ton-ai/atom/jsx-runtime';
import { Toast } from '../primitives/toast.js';

export interface ButtonNoticeRel {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ButtonNoticeData {
  messageId: number | string;
  text: string;
  version: number;
  rel?: ButtonNoticeRel | null;
}

const GAP = 8;

function placementStyle(rel: ButtonNoticeRel): string {
  return `left:${Math.round(rel.x)}px;top:${Math.round(rel.y - GAP)}px;transform:translate(-50%,-100%);width:max-content;max-width:min(90vw,420px)`;
}

export function ButtonNotice({ notice }: { notice: ButtonNoticeData | null }) {
  if (!notice || !notice.rel) return null;
  return (
    <Toast text={notice.text} version={notice.version} className="tgui-btn-notice" style={placementStyle(notice.rel)} />
  );
}
