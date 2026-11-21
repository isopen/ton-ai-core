use std::cell::RefCell;
use std::collections::HashMap;
use std::hash::Hasher;

const COV_CACHE_BUDGET: usize = 3 << 20;
pub(crate) const COV_ENTRY_MAX: usize = 256 << 10;
pub(crate) const SPAN_CAPTURE_MAX: usize = COV_ENTRY_MAX / 8;
const FREEZE_ROTATIONS: u32 = 2;
const FREEZE_ERA_FRAMES: u32 = 180;

#[inline]
pub(crate) fn pack_span(y: usize, x0: usize, len: usize, cov: u8) -> u64 {
    ((y as u64) << 44) | ((x0 as u64) << 24) | ((len as u64) << 8) | u64::from(cov)
}

#[inline]
pub(crate) fn unpack_span(s: u64) -> (usize, usize, usize, u8) {
    (
        (s >> 44) as usize,
        ((s >> 24) & 0xf_ffff) as usize,
        ((s >> 8) & 0xffff) as usize,
        (s & 0xff) as u8,
    )
}

#[inline]
fn avalanche(mut value: u64) -> u64 {
    value ^= value >> 33;
    value = value.wrapping_mul(0xff51_afd7_ed55_8ccd);
    value ^= value >> 33;
    value = value.wrapping_mul(0xc4ce_b9fe_1a85_ec53);
    value ^ (value >> 33)
}

pub(crate) struct Hasher128 {
    h1: u64,
    h2: u64,
}

impl Hasher128 {
    pub(crate) fn new() -> Self {
        Hasher128 {
            h1: 0xcbf2_9ce4_8422_2325,
            h2: 0x9e37_79b9_7f4a_7c15,
        }
    }

    #[inline]
    pub(crate) fn mix(&mut self, w: u32) {
        self.mix_u64(u64::from(w));
    }

    #[inline]
    pub(crate) fn mix_u64(&mut self, b: u64) {
        self.h1 = (self.h1 ^ b).wrapping_mul(0x0000_0100_0000_01b3);
        self.h2 = (self.h2 ^ b.rotate_left(32)).wrapping_mul(0xff51_afd7_ed55_8ccd);
    }

    #[inline]
    pub(crate) fn mix_f64(&mut self, v: f64) {
        self.mix_u64(v.to_bits());
    }

    pub(crate) fn finish(&self) -> u128 {
        (u128::from(self.h1) << 64) | u128::from(self.h2)
    }
}

struct KeyHasher(u64);

impl Hasher for KeyHasher {
    #[inline]
    fn finish(&self) -> u64 {
        self.0
    }

    #[inline]
    fn write(&mut self, bytes: &[u8]) {
        let mut hash = 0xcbf2_9ce4_8422_2325u64;
        for &byte in bytes {
            hash = (hash ^ u64::from(byte)).wrapping_mul(0x100_0000_01b3);
        }
        self.0 = avalanche(hash);
    }

    #[inline]
    fn write_u128(&mut self, key: u128) {
        self.0 = avalanche((key as u64) ^ ((key >> 64) as u64));
    }
}

#[derive(Default)]
struct KeyHasherBuilder;

impl std::hash::BuildHasher for KeyHasherBuilder {
    type Hasher = KeyHasher;

    fn build_hasher(&self) -> Self::Hasher {
        KeyHasher(0)
    }
}

type CoverageMap = HashMap<u128, CovEntry, KeyHasherBuilder>;

pub(crate) enum PlaneData {
    Cov(Vec<u8>),
    Spans(Vec<u64>),
}

pub(crate) struct CovEntry {
    pub(crate) rows: Vec<(u32, u32, u32)>,
    pub(crate) data: PlaneData,
}

fn entry_size(e: &CovEntry) -> usize {
    let data = match &e.data {
        PlaneData::Cov(v) => v.capacity(),
        PlaneData::Spans(v) => v.capacity() * 8,
    };
    data + e.rows.capacity() * 12 + 64
}

pub(crate) fn spans_fragmented(spans: &[u64], px_total: usize) -> bool {
    spans.len() * 4 > px_total
}

