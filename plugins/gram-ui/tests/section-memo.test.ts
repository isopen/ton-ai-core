/**
 * @jest-environment jsdom
 */

import { render } from '@ton-ai/atom/render';
import { useState } from '@ton-ai/atom/hooks';
import { Header } from '../src/components/header.js';
import type { ComponentType } from '@ton-ai/atom';

function baseState(): any {
  return {
    theme: 'light',
    page: 'dialogs',
    authStep: 'phone',
    phone: '',
    code: '',
    password: '',
    error: '',
    errorVersion: 0,
    sessionId: '',
    dialogs: [],
    selectedPeer: null,
    messages: [],
    log: [],
    sidebarCollapsed: false,
    showEmojiPicker: false,
    typingText: '',
    typingByPeer: {},
    renderTick: 0,
    imageQuality: 'max',
    animationsEnabled: true,
    loadingMessages: false,
    connectionStatus: 'connected',
    langCode: 'en',
    countries: [],
    countryIso2: '',
    signupFirstname: '',
    signupLastname: '',
    qrToken: '',
    phoneCodeHash: '',
    selfUserId: '',
    pluginSkills: [],
    activeSkill: null,
    langOptions: [],
    documentUrls: {},
    documentProgress: {},
    photoSources: {},
    documentSources: {},
    avatarSources: {},
    reactions: {},
  };
}

describe('section memo', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('Header ignores unrelated slices, updates on theme change', async () => {
    const Root: ComponentType = () => {
      const [s, setS] = useState(baseState());
      (Root as any).setS = setS;
      return Header({ state: s, dispatch: (() => {}) as any });
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(Root as any, container);
    const before = container.innerHTML;
    expect(container.querySelector('.tgui-header')).not.toBeNull();
    (Root as any).setS((prev: any) => ({ ...prev, messages: [{ id: 1 }], typingText: 'x' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.innerHTML).toBe(before);
    (Root as any).setS((prev: any) => ({ ...prev, theme: 'dark' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector('.tgui-header')).not.toBeNull();
  });
});
