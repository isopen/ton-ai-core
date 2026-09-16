/**
 * @jest-environment jsdom
 */
import {
  peerKeyOf, findChatWallpaper, wallpaperIdentity, wallpaperUrlKey,
  isPatternWallpaper, wallpaperPhotoDoc, wallpaperThumbType, wallColorToCss, wallpaperSettingsColors,
  wallpaperGradient, wallpaperRotation, wallpaperFlowValue, wallpaperFlowProps,
  wallpaperPatternOpacity, wallpaperIntensityOf, wallpaperRender, wallpaperDownloadPlan,
} from '../dist/utils.js';
import { defaultState, reducer } from '../dist/state.js';

describe('chat wallpaper helpers', () => {
  test('peerKeyOf builds type_id keys', () => {
    expect(peerKeyOf({ type: 'user', id: '7' })).toBe('user_7');
    expect(peerKeyOf({ type: 'chat', id: 3 })).toBe('chat_3');
    expect(peerKeyOf({ type: 'channel', id: '9' })).toBe('channel_9');
    expect(peerKeyOf(null)).toBe('');
    expect(peerKeyOf({})).toBe('');
  });

  test('findChatWallpaper picks last set-wallpaper action', () => {
    expect(findChatWallpaper([])).toBeNull();
    expect(findChatWallpaper([{ id: 1, message: 'hi' }])).toBeNull();
    const w1 = { _: 'wallPaper', id: '1', slug: 'a' };
    const w2 = { _: 'wallPaper', id: '2', slug: 'b' };
    expect(findChatWallpaper([
      { id: 1, action: { _: 'messageActionSetChatWallPaper', wallpaper: w1 } },
      { id: 2, message: 'x' },
      { id: 3, action: { _: 'messageActionSetChatWallPaper', wallpaper: w2 } },
    ])).toBe(w2);
    expect(findChatWallpaper([
      { id: 1, action: { _: 'messageActionGiftPremium' } },
      { id: 2, action: { _: 'messageActionSetChatWallPaper' } },
    ])).toBeNull();
  });

  test('wallpaper identity and url key', () => {
    expect(wallpaperIdentity(null)).toBe('');
    expect(wallpaperIdentity({ id: '5', slug: 's' })).toBe('5|s');
    expect(wallpaperIdentity({ id: '5', slug: 's', settings: {} })).toBe('5|s');
    expect(wallpaperUrlKey('user_7')).toBe('wallpaper-user_7');
  });

  test('wallpaper identity tracks settings changes', () => {
    const base = { id: '5', slug: 's' };
    const colored = { id: '5', slug: 's', settings: { background_color: 0xFF112233 } };
    const reordered = { id: '5', slug: 's', settings: { rotation: 90, background_color: 0xFF112233 } };
    const rotated = { id: '5', slug: 's', settings: { background_color: 0xFF112233, rotation: 90 } };
    expect(wallpaperIdentity(colored)).not.toBe(wallpaperIdentity(base));
    expect(wallpaperIdentity(reordered)).toBe(wallpaperIdentity(rotated));
    expect(wallpaperIdentity(rotated)).not.toBe(wallpaperIdentity(colored));
  });

  test('intensity reader', () => {
    expect(wallpaperIntensityOf({ settings: { intensity: -40 } })).toBe(-40);
    expect(wallpaperIntensityOf({ settings: {} })).toBeNull();
    expect(wallpaperIntensityOf(null)).toBeNull();
  });

  test('thumb type prefers small sizes', () => {
    expect(wallpaperThumbType({ thumbs: [{ type: 'x' }, { type: 'm' }, { type: 's' }] })).toBe('m');
    expect(wallpaperThumbType({ thumbs: [{ type: 'y' }] })).toBe('y');
    expect(wallpaperThumbType({ thumbs: [] })).toBeNull();
    expect(wallpaperThumbType({})).toBeNull();
    expect(wallpaperThumbType(null)).toBeNull();
  });

  test('render photo wallpaper', () => {
    const w = { _: 'wallPaper', id: '1', document: { _: 'document', id: 'd1' } };
    const r = wallpaperRender(w, 'blob:u');
    expect(r.showPattern).toBe(false);
    expect(r.body).toContain('blob:u');
    expect(r.body).toContain('background-size:cover');
  });

  test('render gradient fill without document', () => {
    const w = { _: 'wallPaperNoFile', settings: { background_color: 0xFF112233 } };
    const r = wallpaperRender(w, '');
    expect(r.showPattern).toBe(false);
    expect(r.body).toBe('background:#112233;');
  });

  test('render positive pattern as overlay', () => {
    const w = { _: 'wallPaper', pattern: true, document: { _: 'document', id: 'd1' }, settings: { background_color: 0xFF112233, intensity: 60 } };
    const r = wallpaperRender(w, 'blob:p');
    expect(r.showPattern).toBe(true);
    expect(r.body).toBe('background:#112233;');
    expect(r.pattern).toContain('background-image:url("blob:p")');
    expect(r.pattern).toContain('opacity:0.6');
    expect(r.pattern.includes('mask-image')).toBe(false);
  });

  test('render negative pattern as masked gradient over dark base', () => {
    const w = { _: 'wallPaper', pattern: true, document: { _: 'document', id: 'd1' }, settings: { background_color: 0xFF112233, intensity: -50 } };
    const r = wallpaperRender(w, 'blob:p');
    expect(r.showPattern).toBe(true);
    expect(r.body).toBe('background:#0e1621;');
    expect(r.pattern).toContain('mask-image:url("blob:p")');
    expect(r.pattern).toContain('opacity:0.5');
  });

  test('render empty wallpaper', () => {
    expect(wallpaperRender(null, '')).toEqual({ body: '', pattern: '', showPattern: false });
    expect(wallpaperRender({ _: 'wallPaper' }, '').body).toBe('');
  });

  test('download plan requests on identity change despite stale url', () => {
    const a = { _: 'wallPaper', id: '1', slug: 'a', document: { _: 'document', id: 'd1' } };
    const b = { _: 'wallPaper', id: '2', slug: 'b', document: { _: 'document', id: 'd2' } };
    const seen: Record<string, string> = {};
    expect(wallpaperDownloadPlan(seen, '', a, '')).toEqual({ kind: 'none' });
    expect(wallpaperDownloadPlan(seen, 'k', null, '')).toEqual({ kind: 'none' });
    expect(wallpaperDownloadPlan(seen, 'k', a, '')).toEqual({ kind: 'request' });
    expect(wallpaperDownloadPlan(seen, 'k', a, 'blob:u')).toEqual({ kind: 'none' });
    expect(wallpaperDownloadPlan(seen, 'k', b, 'blob:u')).toEqual({ kind: 'request' });
    expect(wallpaperDownloadPlan(seen, 'k', b, '')).toEqual({ kind: 'request' });
    const g = { _: 'wallPaperNoFile', settings: { background_color: 1 } };
    expect(wallpaperDownloadPlan({}, 'k', g, '')).toEqual({ kind: 'gradient' });
  });

  test('pattern and photo doc detection', () => {
    expect(isPatternWallpaper({ pattern: true })).toBe(true);
    expect(isPatternWallpaper({})).toBe(false);
    expect(isPatternWallpaper(null)).toBe(false);
    const doc = { _: 'document', id: '1' };
    expect(wallpaperPhotoDoc({ document: doc })).toBe(doc);
    expect(wallpaperPhotoDoc({ document: { _: 'documentEmpty' } })).toBeNull();
    expect(wallpaperPhotoDoc({})).toBeNull();
    expect(wallpaperPhotoDoc(null)).toBeNull();
  });

  test('wall colors convert from RGB-24 ints', () => {
    expect(wallColorToCss(0xFF112233)).toBe('#112233');
    expect(wallColorToCss(-1)).toBe('#ffffff');
    expect(wallColorToCss(0xFF000000)).toBe('#000000');
    expect(wallColorToCss(0x80112233)).toBe('#112233');
    expect(wallColorToCss(14409147)).toBe('#dbddbb');
    expect(wallColorToCss('red')).toBe('');
    expect(wallColorToCss(NaN)).toBe('');
    expect(wallColorToCss(null)).toBe('');
  });

  test('settings colors stop at first missing', () => {
    expect(wallpaperSettingsColors(null)).toEqual([]);
    expect(wallpaperSettingsColors({})).toEqual([]);
    expect(wallpaperSettingsColors({ settings: { background_color: 0xFF112233, second_background_color: 0xFF445566 } }))
      .toEqual(['#112233', '#445566']);
    expect(wallpaperSettingsColors({ settings: { background_color: 0xFF112233 } })).toEqual(['#112233']);
  });

  test('wallpaper gradient from settings', () => {
    expect(wallpaperGradient(null)).toBe('');
    expect(wallpaperGradient({ settings: { background_color: 0xFF112233 } })).toBe('#112233');
    expect(wallpaperGradient({ settings: { background_color: 0xFF112233, second_background_color: 0xFF445566 } }))
      .toBe('linear-gradient(135deg,#112233,#445566)');
    expect(wallpaperGradient({ settings: { background_color: 0xFF112233, second_background_color: 0xFF445566, rotation: 90 } }))
      .toBe('linear-gradient(90deg,#112233,#445566)');
  });

  test('wallpaper rotation defaults without finite setting', () => {
    expect(wallpaperRotation(null)).toBe(135);
    expect(wallpaperRotation({})).toBe(135);
    expect(wallpaperRotation({ settings: { rotation: 90 } })).toBe(90);
    expect(wallpaperRotation({ settings: { rotation: NaN } })).toBe(135);
  });

  test('flow value binds the angle to an animatable variable', () => {
    expect(wallpaperFlowValue(null)).toBe('');
    expect(wallpaperFlowValue({ settings: { background_color: 0xFF112233 } })).toBe('#112233');
    expect(wallpaperFlowValue({ settings: { background_color: 0xFF112233, second_background_color: 0xFF445566 } }))
      .toBe('linear-gradient(var(--wall-angle,135deg),#112233,#445566)');
    expect(wallpaperFlowValue({ settings: { background_color: 0xFF112233, second_background_color: 0xFF445566, rotation: 0 } }))
      .toBe('linear-gradient(var(--wall-angle,0deg),#112233,#445566)');
  });

  test('flow props seed the animation without visible jump', () => {
    expect(wallpaperFlowProps(null)).toBe('');
    expect(wallpaperFlowProps({ settings: { background_color: 0xFF112233 } })).toBe('');
    expect(wallpaperFlowProps({ settings: { background_color: 0xFF112233, second_background_color: 0xFF445566 } }))
      .toBe('--wall-from:135deg;--wall-angle:135deg;');
    expect(wallpaperFlowProps({ settings: { background_color: 0xFF112233, second_background_color: 0xFF445566 } }, '72.5deg'))
      .toBe('--wall-from:72.5deg;--wall-angle:72.5deg;');
    expect(wallpaperFlowProps({ settings: { background_color: 0xFF112233, second_background_color: 0xFF445566 } }, 'junk'))
      .toBe('--wall-from:135deg;--wall-angle:135deg;');
  });

  test('rendered gradient carries flow props for the animation', () => {
    const w = { _: 'wallPaperNoFile', settings: { background_color: 0xFF112233, second_background_color: 0xFF445566 } };
    const r = wallpaperRender(w, '');
    expect(r.body).toContain('var(--wall-angle,135deg)');
    expect(r.body).toContain('--wall-from:135deg');
  });

  test('pattern opacity from intensity', () => {
    expect(wallpaperPatternOpacity({ settings: { intensity: 75 } })).toBe(0.75);
    expect(wallpaperPatternOpacity({ settings: { intensity: 200 } })).toBe(1);
    expect(wallpaperPatternOpacity({ settings: { intensity: -50 } })).toBe(0.5);
    expect(wallpaperPatternOpacity({})).toBe(0.4);
    expect(wallpaperPatternOpacity(null)).toBe(0.4);
  });
});