#[cfg(feature = "prof")]
pub(crate) fn plane_stats(spans: &[u64]) -> (usize, usize) {
    let mut nrows = 0usize;
    let mut nbytes = 0usize;
    let mut i = 0usize;
    while i < spans.len() {
        let (y, x0, len0, _) = unpack_span(spans[i]);
        let mut x_end = x0 + len0;
        let mut j = i + 1;
        while j < spans.len() {
            let (yy, xx, ll, _) = unpack_span(spans[j]);
            if yy != y || xx < x_end {
                break;
            }
            x_end = xx + ll;
            j += 1;
        }
        nrows += 1;
        nbytes += x_end - x0;
        i = j;
    }
    (nrows, nbytes)
}

fn pre_size(spans: &[u64], rows: &mut Vec<(u32, u32, u32)>, data: &mut Vec<u8>) {
    let mut nrows = 0usize;
    let mut nbytes = 0usize;
    let mut i = 0usize;
    while i < spans.len() {
        let (y, x0, len0, _) = unpack_span(spans[i]);
        let mut x_end = x0 + len0;
        let mut j = i + 1;
        while j < spans.len() {
            let (yy, xx, ll, _) = unpack_span(spans[j]);
            if yy != y || xx < x_end {
                break;
            }
            x_end = xx + ll;
            j += 1;
        }
        nrows += 1;
        nbytes += x_end - x0;
        i = j;
    }
    rows.reserve_exact(nrows);
    data.reserve_exact(nbytes);
}

pub(crate) fn spans_to_cov_entry(spans: &[u64]) -> CovEntry {
    let mut entry = CovEntry {
        rows: Vec::new(),
        data: PlaneData::Cov(Vec::new()),
    };
    let data = match &mut entry.data {
        PlaneData::Cov(v) => v,
        PlaneData::Spans(_) => return entry,
    };
    if spans.len() >= 64 {
        pre_size(spans, &mut entry.rows, data);
    }
    let mut i = 0usize;
    while i < spans.len() {
        let (y, x0, len0, _) = unpack_span(spans[i]);
        let mut j = i + 1;
        let mut x_end = x0 + len0;
        while j < spans.len() {
            let (yy, xx, ll, _) = unpack_span(spans[j]);
            if yy != y || xx < x_end {
                break;
            }
            x_end = xx + ll;
            j += 1;
        }
        entry.rows.push((y as u32, x0 as u32, (x_end - x0) as u32));
        let base = data.len();
        data.resize(base + (x_end - x0), 0);
        for s in &spans[i..j] {
            let (_, xx, ll, cv) = unpack_span(*s);
            let lo = base + (xx - x0);
            if lo + ll <= data.len() {
                data[lo..lo + ll].fill(cv);
            }
        }
        i = j;
    }
    entry
}

struct CovCache {
    budget: usize,
    shrink_entries: bool,
    young: CoverageMap,
    old: CoverageMap,
    young_bytes: usize,
    hits: u32,
    inserts: u32,
    rotations: u32,
    frozen: bool,
    era_frames: u32,
    era_hits: u32,
}

impl CovCache {
    fn new() -> Self {
        CovCache {
            budget: 0,
            shrink_entries: false,
            young: CoverageMap::default(),
            old: CoverageMap::default(),
            young_bytes: 0,
            hits: 0,
            inserts: 0,
            rotations: 0,
            frozen: false,
            era_frames: 0,
            era_hits: 0,
        }
    }

    fn get(&mut self, key: u128) -> Option<&CovEntry> {
        if let Some(e) = self.young.get(&key) {
            self.hits = self.hits.saturating_add(1);
            if self.frozen {
                self.era_hits = self.era_hits.saturating_add(1);
            }
            return Some(e);
        }
        if let Some(e) = self.old.get(&key) {
            self.hits = self.hits.saturating_add(1);
            if self.frozen {
                self.era_hits = self.era_hits.saturating_add(1);
            }
            return Some(e);
        }
        None
    }

