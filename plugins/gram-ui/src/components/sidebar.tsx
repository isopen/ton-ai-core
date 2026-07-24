import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { Scrollable } from '../primitives/scrollable.js';
import { IconButton } from '../primitives/icon-button.js';
import { Spinner } from '../primitives/spinner.js';
import { DialogItem } from './dialog-item.js';
import { ConnectionIndicator } from './connection-indicator.js';
import { ActionMenu } from './action-menu.js';
import type { AppState } from '../types.js';
import type { Dispatch } from '../state.js';

export function Sidebar({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const collapsed = state.sidebarCollapsed;

  return (
    <>
      <div class={`tgui-sidebar-backdrop${collapsed ? '' : ' tgui-sidebar-backdrop--visible'}`}
        onClick={() => dispatch({ type: 'SET_SIDEBAR_COLLAPSED', v: true })}
      />
      <div class={`tgui-sidebar ${collapsed ? 'tgui-sidebar-collapsed' : 'tgui-sidebar-expanded'}`}>
        <div class={`tgui-sidebar-header ${collapsed ? 'tgui-sidebar-header-collapsed' : 'tgui-sidebar-header-expanded'}`}>
          {!collapsed ? <ConnectionIndicator status={state.connectionStatus} /> : null}
          <div class="tgui-sidebar-header-actions">
            <ActionMenu state={state} dispatch={dispatch} />
            <IconButton onClick={() => dispatch({ type: 'SET_SIDEBAR_COLLAPSED', v: !collapsed })}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" class={`tgui-sidebar-toggle-icon${collapsed ? ' tgui-sidebar-toggle-icon-collapsed' : ''}`}>
                <path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </IconButton>
          </div>
        </div>
        <Scrollable className="tgui-sidebar-list">
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
                  onClick={() => {
                    dispatch({ type: 'SET_ACTIVE_SKILL', id: null });
                    dispatch({ type: 'SET_SELECTED_PEER', peer: d.peer });
                    if (window.innerWidth <= 768) dispatch({ type: 'SET_SIDEBAR_COLLAPSED', v: true });
                  }}
                />
              ))
              : null
          }

        </Scrollable>
      </div>
    </>
  );
}