describe('peer wallpaper state', () => {
  test('default state carries empty map', () => {
    expect(defaultState().peerWallpapers).toEqual({});
    expect(defaultState().accountWallpapers).toBeNull();
  });

  test('SET_PEER_WALLPAPER sets and clears', () => {
    const w = { _: 'wallPaper', id: '9', slug: 's9' };
    const s1 = reducer(defaultState(), { type: 'SET_PEER_WALLPAPER', peerKey: 'user_7', wallpaper: w } as any);
    expect(s1.peerWallpapers['user_7']).toBe(w);
    const s2 = reducer(s1, { type: 'SET_PEER_WALLPAPER', peerKey: 'user_7', wallpaper: w } as any);
    expect(s2).toBe(s1);
    const s3 = reducer(s1, { type: 'SET_PEER_WALLPAPER', peerKey: 'user_7', wallpaper: null } as any);
    expect('user_7' in s3.peerWallpapers).toBe(false);
    const s4 = reducer(s3, { type: 'SET_PEER_WALLPAPER', peerKey: 'user_7', wallpaper: null } as any);
    expect(s4).toBe(s3);
    const s5 = reducer(s3, { type: 'SET_PEER_WALLPAPER', peerKey: '', wallpaper: w } as any);
    expect(s5).toBe(s3);
  });

  test('SET_ACCOUNT_WALLPAPERS sets once and ignores same refs', () => {
    const a = { _: 'wallPaper', id: '1' };
    const b = { _: 'wallPaperNoFile', id: '2' };
    const s1 = reducer(defaultState(), { type: 'SET_ACCOUNT_WALLPAPERS', wallpapers: [a, b] } as any);
    expect(s1.accountWallpapers).toEqual([a, b]);
    const s2 = reducer(s1, { type: 'SET_ACCOUNT_WALLPAPERS', wallpapers: [a, b] } as any);
    expect(s2).toBe(s1);
    const s3 = reducer(s1, { type: 'SET_ACCOUNT_WALLPAPERS', wallpapers: [a] } as any);
    expect(s3.accountWallpapers).toEqual([a]);
  });

  test('SET_DEFAULT_WALLPAPER sets, replaces and clears', () => {
    expect(defaultState().defaultWallpaper).toBeNull();
    const w = { _: 'wallPaperNoFile', id: '2' };
    const s1 = reducer(defaultState(), { type: 'SET_DEFAULT_WALLPAPER', wallpaper: w } as any);
    expect(s1.defaultWallpaper).toBe(w);
    const s2 = reducer(s1, { type: 'SET_DEFAULT_WALLPAPER', wallpaper: w } as any);
    expect(s2).toBe(s1);
    const s3 = reducer(s1, { type: 'SET_DEFAULT_WALLPAPER', wallpaper: null } as any);
    expect(s3.defaultWallpaper).toBeNull();
  });
});