    fn rotate_if_needed(&mut self) {
        if self.frozen {
            return;
        }
        let budget = if self.budget == 0 { COV_CACHE_BUDGET } else { self.budget };
        if self.young_bytes > budget / 2 {
            self.rotations = self.rotations.saturating_add(1);
            #[cfg(feature = "prof")]
            crate::prof::count(crate::prof::CROT, 1);
            if self.rotations >= FREEZE_ROTATIONS {
                self.frozen = true;
                #[cfg(feature = "prof")]
                crate::prof::count(crate::prof::CFRZ, 1);
                self.era_frames = 0;
                self.era_hits = 0;
            } else {
                self.old = core::mem::take(&mut self.young);
                if !self.shrink_entries {
                    self.young = HashMap::with_capacity_and_hasher(self.old.capacity(), KeyHasherBuilder);
                }
                self.young_bytes = 0;
            }
        }
    }

    fn insert(&mut self, key: u128, mut entry: CovEntry) {
        #[cfg(feature = "prof")]
        crate::prof::count(crate::prof::CATT, 1);
        if self.frozen {
            return;
        }
        let sz = entry_size(&entry);
        if sz > COV_ENTRY_MAX {
            return;
        }
        #[cfg(feature = "prof")]
        crate::prof::count(crate::prof::CINS, 1);
        if self.shrink_entries {
            entry.rows.shrink_to_fit();
            match &mut entry.data {
                PlaneData::Cov(v) => v.shrink_to_fit(),
                PlaneData::Spans(v) => v.shrink_to_fit(),
            }
        }
        self.inserts = self.inserts.saturating_add(1);
        self.young_bytes = self.young_bytes.saturating_add(sz);
        self.rotate_if_needed();
        self.young.insert(key, entry);
    }

    fn frame_tick(&mut self, w: usize, h: usize) {
        let px = w.saturating_mul(h);
        self.shrink_entries = px > 160 * 160;
        self.budget = if px <= 160 * 160 {
            3 << 20
        } else if px <= 448 * 448 {
            3 << 20
        } else {
            512 << 10
        };
        if self.frozen {
            self.era_frames += 1;
            if self.era_frames >= FREEZE_ERA_FRAMES {
                let resident = self.young.len().saturating_add(self.old.len());
                if (self.era_hits as usize) >= (resident / 2).max(1) {
                    self.era_frames = 0;
                    self.era_hits = 0;
                } else {
                    self.young.clear();
                    self.old.clear();
                    self.young_bytes = 0;
                    self.frozen = false;
                    self.hits = 0;
                    self.inserts = 0;
                    self.rotations = 0;
                    self.era_frames = 0;
                    self.era_hits = 0;
                }
            }
        }
    }

    fn reset_for_new_instance(&mut self) {
        MASK_PLANES.with(|slot| slot.borrow_mut().clear());
        if self.frozen {
            seed_absorb(&mut self.young);
            seed_absorb(&mut self.old);
            self.young_bytes = 0;
            self.frozen = false;
            self.hits = 0;
            self.inserts = 0;
            self.rotations = 0;
            self.era_frames = 0;
            self.era_hits = 0;
        }
    }
}

thread_local! {
    static COV: RefCell<CovCache> = RefCell::new(CovCache::new());
    static SPAN_BUF: RefCell<Vec<u64>> = RefCell::new(Vec::new());
    static COV_BUF: RefCell<Vec<f32>> = RefCell::new(Vec::new());
}

pub(crate) fn hit(key: u128, f: &mut dyn FnMut(&CovEntry)) -> bool {
    let _g = crate::prof::aprobe::enter(crate::prof::aprobe::COV);
    if COV_OFF.with(|slot| slot.get()) {
        return false;
    }
    let found = COV.with(|slot| {
        let mut cache = slot.borrow_mut();
        match cache.get(key) {
            Some(e) => {
                f(e);
                true
            }
            None => false,
        }
    });
    if found {
        return true;
    }
    SEED_HIT.with(|slot| {
        let seed = slot.borrow();
        match seed.get(&key) {
            Some(e) => {
                f(e);
                true
            }
            None => false,
        }
    })
}

