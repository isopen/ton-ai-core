import { createContext, useContext } from '@ton-ai/atom/context';
import type { PeerInfo } from './types.js';
import type { Dispatch } from './state.js';

export interface AppContextValue {
  theme: 'light' | 'dark';
  imageQuality: 'min' | 'medium' | 'max';
  animationsEnabled: boolean;
  selfUserId: string;
  selectedPeer: PeerInfo | null;
  activeSkill: string | null;
  pluginSkills: Array<{ id: string; label: string }>;
  langCode: string;
  dispatch: Dispatch;
}

export const AppContext = createContext<AppContextValue>({
  theme: 'light',
  imageQuality: 'max',
  animationsEnabled: true,
  selfUserId: '',
  selectedPeer: null,
  activeSkill: null,
  pluginSkills: [],
  langCode: 'en',
  dispatch: () => {},
});

export function useApp(): AppContextValue {
  return useContext(AppContext);
}
