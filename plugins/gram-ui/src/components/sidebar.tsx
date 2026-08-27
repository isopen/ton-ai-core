import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useCallback, useRef } from '@ton-ai/atom/hooks';
import { CustomScrollbar } from '../primitives/custom-scrollbar.js';
import { Spinner } from '../primitives/spinner.js';
import { DialogItem } from './dialog-item.js';
import { ConnectionIndicator } from './connection-indicator.js';
import { ActionMenu } from './action-menu.js';
import { ensureEmojiStickers } from './emoji-store.js';
import type { AppState } from '../types.js';
import type { Dispatch } from '../state.js';

export function Sidebar({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const collapsed = state.sidebarCollapsed;

  useEffect(() => {
    ensureEmojiStickers();
  }, []);

  const onBackdropClick = useCallback(() => dispatch({ type: 'SET_SIDEBAR_COLLAPSED', v: true }), [dispatch]);

  const clickCache = useRef(new Map<string, () => void>());
  const getDialogClick = (peer: AppState['dialogs'][number]['peer']) => {
    const key = `${peer.type}_${peer.id}`;
    let fn = clickCache.current.get(key);
    if (!fn) {
      fn = () => {
        dispatch({ type: 'SET_ACTIVE_SKILL', id: null });
        dispatch({ type: 'SET_SELECTED_PEER', peer });
        if (window.innerWidth <= 768) dispatch({ type: 'SET_SIDEBAR_COLLAPSED', v: true });
      };
      clickCache.current.set(key, fn);
    }
    return fn;
  };

  return (
    <>
      <div class={`tgui-sidebar-backdrop${collapsed ? '' : ' tgui-sidebar-backdrop--visible'}`}
        onClick={onBackdropClick}
      />
      <div class={`tgui-sidebar ${collapsed ? 'tgui-sidebar-collapsed' : 'tgui-sidebar-expanded'}`}>
        <div class={`tgui-sidebar-header ${collapsed ? 'tgui-sidebar-header-collapsed' : 'tgui-sidebar-header-expanded'}`}>
          {!collapsed ? <ConnectionIndicator status={state.connectionStatus} /> : null}
          <div class="tgui-sidebar-header-actions">
            <ActionMenu state={state} dispatch={dispatch} />
          </div>
        </div>
        <CustomScrollbar className="tgui-sidebar-list">
          {state.dialogs.length === 0
            ? <div class="tgui-sidebar-loader"><Spinner /></div>
            : state.dialogs.length > 0
              ? state.dialogs.map(d => (
                <DialogItem
                  d={d}
                  selected={state.selectedPeer?.id === d.peer.id && state.selectedPeer?.type === d.peer.type}
                  collapsed={collapsed}
                  key={`${d.peer.type}_${d.peer.id}`}
                  typingText={state.selectedPeer?.id === d.peer.id && state.selectedPeer?.type === d.peer.type ? '' : (state.typingByPeer[`${d.peer.type}_${d.peer.id}`] || '')}
                  selfUserId={state.selfUserId}
                  onClick={getDialogClick(d.peer)}
                />
              ))
              : null
          }

        </CustomScrollbar>
      </div>
    </>
  );
}
