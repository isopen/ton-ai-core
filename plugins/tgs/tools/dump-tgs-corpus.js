/* Dev tool: tgs corpus dumper (lives in plugins/tgs/tools, but RUNS IN A BROWSER):
 * open a logged-in gram-browser dev build (http://localhost:8080, secure context is
 * required for showDirectoryPicker), paste this file's content into DevTools console
 * and press Enter.
 * Usage:
 *   1. Open the app (local dev build, e.g. http://localhost:8080).
 *   2. DevTools console: paste this file's content (or load it) and press Enter.
 *   3. Grant folder access in the picker dialog (Chrome/Edge, secure context).
 *   4. Files land as <chosen-folder>/<set-short-name>/<docId>.tgs + manifest.jsonl in the folder root.
 *   5. Stop: set window.__corpusAbort = true. Re-run to resume (existing files are skipped).
 *
 * Default scope: exactly the 347 sticker sets from the tlottie benchmark
 * https://dkaraush.github.io/tlottie/benchmarks/android-fold.html (64/320/720px tables,
 * the "720px effects" table is a subset). No catalog search is performed.
 *
 * Tuning: window.__CORPUS_CFG = { setConc: 3, setDelay: 200 } before pasting.
 *   all: true    — old behaviour: discover sets via catalog search + grow rounds
 *   packs: [...] — explicit short_name list instead of the benchmark list;
 *                  an entry may also be { short_name, input } to use a special
 *                  InputStickerSet constructor, or { short_name, effects: true }
 *                  to download messages.getAvailableEffects documents
 *   target: N    — cap on downloaded files (default 0 = no cap)
 *   missingOnly: true — pre-scan the picked folder, then process only the sets that
 *                  still contain 0-byte/tiny .tgs files (re-download/resume pass)
 * Re-download pass: plain re-run already re-fetches every file with size <= 64 bytes;
 *   a file that stays empty after two attempts is reported as "doc fail" (gone/invalid).
 *   FLOOD_WAIT on a set fetch or a document download is retried CFG.floodRetries times
 *   after the advertised wait, so a throttled set is not silently dropped from the pass.
 *
 * The benchmark's "message_effects" pack has no public short name: fetch it with
 *   window.__CORPUS_CFG = { packs: [{ short_name: 'message_effects', effects: true }] }
 *   (or input: { _: 'inputStickerSetAnimatedEmojiAnimations' } for the reaction set).
 *
 * "AbortError: Blocked by Safe Browsing." — Chrome's File System Access after-write
 *   check rejects the close() of the writable stream; the download itself succeeded and
 *   the target file stays 0 bytes. CFG.sbFallback ('auto' by default) probes a .part
 *   write once per run and, when that one is allowed, saves the blocked payload as
 *   <id>.tgs.part (an existing *.part file is skipped on re-runs). Rename them:
 *     find <dir> -name '*.tgs.part' -exec sh -c 'mv "$1" "${1%.part}"' _ {} \;
 *   Disabling Safe Browsing in the browser settings removes the abort completely.
 *   CFG.probe: true — only run the write probe (5 file names) and exit.
 *
 * RPC usage: window.__gramMediaRouter.transport.callRpc — same session as the UI.
 *   sets discovery: messages.getAllStickers / getFeaturedStickers / searchStickerSets / searchEmojiStickerSets
 *   set content:    router.fetchStickerSet (cached by hash, we pass hash 0)
 *   file download:  router.downloadDocumentNow(doc)
 */