pub(crate) fn insert(key: u128, entry: CovEntry) {
    COV.with(|slot| slot.borrow_mut().insert(key, entry));
}

thread_local! {
    static CAPTURE_OFF: core::cell::Cell<bool> = const { core::cell::Cell::new(false) };
}

pub(crate) fn capture_enabled() -> bool {
    if CAPTURE_OFF.with(|slot| slot.get()) {
        return false;
    }
    COV.with(|slot| !slot.borrow().frozen)
}

thread_local! {
    static SKIP_DRAW: core::cell::Cell<bool> = const { core::cell::Cell::new(false) };
}

thread_local! {
    static SKIP_ONE: core::cell::Cell<u32> = const { core::cell::Cell::new(u32::MAX) };
    static ONLY_ONE: core::cell::Cell<u32> = const { core::cell::Cell::new(u32::MAX) };
    static CUR_DRAW: core::cell::Cell<u32> = const { core::cell::Cell::new(0) };
}

pub fn set_skip_one(v: u32) {
    SKIP_ONE.with(|s| s.set(v));
    ONLY_ONE.with(|s| s.set(u32::MAX));
    CUR_DRAW.with(|s| s.set(0));
}

pub fn set_only_one(v: u32) {
    ONLY_ONE.with(|s| s.set(v));
    SKIP_ONE.with(|s| s.set(u32::MAX));
    CUR_DRAW.with(|s| s.set(0));
}

#[inline]
pub fn cur_draw_index() -> u32 {
    CUR_DRAW.with(|s| s.get().wrapping_sub(1))
}

#[inline]
pub fn skip_one_now() -> bool {
    let idx = CUR_DRAW.with(|s| {
        let v = s.get();
        s.set(v.wrapping_add(1));
        v
    });
    if SKIP_ONE.with(|s| s.get()) == idx {
        return true;
    }
    let only = ONLY_ONE.with(|s| s.get());
    only != u32::MAX && only != idx
}

pub fn skip_draw() -> bool {
    SKIP_DRAW.with(|slot| slot.get())
}

#[cfg(any(target_arch = "wasm32", feature = "prof"))]
pub fn set_skip_draw(v: bool) {
    SKIP_DRAW.with(|slot| slot.set(v));
}

thread_local! {
    static SKIP_SINK: core::cell::Cell<bool> = const { core::cell::Cell::new(false) };
}

#[inline]
pub(crate) fn skip_sink() -> bool {
    SKIP_SINK.with(|slot| slot.get())
}

#[cfg(any(target_arch = "wasm32", feature = "prof"))]
pub fn set_skip_sink(v: bool) {
    SKIP_SINK.with(|slot| slot.set(v));
}

thread_local! {
    static SKIP_WALK: core::cell::Cell<bool> = const { core::cell::Cell::new(false) };
}

#[inline]
pub(crate) fn skip_walk() -> bool {
    SKIP_WALK.with(|slot| slot.get())
}

#[cfg(any(target_arch = "wasm32", feature = "prof"))]
pub fn set_skip_walk(v: bool) {
    SKIP_WALK.with(|slot| slot.set(v));
}

thread_local! {
    static SKIP_MARK: core::cell::Cell<bool> = const { core::cell::Cell::new(false) };
}

#[inline]
pub(crate) fn skip_mark() -> bool {
    SKIP_MARK.with(|slot| slot.get())
}

#[cfg(any(target_arch = "wasm32", feature = "prof"))]
pub fn set_skip_mark(v: bool) {
    SKIP_MARK.with(|slot| slot.set(v));
}

thread_local! {
    static SKIP_FRESH: core::cell::Cell<bool> = const { core::cell::Cell::new(false) };
}

#[inline]
pub(crate) fn skip_fresh() -> bool {
    SKIP_FRESH.with(|slot| slot.get())
}

#[cfg(any(target_arch = "wasm32", feature = "prof"))]
pub fn set_skip_fresh(v: bool) {
    SKIP_FRESH.with(|slot| slot.set(v));
}

thread_local! {
    static SKIP_RASTER: core::cell::Cell<bool> = const { core::cell::Cell::new(false) };
}

#[inline]
pub(crate) fn skip_raster() -> bool {
    SKIP_RASTER.with(|slot| slot.get())
}

#[cfg(any(target_arch = "wasm32", feature = "prof"))]
pub fn set_skip_raster(v: bool) {
    SKIP_RASTER.with(|slot| slot.set(v));
}

thread_local! {
    static SKIP_PAINT: core::cell::Cell<bool> = const { core::cell::Cell::new(false) };
}

#[inline]
pub(crate) fn skip_paint() -> bool {
    SKIP_PAINT.with(|slot| slot.get())
}

#[cfg(any(target_arch = "wasm32", feature = "prof"))]
pub fn set_skip_paint(v: bool) {
    SKIP_PAINT.with(|slot| slot.set(v));
}

#[cfg(target_arch = "wasm32")]
pub fn capture_off(v: bool) {
    CAPTURE_OFF.with(|slot| slot.set(v));
    if v {
        COV.with(|slot| slot.borrow_mut().reset_for_new_instance());
    }
}





pub fn cache_all_off(v: bool) {
    CAPTURE_OFF.with(|slot| slot.set(v));
    COV_OFF.with(|slot| slot.set(v));
    if v {
        COV.with(|slot| slot.borrow_mut().reset_for_new_instance());
    }
}

thread_local! {
    static COV_OFF: core::cell::Cell<bool> = const { core::cell::Cell::new(false) };
}




const SEED_BUDGET: usize = 32 << 20;

thread_local! {
    static SEED_HIT: RefCell<CoverageMap> = RefCell::new(CoverageMap::default());
    static SEED_BYTES: core::cell::Cell<usize> = const { core::cell::Cell::new(0) };
}

fn seed_absorb(source: &mut CoverageMap) {
    SEED_HIT.with(|sslot| {
        let mut seed = sslot.borrow_mut();
        SEED_BYTES.with(|bslot| {
            let mut bytes = bslot.get();
            for (key, entry) in source.drain() {
                if seed.contains_key(&key) {
                    continue;
                }
                let sz = entry_size(&entry);
                if bytes.saturating_add(sz) > SEED_BUDGET {
                    continue;
                }
                bytes += sz;
                seed.insert(key, entry);
            }
            bslot.set(bytes);
        });
    });
}



#[cfg(target_arch = "wasm32")]
pub(crate) fn seed_commit() {
    COV.with(|slot| {
        let mut cache = slot.borrow_mut();
        seed_absorb(&mut cache.young);
        seed_absorb(&mut cache.old);
        cache.young_bytes = 0;
        cache.budget = 0;
        cache.frozen = false;
        cache.hits = 0;
        cache.inserts = 0;
        cache.rotations = 0;
        cache.era_frames = 0;
        cache.era_hits = 0;
    });
}






const SEEN_WORDS: usize = 128;

struct SeenBits {
    prev: [u64; SEEN_WORDS],
    prev2: [u64; SEEN_WORDS],
    cur: [u64; SEEN_WORDS],
}

impl SeenBits {
    const fn new() -> Self {
        SeenBits {
            prev: [0; SEEN_WORDS],
            prev2: [0; SEEN_WORDS],
            cur: [0; SEEN_WORDS],
        }
    }

    #[inline]
    fn slot(key: u128) -> (usize, u64) {
        let h = avalanche((key as u64) ^ ((key >> 64) as u64));
        let idx = (h as usize) & (SEEN_WORDS * 64 - 1);
        (idx >> 6, 1u64 << (idx & 63))
    }
}

thread_local! {
    static SEEN: RefCell<SeenBits> = const { RefCell::new(SeenBits::new()) };
}