(function () {
  'use strict';
  if (window.__corpusRunning) { console.warn('[corpus] already running — to stop set window.__corpusAbort = true'); return; }
  window.__corpusRunning = true;
  window.__corpusAbort = false;
  const CLEANUP = () => { try { delete window.__corpusRunning; } catch { window.__corpusRunning = false; } };

  const CFG = Object.assign({
    all: false,      // false = only BENCH_PACKS; true = full catalog discovery (old behaviour)
    packs: null,     // explicit short_name list override
    target: 0,       // cap on downloaded files (0 = no cap)
    setConc: 3,      // parallel set fetch + download pipelines
    qDelay: 250,     // delay between catalog RPC calls
    setDelay: 200,   // delay between set processing
    extended: false, // after basic list, also scan aa..zz combos and emoji queries
    altCap: 300,     // new search queries per round, harvested from downloaded sticker names
    maxRounds: 4,    // extra catalog rounds (discover sets via alt names, then download)
    missingOnly: false, // scan the picked folder and re-download only sets with empty/tiny files
    floodRetries: 4, // extra attempts for a set fetch or document download after FLOOD_WAIT
    probe: false,    // only run the write-permission probe, then exit
    sbFallback: 'auto', // 'auto' = probe .part once on the first Safe Browsing abort, 'on'/'off' = force
    sbExt: '.part'   // suffix used for payloads that the after-write check refuses
  }, window.__CORPUS_CFG || {});

  // Sticker sets rendered by the tlottie android-fold benchmark
  // (https://dkaraush.github.io/tlottie/benchmarks/android-fold.html), 347 packs.
  const BENCH_PACKS = [
    'ABCEmoji', 'AlienEmoji', 'AmanitaPhalloides', 'AngryCrow', 'AnimalIcons', 'AnimatedAsianEmoji',
    'Ant_Eater', 'ApplicationEmoji', 'ArcticFox', 'AsianBunny', 'BT21_BTS', 'BabyYoda',
    'BadBadDog', 'BadCupid', 'BalloonyEmoji', 'Banana', 'BananaAnimated', 'BananaFun',
    'Baphometh', 'Batoshik', 'BearEmoji', 'BeefyEagle', 'BettPage', 'BirdOfParadise',
    'BirthdayCollection', 'BloodyFontEmoji', 'BobJellyfish', 'BonyFontEmoji', 'Borzoi', 'BoysClub',
    'BubbleEmoji', 'BuckyBecky', 'Buddy_Bear', 'BumbIebee', 'Butterfly', 'CactusAndBalloon',
    'CandyFontEmoji', 'CaptainWhale', 'Cat2O', 'CatCatCat', 'CatInHat', 'CatPawsEmoji',
    'CatSkull', 'Catz5Emoji', 'ChappyBunny', 'ChibiChan', 'Chick', 'ChicklingEmoji',
    'ChineseDragon', 'ChkChrk', 'ChristmasDogs', 'ChristmasEmoji', 'ChristmasTiger', 'CloudiaSheep',
    'ColoredCats', 'ColorfulFontEmoji', 'ColorfulJelly', 'ColorfulMessages', 'ConcernedFroge', 'CookieAndMilky',
    'Cowboy', 'CrayonsEmoji', 'CrazyFlower', 'CreepyEmoji', 'Crocosaurus', 'Cucaracha',
    'CupidKitty', 'CuteNurse', 'CutePumpkinEmoji', 'CutieMadeline', 'Cyclops', 'CyrillicFont',
    'DMJEmojiPremium', 'DeadlyPack', 'DeathNote', 'DebraZebra', 'Developer', 'DevilessEmoji',
    'DinDino', 'DisgruntledToad', 'DogeEmoji', 'DogsEmoji', 'DolphinDolph', 'DolphinJumpy',
    'DonutTheDog', 'DuckEmoji', 'EffectEmoji', 'EggYolk', 'EmojiStatus', 'EmoticonEmoji',
    'FaceEmoji', 'FangBat', 'FatKing', 'FestiveFlags', 'FestiveFontEmoji', 'FinanceEmoji',
    'FireFontEmoji', 'FishPrometheus', 'FishPuffer', 'FlagsEmojis', 'Flame', 'FlameEmoji',
    'FlowersFontEmoji', 'FluffyLoafer', 'FoxEmoji', 'FoxyComrade', 'FrankensteinMonster', 'FreakyPigeon',
    'FroggoInLove', 'Fromg', 'FunkyGoose', 'Funny_Pumpkins', 'Gadgets', 'GameEmoji',
    'GameIcons', 'GamerGirL', 'GhostEmoji', 'GhostHamster', 'Gillman', 'GingerbreadEmoji',
    'GlowingFont', 'Godzi', 'GreenBun', 'GreenLezard', 'GrinchDog', 'GumLoveIs',
    'GummyBearEmoji', 'HDKolobok', 'HalloUtya', 'HalloweenTeamEmoji', 'HandDrawnEmoji', 'HandEmoji',
    'Hands4Friends', 'HaoPup', 'HarryGorilla', 'HeartBalloons', 'HeartyHearts', 'HeavensLamby',
    'Hedgehog', 'Hedgehoge', 'HighFox', 'Hohoho', 'HomeElectronics', 'HoneyBadgerrr',
    'HotCherry', 'HumanOrgans', 'HuskySiberian', 'IceMan', 'InvaderZim', 'JapaneseShiba',
    'JayAndNana', 'JellyEmojis', 'JessicaRabbit', 'JingleBellElf', 'JinxPowder', 'JoBrownBear',
    'Joker', 'JollySanta', 'JudyAlvarez', 'JustElmo', 'KangarooFighter', 'KawaiiEmoji',
    'KoalaBear', 'Kozita', 'LadyCat', 'LadyVampire', 'Ladybug', 'Lamplover',
    'LedScreenEmoji', 'LeopoldTheLion', 'LifeCorgi', 'LightningBug', 'LilCifer', 'LilPuppy',
    'LiveFlowers', 'Lizard', 'LongGoose', 'LoveBirds', 'LoveDayEmoji', 'LoveHamsters',
    'LoveStory', 'LovelyPeachy', 'Lychee', 'MadEmoji', 'MadEmoji2', 'MagicMandrake',
    'Mamkin_Pumpkin', 'MashupEmoji', 'MasksEmoji', 'MatrixFont', 'Meeseeks', 'MemeEmoji',
    'MemePumpkinsEmoji', 'Memes', 'MemesWithCats', 'MeowEmoji', 'MerryChristmasEmoji', 'MiaBunny',
    'MickeyMouseEmoji', 'Miss_Bunny', 'MisterPigeon', 'Mistress', 'ModernDinosaur', 'MonkeyPuppet',
    'MoonEmoji', 'MrAss', 'MrCat', 'MrCaterpillar', 'MrCroco', 'MrGreene',
    'MrLittlePrince', 'MrMandarine', 'MrPanda', 'MrPugDog', 'MrSeagull', 'MrSeal',
    'Muffin', 'MummyJackal', 'MuscleDoge', 'Mushroom', 'MyLittleDevil', 'NekoBell',
    'NekoWaifu', 'NeonEmoji', 'NeverOld', 'NewYearTiger', 'NewsEmoji', 'NickWallowPig',
    'NinnyEmoji', 'NyaChan', 'Orangoutang', 'OutlineEmoji', 'OwledDidi', 'ParisOlympicEmoji',
    'Peepo_Pepe', 'Penguinissimo', 'PennantEmoji', 'PepeEmoji', 'PeriodicTable', 'PigeonEmoji',
    'PigeonGulya', 'PinkMarshmallow', 'PixelPigeonEmoji', 'PoolFlamingo', 'PremiumGifts', 'Pretty2Friends',
    'PumpkinCube', 'PumpkinEmoji', 'PumpkinGhost', 'Qwabbit', 'RabbitEmoji', 'RaccoonyDays',
    'RansomNote', 'ReaperSkullEmoji', 'RedFox', 'RedShibaInu', 'Red_Squirrel', 'RestrictedEmoji',
    'RetroEmoji', 'RetroFontEmoji', 'RetroYearEmoji', 'RickyPenguin', 'RobinBird', 'RoboEmoji',
    'RollingEmoji', 'Rooster', 'Rrredpanda', 'SalchichaDog', 'SantaEmoji', 'SantaGirlHNY',
    'Scream', 'SemenEmoji', 'ShibaInuEmoji', 'ShinobiAssassin', 'Skull', 'SkullEmoji',
    'SliceofPizza', 'SlimeFontEmoji', 'Slimer', 'Snailhare', 'SnappyCrab', 'SneakerChuck',
    'SnowballBoy', 'Snowflake', 'SocialEmojis', 'Spaceman', 'SparklesEmoji', 'SpeedyElf',
    'SpookyLetters', 'SpottyGiraffe', 'StarEmoji', 'StaticEmoji', 'StealthMoon', 'SteampunkJulia',
    'StinkyLove', 'SummerEmoji', 'SunAndCloud', 'SunEmoji', 'SuperStar', 'SushiCat',
    'SweetCarrot', 'SweetyStrawberry', 'TONEmoji', 'TableFontEmoji', 'Tapir', 'TattooEmoji',
    'TeddyBear', 'TenYearsOfTelegram', 'TendyTiger', 'ThatIsWhatSheSaid', 'TheFrenchie', 'TheRing',
    'TheThingEmoji', 'TibetanFox', 'TidyTieTom', 'ToiletPaperBoy', 'Tomby', 'TopicIcons',
    'ToxicEmojiBYDezzy', 'TrickyFox', 'Turtle', 'TutterMouse', 'TwisterDog', 'UnicornEmoji',
    'UtyaD', 'UtyaDuck', 'ValentineCat', 'VeryTiredPerson', 'WallyOwl', 'WhiteRhino',
    'WhiteWind', 'WolfAlpha', 'Woodpecker', 'WorldArt', 'YellowBoy', 'YetiHolidays',
    'YokoChan', 'ZombieFontEmoji', 'coolguy', 'knightbraveheart', 'message_effects', 'prtyparrot',
    'r2dog2', 'shortanimations', 'tgmacicons', 'theopenemojis', 'wizard'
  ];
  const packList = Array.isArray(CFG.packs) && CFG.packs.length
    ? CFG.packs.slice()
    : (CFG.all ? null : BENCH_PACKS);
  const fileCap = Number(CFG.target) > 0 ? Number(CFG.target) : Infinity;

  const LOG = (...a) => console.log('[corpus]', ...a);
  const pending = (...a) => console.warn('[corpus]', ...a);

  const router = window.__gramMediaRouter;
  if (!router || !router.transport) { pending('window.__gramMediaRouter not ready — open the app first'); CLEANUP(); return; }
  const call = async (m, p) => { try { return await router.transport.callRpc(m, p); } catch (e) { e.__method = m; throw e; } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const normName = (s) => String(s || '').replace(/[^\w\-а-яА-ЯёЁ]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'set';
  const docAttrs = (doc) => {
    const out = {};
    for (const a of doc.attributes || []) {
      if (a._ === 'documentAttributeVideo') { out.w = a.w; out.h = a.h; out.dur = a.duration; }
      if (a._ === 'documentAttributeSticker') { out.sticker = a.alt; }
    }
    out.size = doc.size; out.mime = doc.mime_type;
    return out;
  };

  // ---------------------------------------------------------------- folder access
  const pickFolder = () => new Promise((resolve) => {
    const fallback = () => {
      const ov = document.createElement('div');
      ov.textContent = '[corpus] click to grant folder access';
      ov.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(17,20,24,.86);color:#fff;display:flex;align-items:center;justify-content:center;font:14px/1.4 sans-serif;cursor:pointer';
      ov.addEventListener('click', () => {
        window.showDirectoryPicker({ mode: 'readwrite', id: 'tgs-corpus' })
          .then((h) => { ov.remove(); resolve(h); })
          .catch((e) => { ov.remove(); LOG('folder pick cancelled'); CLEANUP(); resolve(null); });
      });
      document.body.appendChild(ov);
    };
    if (!window.showDirectoryPicker) { pending('showDirectoryPicker unavailable (need Chromium + secure origin)'); CLEANUP(); resolve(null); return; }
    window.showDirectoryPicker({ mode: 'readwrite', id: 'tgs-corpus' })
      .then(resolve)
      .catch(() => fallback());
  });

  // scan the picked folder: set folders that still contain empty/truncated .tgs files
  const scanEmpty = async (dir) => {
    const found = new Map();
    try {
      for await (const [name, h] of dir.entries()) {
        if (!h || h.kind !== 'directory') continue;
        let empty = 0, total = 0;
        for await (const [fn, fh] of h.entries()) {
          if (!fh || fh.kind !== 'file' || !/\.tgs$/i.test(fn)) continue;
          total++;
          const f = await fh.getFile().catch(() => null);
          if (!f || f.size <= 64) empty++;
        }
        if (empty) found.set(name, { empty, total });
      }
    } catch (e) { pending('folder scan failed: ' + (e?.message || e)); }
    return found;
  };

  // ---------------------------------------------------------------- set catalog
  const sets = new Map(); // short_name -> { input, title, count }
  const usedWords = new Set(); // search queries already sent (lowercased)
  const alts = new Set(); // sticker alt names harvested while downloading — seed for grow rounds
  const normWord = (s) => String(s || '').toLowerCase().trim().slice(0, 48);
  const addSet = (obj) => {
    const covered = obj && typeof obj === 'object' && obj.set ? obj.set : obj;
    const st = covered && covered.short_name ? covered : (obj && obj.set && obj.set.short_name ? obj.set : null);
    if (!st || !st.short_name) return;
    if (!sets.has(st.short_name)) {
      sets.set(st.short_name, {
        input: st.input || (obj && obj.input) || { _: 'inputStickerSetShortName', short_name: st.short_name },
        effects: !!(st.effects || (obj && obj.effects)),
        title: st.title || st.short_name,
        count: st.count || 0,
        setId: String(st.id || ''),
        accessHash: String(st.access_hash || '')
      });
    }
  };

  const queriesBasic = () => {
    const words = [
      'cat', 'dog', 'fox', 'bear', 'wolf', 'rabbit', 'bird', 'duck', 'panda', 'frog', 'penguin', 'monkey',
      'anime', 'manga', 'chibi', 'kawaii', 'emoji', 'memes', 'joker', 'batman', 'pepe', 'doge', 'potato',
      'love', 'heart', 'kiss', 'happy', 'sad', 'angry', 'hello', 'hi', 'party', 'music', 'dance', 'work',
      'coffee', 'tea', 'food', 'pizza', 'burger', 'cake', 'fruit', 'space', 'moon', 'star', 'planet',
      'cool', 'fun', 'game', 'gaming', 'catgirl', 'neko', 'art', 'draw', 'pixel', 'winter', 'summer',
      'newyear', 'christmas', 'birthday', 'halloween', 'cute', 'dark', 'neon', 'retro', 'pixelart',
      'кошка', 'собака', 'лис', 'кот', 'медведь', 'волк', 'пингвин', 'панда', 'аниме', 'эмоции', 'эмодзи',
      'мем', 'мемы', 'любовь', 'привет', 'сердце', 'поцелуй', 'грусть', 'радость', 'злость', 'праздник',
      'музыка', 'танцы', 'работа', 'кофе', 'еда', 'пицца', 'торт', 'космос', 'луна', 'звезда', 'зима',
      'лето', 'море', 'новыйгод', 'деньрождения', 'хэллоуин', 'милота', 'неон', 'ретро', 'пиксель'
    ];
    const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
    const ruLetters = 'абвгдеёжзийклмнопрстуфхцчшщэюя'.split('');
    const digits = '0123456789'.split('');
    return [...new Set([...words, ...letters, ...digits, ...ruLetters])];
  };

  const queriesExtended = () => {
    const out = new Set();
    for (const a of 'abcdefghijklmnopqrstuvwxyz') for (const b of 'abcdefghijklmnopqrstuvwxyz') {
      out.add(a + b); out.add(b + a);
    }
    for (const c of 'абвгдеёзийклмнопрстуфхцчшщэюя') out.add(c); // ь/ъ/ы rarely pack titles
    return [...out];
  };

  const EMOJI_SET = ['😀','😂','😍','😎','🤔','😭','😡','🥰','😱','🤯','😇','🤠','👑','🔥','💥','⭐','🌈','🍔','🍕','☕','🎃','🎄','🎁','❤️','💜','💙','💚','🧡','🖤','✨','🎉','🎮','🎵','🐱','🐶','🦊','🐻','🐼','🐧','🐸'];

  // shared by collectCatalog (initial pass) and growRounds (alt-name rounds)
  const runSearch = async (q, emojiMode, probe) => {
    await sleep(CFG.qDelay);
    const method = emojiMode ? 'messages.searchEmojiStickerSets' : 'messages.searchStickerSets';
    usedWords.add(String(q || '').toLowerCase().trim());
    const res = await call(method, { q, hash: 0 });
    if (probe) {
      try {
        console.log('[corpus] probe ' + method + ' q=' + JSON.stringify(q) + ' _=' + res?._ +
          ' keys=' + JSON.stringify(Object.keys(res || {})) +
          (Array.isArray(res?.sets) ? ' sets[0]=' + JSON.stringify(res.sets[0]).slice(0, 260) : '') +
          (Array.isArray(res?.results) ? ' results[0]=' + JSON.stringify(res.results[0]).slice(0, 260) : ''));
      } catch { }
    }
    (res?.sets || res?.results || []).forEach((r) => addSet(r?.set || r));
  };

  async function collectCatalog() {
    const scans = [];
    const pushScan = (label, fn) => scans.push(async () => { try { await fn(); } catch (e) { pending(label + ' failed: ' + (e?.message || e)); } });

    pushScan('getAllStickers', async () => {
      const res = await call('messages.getAllStickers', { hash: 0 });
      console.log('[corpus] probe getAllStickers _=' + res?._ + ' sets=' + (res?.sets?.length ?? 'n/a'));
      (res?.sets || []).forEach(addSet);
    });
    pushScan('getFeaturedStickers', async () => {
      const res = await call('messages.getFeaturedStickers', { hash: 0 });
      console.log('[corpus] probe getFeaturedStickers _=' + res?._ + ' sets=' + (res?.sets?.length ?? 'n/a'));
      (res?.sets || []).forEach(addSet);
    });
    await Promise.all(scans.map((fn) => fn()));

    // sequential (Telegram-friendly), with generic flood/sleep retry
    const queries = [...queriesBasic()];
    if (CFG.extended) queries.push(...queriesExtended());
    let n = 0;
    for (const q of queries) {
      if (window.__corpusAbort) break;
      try { await runSearch(q, false, n === 0 || n === 1); } catch (e) { await floodSleep(e); }
      if ((++n % 25) === 0) LOG('search ' + n + '/' + queries.length + ', sets=' + sets.size);
    }
    for (const q of EMOJI_SET) {
      if (window.__corpusAbort) break;
      try { await runSearch(q, true); } catch (e) { await floodSleep(e); }
    }
    LOG('catalog collected: ' + sets.size + ' unique sets');
    if (sets.size === 0) {
      pending('0 sets found — check the two "[corpus] probe" lines above: the response shape from callRpc does not match set/results parsing; paste them to the developer.');
    }
  }

  async function floodSleep(e) {
    const msg = String(e?.message || e);
    const m = /FLOOD_WAIT\D*(\d+)/i.exec(msg);
    const wait = m ? (parseInt(m[1], 10) + 1) : 4;
    pending('flood/rpc slow: ' + msg.slice(0, 120) + ' -> wait ' + wait + 's');
    await sleep(wait * 1000);
  }

  // ---------------------------------------------------------------- download loop
  const manifestLines = [];
  const stats = { setsOk: 0, setsEmpty: 0, setsFail: 0, redl: 0, stuck: 0, part: 0, flood: 0 };
  let sbMode = CFG.sbFallback === true ? 'on' : (CFG.sbFallback === false ? 'off' : 'auto');
  const writeFile = async (dir, name, bytes) => {
    let step = 'handle';
    let w = null;
    try {
      const fh = await dir.getFileHandle(name, { create: true });
      step = 'open';
      w = await fh.createWritable();
      step = 'write';
      await w.write(bytes);
      step = 'close';
      await w.close();
      w = null;
    } catch (e) {
      e.__step = step;
      if (w) { try { await w.abort(); } catch { } }
      throw e;
    }
  };
  const probePart = async (dir) => {
    const name = '_probe' + CFG.sbExt;
    try {
      await writeFile(dir, name, new TextEncoder().encode('probe'));
      try { await dir.removeEntry(name); } catch { }
      return true;
    } catch { return false; }
  };
  let sbProbe = null;
  const resolveSbMode = async (dir) => {
    if (sbMode !== 'auto') return sbMode;
    if (!sbProbe) {
      sbProbe = probePart(dir).then((ok) => {
        sbMode = ok ? 'on' : 'off';
        LOG('safe browsing fallback: ' + sbMode + (ok ? ' (saves blocked files as *' + CFG.sbExt + ')' : ''));
        return sbMode;
      });
    }
    return sbProbe;
  };
  const runProbe = async (dir) => {
    const payload = new TextEncoder().encode('probe');
    const names = ['_probe.tgs', '_probe.tgs' + CFG.sbExt, '_probe.bin', '_probe.txt', '_probe'];
    const out = [];
    for (const name of names) {
      try {
        await writeFile(dir, name, payload);
        out.push(name + '=ok');
        LOG('probe ok ' + name);
      } catch (e) {
        out.push(name + '=fail');
        pending('probe fail ' + name + ' step=' + e.__step + ' name=' + (e?.name || '?') + ' msg=' + String(e?.message || e).slice(0, 100));
      }
      try { await dir.removeEntry(name); } catch { }
    }
    return out;
  };
  const flushManifest = async (dir) => {
    try {
      const fh = await dir.getFileHandle('manifest.jsonl', { create: true });
      const w = await fh.createWritable();
      await w.write(new TextEncoder().encode(manifestLines.join('\n') + '\n'));
      await w.close();
    } catch (e) { pending('manifest write failed: ' + (e?.message || e)); }
  };

  const fetchAvailableEffects = async () => {
    const res = await call('messages.getAvailableEffects', { hash: 0 });
    const byId = new Map((res?.documents || []).map((d) => [String(d.id), d]));
    const docs = [];
    const seen = new Set();
    for (const e of res?.effects || []) {
      for (const id of [e.effect_sticker_id, e.effect_animation_id]) {
        const k = String(id ?? '');
        if (!k || k === '0' || seen.has(k)) continue;
        seen.add(k);
        const d = byId.get(k);
        if (d) docs.push(d);
      }
    }
    LOG('effects: ' + (res?.effects?.length || 0) + ' effects, ' + docs.length + ' unique documents');
    return { documents: docs };
  };

  async function fetchAndSaveSet(slug, info, dir, savedRef) {
    if (savedRef.v >= fileCap) return;
    const setName = normName(slug);
    let res;
    if (info.effects) {
      for (let attempt = 0; ; attempt++) {
        try { res = await fetchAvailableEffects(); break; }
        catch (e) {
          const msg = String(e?.message || e);
          if (/FLOOD_WAIT/i.test(msg) && attempt < CFG.floodRetries) { stats.flood++; await floodSleep(e); continue; }
          stats.setsFail++;
          pending('set fail ' + slug + ': ' + msg.slice(0, 120));
          return;
        }
      }
    } else {
      for (let attempt = 0; ; attempt++) {
        try { res = await router.fetchStickerSet(slug, info.input); break; }
        catch (e) {
          const msg = String(e?.message || e);
          if (/FLOOD_WAIT/i.test(msg) && attempt < CFG.floodRetries) { stats.flood++; await floodSleep(e); continue; }
          stats.setsFail++;
          pending('set fail ' + slug + ': ' + msg.slice(0, 120));
          return;
        }
      }
    }
    const all = res?.documents || [];
    const docs = all.filter((d) => d && d.mime_type === 'application/x-tgsticker' && d.id != null);
    if (!docs.length) {
      stats.setsEmpty++;
      const mimes = {};
      for (const d of all) mimes[d?.mime_type || '?'] = (mimes[d?.mime_type || '?'] || 0) + 1;
      pending('set empty ' + slug + ': docs=' + all.length + ' ' + JSON.stringify(mimes).slice(0, 160));
      return;
    }
    stats.setsOk++;
    // harvest sticker alt names — they seed discovery rounds after the basic pass
    for (const d of docs) {
      const a = (d.attributes || []).find((x) => x._ === 'documentAttributeSticker');
      const s = a && a.alt && String(a.alt).toLowerCase().trim();
      if (s && s.length >= 2 && s.length <= 40) alts.add(s);
    }
    if (savedRef.v + docs.length > fileCap) docs.length = Math.max(0, fileCap - savedRef.v);
    docLoop: for (const doc of docs) {
      if (window.__corpusAbort || savedRef.v >= fileCap) break docLoop;
      const fdir = await dir.getDirectoryHandle(setName, { create: true });
      const fname = String(doc.id) + '.tgs';
      // resume: an existing file with real content is counted as done (no re-download);
      // tiny/truncated leftovers (<64 bytes) are re-downloaded and overwritten
      const probe = await fdir.getFileHandle(fname, { create: false }).then((fh) => fh.getFile()).catch(() => null);
      if (probe && probe.size > 64) { savedRef.v++; continue; }
      const partProbe = await fdir.getFileHandle(fname + CFG.sbExt, { create: false }).then((fh) => fh.getFile()).catch(() => null);
      if (partProbe && partProbe.size > 64) { savedRef.v++; stats.part++; continue; }
      if (probe) stats.redl++;
      let downloaded = false;
      let part = false;
      let bytes = null;
      let tries = 0;
      let floods = 0;
      let lastErr = null;
      while (!downloaded && tries < 2) {
        try {
          if (!bytes) {
            const dl = await router.downloadDocumentNow(doc);
            if (!dl || !dl.bytes || !dl.bytes.byteLength) throw new Error('empty download');
            bytes = new Uint8Array(dl.bytes);
          }
          await writeFile(fdir, fname, bytes);
          downloaded = true;
        } catch (e) {
          lastErr = e;
          const msg = String(e?.message || e);
          if (/FLOOD_WAIT/i.test(msg) && floods < CFG.floodRetries) { floods++; stats.flood++; await floodSleep(e); continue; }
          if (/safe browsing/i.test(msg) && bytes && sbMode !== 'off') {
            if (await resolveSbMode(fdir) === 'on') {
              try {
                await writeFile(fdir, fname + CFG.sbExt, bytes);
                downloaded = true;
                part = true;
                continue;
              } catch (e2) {
                lastErr = e2;
                if (tries === 1) pending('part fail ' + slug + '/' + fname + CFG.sbExt + ' step=' + e2.__step + ' name=' + (e2?.name || '?') + ': ' + String(e2?.message || e2).slice(0, 100));
              }
            }
          }
          tries++;
          if (tries < 2) await sleep(700);
        }
      }
      if (!downloaded && lastErr) pending('doc fail ' + slug + '/' + fname + ' step=' + (lastErr.__step || 'download') + ' name=' + (lastErr?.name || '?') + ': ' + String(lastErr?.message || lastErr).slice(0, 100));
      if (downloaded) {
        savedRef.v++;
        if (part) stats.part++;
        manifestLines.push(JSON.stringify({ set: slug, title: info.title, docId: String(doc.id), ...docAttrs(doc), ...(part ? { part: true } : {}) }));
      } else stats.stuck++;
    }
  }

  async function processSets(slugs, dir, savedRef) {
    let idx = 0;
    const worker = async () => {
      for (;;) {
        if (window.__corpusAbort || savedRef.v >= fileCap) return;
        const i = idx++;
        if (i >= slugs.length) return;
        const slug = slugs[i];
        await fetchAndSaveSet(slug, sets.get(slug), dir, savedRef);
        if ((i % 20) === 0) { LOG('progress: sets ' + i + '/' + slugs.length + ' files=' + savedRef.v); await flushManifest(dir); }
        await sleep(CFG.setDelay);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, CFG.setConc) }, () => worker()));
  }

  // discovery rounds 2+: search sets by alt names harvested from already downloaded stickers
  async function growRounds(dir, savedRef, known) {
    const isEmoji = (s) => /\p{Extended_Pictographic}/u.test(s);
    for (let round = 2; round <= 1 + Math.max(1, CFG.maxRounds); round++) {
      if (window.__corpusAbort || savedRef.v >= fileCap) return;
      const cand = [...alts].filter((s) => !usedWords.has(s)).slice(0, CFG.altCap);
      if (!cand.length) { LOG('round ' + round + ': no fresh search words yet'); return; }
      LOG('round ' + round + ': probing ' + cand.length + ' new words (from sticker alt names)');
      const fresh = [];
      for (const q of cand) {
        if (window.__corpusAbort) return;
        const pre = sets.size;
        try { await runSearch(q, isEmoji(q), false); } catch (e) { await floodSleep(e); }
        // Map keeps insertion order — entries appended after `pre` are new
        for (const s of [...sets.keys()].slice(pre)) if (!known.has(s)) { known.add(s); fresh.push(s); }
        if (savedRef.v >= fileCap) break;
      }
      if (!fresh.length) continue;
      LOG('round ' + round + ': +' + fresh.length + ' new sets -> download');
      await processSets(fresh, dir, savedRef);
      await flushManifest(dir);
    }
  }

  async function run() {
    const dir = await pickFolder();
    if (!dir) return;
    LOG('destination: ' + (dir.name || 'folder') + ' | target=' + (fileCap === Infinity ? 'all' : fileCap) + ' setConc=' + CFG.setConc);

    const savedRef = { v: 0 };
    if (CFG.probe) {
      const out = await runProbe(dir);
      LOG('probe result: ' + out.join(' '));
      return;
    }
    // resume: restore previous manifest so it is not lost on overwrite
    try {
      const fh = await dir.getFileHandle('manifest.jsonl', { create: false });
      const text = await (await fh.getFile()).text();
      for (const line of text.split('\n')) if (line.trim()) manifestLines.push(line);
      if (manifestLines.length) LOG('manifest restored: ' + manifestLines.length + ' lines');
    } catch { }
    if (CFG.missingOnly) {
      const empty = await scanEmpty(dir);
      let files = 0;
      for (const v of empty.values()) files += v.empty;
      LOG('missing scan: ' + empty.size + ' packs, ' + files + ' empty files');
      if (!empty.size) { LOG('nothing to re-download'); return; }
      const byNorm = new Map(BENCH_PACKS.map((s) => [normName(s), s]));
      for (const name of empty.keys()) addSet({ short_name: byNorm.get(name) || name });
      LOG('missing scope: ' + sets.size + ' collections');
    } else if (packList) {
      for (const entry of packList) addSet(typeof entry === 'string' ? { short_name: entry } : entry);
      LOG('benchmark scope: ' + sets.size + ' collections from tlottie android-fold');
    } else {
      await collectCatalog();
    }
    const known = new Set([...sets.keys()]);
    LOG('processing ' + known.size + ' sets, concurrency ' + CFG.setConc);

    await processSets([...known], dir, savedRef);
    if (!packList && !CFG.missingOnly) await growRounds(dir, savedRef, known);
    await flushManifest(dir);
    LOG('DONE saved=' + savedRef.v + ' files | sets ok=' + stats.setsOk +
      ' empty=' + stats.setsEmpty + ' fail=' + stats.setsFail +
      ' | re-downloaded=' + stats.redl + ' still-empty=' + stats.stuck +
      ' as-part=' + stats.part + ' flood=' + stats.flood + ' sb-fallback=' + sbMode +
      ' of ' + known.size + ' | manifest.jsonl is in the folder');
  }

  run().catch((e) => pending('fatal: ' + (e?.message || e))).finally(CLEANUP);
})();