#[inline]
pub(crate) fn seen_recent(key: u128) -> bool {
    SEEN.with(|slot| {
        let s = slot.borrow();
        let (w, b) = SeenBits::slot(key);
        let r = ((s.prev[w] | s.prev2[w]) & b) != 0;
        #[cfg(feature = "prof")]
        if std::env::var("TGS_DBG_COV").is_ok() {
            let pop = s.cur.iter().map(|x| x.count_ones()).sum::<u32>();
            let pop_prev = s.prev.iter().map(|x| x.count_ones()).sum::<u32>();
            eprintln!("[dbg] seen_recent w={} hit={} cur_bits={} prev_bits={}", w, r, pop, pop_prev);
        }
        r
    })
}

#[inline]
pub(crate) fn seen_cur(key: u128) -> bool {
    SEEN.with(|slot| {
        let s = slot.borrow();
        let (w, b) = SeenBits::slot(key);
        (s.cur[w] & b) != 0
    })
}

#[inline]
pub(crate) fn seen_note(key: u128) {
    SEEN.with(|slot| {
        let mut s = slot.borrow_mut();
        let (w, b) = SeenBits::slot(key);
        s.cur[w] |= b;
    });
}

fn seen_advance() {
    SEEN.with(|slot| {
        let mut s = slot.borrow_mut();
        s.prev2 = s.prev;
        s.prev = s.cur;
        s.cur = [0; SEEN_WORDS];
    });
}

pub(crate) fn frame_tick(w: usize, h: usize) {
    seen_advance();
    COV.with(|slot| slot.borrow_mut().frame_tick(w, h));
}

#[derive(Clone)]
struct MaskPlaneEntry {
    key: u128,
    plane: std::rc::Rc<Vec<u8>>,
}

thread_local! {
    static MASK_PLANES: RefCell<Vec<MaskPlaneEntry>> = const { RefCell::new(Vec::new()) };
}

const MASK_PLANE_MAX: usize = 3;

pub(crate) fn mask_plane_hit(key: u128) -> Option<std::rc::Rc<Vec<u8>>> {
    MASK_PLANES.with(|slot| {
        let mut v = slot.borrow_mut();
        let i = v.iter().position(|e| e.key == key)?;
        let e = v.remove(i);
        v.insert(0, e.clone());
        Some(e.plane)
    })
}

pub(crate) fn mask_plane_insert(key: u128, plane: std::rc::Rc<Vec<u8>>) {
    MASK_PLANES.with(|slot| {
        let mut v = slot.borrow_mut();
        if v.iter().any(|e| e.key == key) {
            return;
        }
        v.insert(0, MaskPlaneEntry { key, plane });
        v.truncate(MASK_PLANE_MAX);
    });
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn note_new_instance() {
    COV.with(|slot| slot.borrow_mut().reset_for_new_instance());
}

pub(crate) fn take_span_buf() -> Vec<u64> {
    SPAN_BUF.with(|slot| core::mem::take(&mut *slot.borrow_mut()))
}

pub(crate) fn stow_span_buf(spans: Vec<u64>) {
    SPAN_BUF.with(|slot| *slot.borrow_mut() = spans);
}

pub(crate) fn take_cov_buf() -> Vec<f32> {
    COV_BUF.with(|slot| core::mem::take(&mut *slot.borrow_mut()))
}

pub(crate) fn stow_cov_buf(cov: Vec<f32>) {
    COV_BUF.with(|slot| *slot.borrow_mut() = cov);
}

pub(crate) fn probe_reset() {
    COV.with(|slot| {
        let mut c = slot.borrow_mut();
        *c = CovCache::new();
    });
    SEEN.with(|slot| *slot.borrow_mut() = SeenBits::new());
    SEED_HIT.with(|slot| slot.borrow_mut().clear());
    SEED_BYTES.with(|slot| slot.set(0));
    MASK_PLANES.with(|slot| slot.borrow_mut().clear());
}

pub(crate) fn stats_string() -> String {
    COV.with(|slot| {
        let c = slot.borrow();
        format!(
            "hits={} inserts={} rotations={} frozen={} era={} era_hits={} resident={} young_bytes={} budget={}",
            c.hits,
            c.inserts,
            c.rotations,
            c.frozen,
            c.era_frames,
            c.era_hits,
            c.young.len() + c.old.len(),
            c.young_bytes,
            c.budget
        )
    })
}



