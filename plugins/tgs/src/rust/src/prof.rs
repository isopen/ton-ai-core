
#[cfg(feature = "prof")]
use crate::jsutil::clock_now;

pub const INTERP: usize = 0;
pub const SHAPE: usize = 1;
pub const TRIM: usize = 2;
pub const PAINT: usize = 3;
pub const BLIT: usize = 4;
pub const CLONE: usize = 5;
pub const PCMD: usize = 6;
pub const PSTYLE: usize = 7;
pub const FILL: usize = 8;
pub const STRK: usize = 9;
pub const PREP: usize = 10;
pub const SPREP: usize = 11;
pub const SRAS: usize = 12;
pub const FPREP: usize = 13;
pub const FRAS: usize = 14;
pub const FROW: usize = 15;
pub const RC: usize = 16;
pub const RS: usize = 17;
pub const RW: usize = 18;
#[cfg(feature = "prof")]
pub const SCALLS: usize = 19;
#[cfg(feature = "prof")]
pub const SSTABLE: usize = 20;
pub const RACT: usize = 21;
pub const RINIT: usize = 22;
pub const RZC: usize = 23;
pub const FROWM: usize = 24;
pub const FROWG: usize = 25;
pub const FROWX: usize = 26;
pub const FROWU: usize = 27;
pub const FROWUL: usize = 28;
pub const FROWUR: usize = 29;
pub const COVROW: usize = 30;
pub const SRASDL: usize = 31;
pub const SRASSW: usize = 32;
pub const FROWUS: usize = 33;
pub const ADL: usize = 34;
pub const ASW: usize = 35;
pub const SSORT: usize = 36;
pub const REPC: usize = 37;
pub const XFRM: usize = 38;
pub const KEYS: usize = 39;
pub const SPTS: usize = 40;
pub const SINP: usize = 41;
pub const FPTS: usize = 42;
pub const PROW: usize = 43;
pub const RSRC: usize = 44;
pub const SPANSHORT: usize = 45;
pub const SPANSHORTPX: usize = 46;
pub const SPANPXP: usize = 47;
pub const BLEND0: usize = 48;
pub const RS255: usize = 67;
pub const RPX255: usize = 68;
pub const FS255: usize = 69;
pub const FPX255: usize = 70;
pub const COVHIT: usize = 71;
pub const SRCHIT: usize = 72;
pub const PCHK: usize = 73;
pub const PCNV: usize = 74;
pub const PCS: usize = 75;
pub const PCPX: usize = 76;
pub const PCBY: usize = 77;
pub const PCROW: usize = 78;
pub const DUPKEY: usize = 79;
pub const SIGP: usize = 80;
pub const SIGHIT: usize = 81;
pub const SIGB: usize = 82;
pub const SWE1: usize = 83;
pub const SWE2: usize = 84;
pub const SWE3: usize = 85;
pub const DRAW: usize = 86;
pub const MASKR: usize = 87;
pub const PAINTS: usize = 88;
pub const PAINTSP: usize = 89;
pub const PAINTF: usize = 90;
pub const SOLIDPX: usize = 91;
pub const GRADPX: usize = 92;
pub const SOLIDSP: usize = 93;
pub const GRADSP: usize = 94;
#[cfg(feature = "prof")]
pub const RCALLS: usize = 95;
#[cfg(feature = "prof")]
pub const RACC: usize = 96;
pub const RCDEP: usize = 97;
pub const RCSW: usize = 98;
pub const RCCAP: usize = 99;
#[cfg(feature = "prof")]
pub const XHIT: usize = 100;
#[cfg(feature = "prof")]
pub const XMISS: usize = 101;
#[cfg(feature = "prof")]
pub const XPT: usize = 102;
#[cfg(feature = "prof")]
pub const CINS: usize = 103;
#[cfg(feature = "prof")]
pub const CATT: usize = 104;
#[cfg(feature = "prof")]
pub const CFRZ: usize = 105;
#[cfg(feature = "prof")]
pub const CROT: usize = 106;
#[cfg(feature = "prof")]
pub const COUNT: usize = 107;
#[cfg(not(feature = "prof"))]
pub const COUNT: usize = 19;

#[cfg(feature = "prof")]
const NAMES: [&'static str; COUNT] = ["interp", "shape", "trim", "paint", "blit", "clone", "pcmd", "pstyle", "fill", "stroke", "prep", "sprep", "sras", "fprep", "fras", "frow", "rc", "rs", "rw", "scalls", "sstable", "ract", "rinit", "rzc", "frowm", "frowg", "frowx", "frowu", "frowul", "frowur", "covrow", "srasdl", "srassw", "frowus", "adl", "asw", "ssort", "repc", "xfrm", "keys", "spts", "sinp", "fpts", "prow", "rsrc", "spanshort", "spanshortpx", "spanpxp", "b_srcover", "b_multiply", "b_screen", "b_overlay", "b_darken", "b_lighten", "b_colordodge", "b_colorburn", "b_hardlight", "b_softlight", "b_difference", "b_exclusion", "b_hue", "b_saturation", "b_color", "b_luminosity", "b_plus", "b_destin", "b_destout", "rs255", "rpx255", "fs255", "fpx255", "covhit", "srchit", "pchk", "pcnv", "pcs", "pcpx", "pcby", "pcrow", "dupkey", "sigp", "sighit", "sigb", "swe1", "swe2", "swe3", "draw", "maskr", "paints", "paintsp", "paintf", "solidpx", "gradpx", "solidsp", "gradsp", "rcalls", "racc", "rcdep", "rcsw", "rccap", "xhit", "xmiss", "xpt", "cins", "catt", "cfrz", "crot"];

#[cfg(feature = "prof")]
static COUNTERS: [std::sync::atomic::AtomicU64; COUNT] = [
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
];

#[inline]
pub fn now() -> f64 {
    #[cfg(feature = "prof")]
    {
        clock_now()
    }
    #[cfg(not(feature = "prof"))]
    {
        0.0
    }
}

#[inline]
pub fn count(id: usize, val: u64) {
    #[cfg(feature = "prof")]
    if id < COUNT {
        use std::sync::atomic::Ordering;
        COUNTERS[id].fetch_add(val.saturating_mul(1_000_000), Ordering::Relaxed);
    }
    #[cfg(not(feature = "prof"))]
    {
        let _ = (id, val);
    }
}

#[inline]
pub fn add(id: usize, t0: f64) {
    #[cfg(feature = "prof")]
    if id < COUNT {
        use std::sync::atomic::Ordering;
        COUNTERS[id].fetch_add(((clock_now() - t0) * 1_000_000.0) as u64, Ordering::Relaxed);
    }
    #[cfg(not(feature = "prof"))]
    {
        let _ = (id, t0);
    }
}

#[cfg(feature = "prof")]
pub fn totals() -> [(f64, &'static str); COUNT] {
    use std::sync::atomic::Ordering;
    let mut out: [(f64, &'static str); COUNT] = [(0.0, ""); COUNT];
    for (i, item) in out.iter_mut().enumerate() {
        *item = (COUNTERS[i].load(Ordering::Relaxed) as f64 / 1_000_000.0, NAMES[i]);
    }
    out
}

#[cfg(feature = "prof")]
pub fn reset() {
    use std::sync::atomic::Ordering;
    for c in COUNTERS.iter() {
        c.store(0, Ordering::Relaxed);
    }
}

#[cfg(not(feature = "prof"))]
pub fn reset() {}

pub mod aprobe {
    pub const NPH: usize = 12;
    pub const OTHER: usize = 0;
    pub const WALK: usize = 1;
    pub const PROP: usize = 2;
    pub const DRAW: usize = 3;
    pub const AFILL: usize = 4;
    pub const ASTROKE: usize = 5;
    pub const FLAT: usize = 6;
    pub const LUT: usize = 7;
    pub const SWEEP: usize = 8;
    pub const COV: usize = 9;
    pub const KEYS: usize = 10;
    pub const RESERVE: usize = 11;

    #[cfg(feature = "prof")]
    mod imp {
        use std::sync::atomic::{AtomicUsize, Ordering};
        pub static PHASE: AtomicUsize = AtomicUsize::new(0);
        pub static PBYTES: [AtomicUsize; super::NPH] = [
            AtomicUsize::new(0),
            AtomicUsize::new(0),
            AtomicUsize::new(0),
            AtomicUsize::new(0),
            AtomicUsize::new(0),
            AtomicUsize::new(0),
            AtomicUsize::new(0),
            AtomicUsize::new(0),
            AtomicUsize::new(0),
            AtomicUsize::new(0),
            AtomicUsize::new(0),
            AtomicUsize::new(0),
        ];
        pub static PCALLS: [AtomicUsize; super::NPH] = [
            AtomicUsize::new(0),
            AtomicUsize::new(0),
            AtomicUsize::new(0),
            AtomicUsize::new(0),
            AtomicUsize::new(0),
            AtomicUsize::new(0),
            AtomicUsize::new(0),
            AtomicUsize::new(0),
            AtomicUsize::new(0),
            AtomicUsize::new(0),
            AtomicUsize::new(0),
            AtomicUsize::new(0),
        ];
        pub struct Guard(usize);
        impl Drop for Guard {
            #[inline]
            fn drop(&mut self) {
                PHASE.store(self.0, Ordering::Relaxed);
            }
        }
        #[inline]
        pub fn enter(p: usize) -> Guard {
            Guard(PHASE.swap(p, Ordering::Relaxed))
        }
        #[inline]
        pub fn tag(bytes: usize) {
            let p = PHASE.load(Ordering::Relaxed);
            if p < super::NPH {
                PBYTES[p].fetch_add(bytes, Ordering::Relaxed);
                PCALLS[p].fetch_add(1, Ordering::Relaxed);
            }
        }
        pub fn reset() {
            for i in 0..super::NPH {
                PBYTES[i].store(0, Ordering::Relaxed);
                PCALLS[i].store(0, Ordering::Relaxed);
            }
        }
        pub const PHASE_NAMES: [&'static str; super::NPH] = ["other", "walk", "prop", "draw", "fill", "stroke", "flat", "lut", "sweep", "cov", "keys", "reserve"];

        pub fn dump() {
            const NAMES: [&'static str; super::NPH] = PHASE_NAMES;
            for i in 0..super::NPH {
                let b = PBYTES[i].load(Ordering::Relaxed);
                let c = PCALLS[i].load(Ordering::Relaxed);
                if b > 0 || c > 0 {
                    println!("[aprobe] {:>8} {:>12}B {:>9}c", NAMES[i], b, c);
                }
            }
        }
    }

    #[cfg(feature = "prof")]
    pub use imp::*;

    #[cfg(not(feature = "prof"))]
    mod imp {
        pub struct Guard;
        #[inline]
        pub fn enter(_p: usize) -> Guard {
            Guard
        }
        #[inline]
        pub fn tag(_bytes: usize) {}
        pub fn reset() {}
        pub fn dump() {}
    }

    #[cfg(not(feature = "prof"))]
    pub use imp::*;
}

#[cfg(feature = "prof")]
mod sd {
    use std::cell::{Cell, RefCell};
    thread_local! {
        pub static CALL: Cell<usize> = const { Cell::new(0) };
        pub static CUR: RefCell<Vec<u64>> = const { RefCell::new(Vec::new()) };
        pub static PREV: RefCell<Vec<u64>> = const { RefCell::new(Vec::new()) };
    }
}

#[cfg(feature = "prof")]
pub fn stroke_record(hash: u64) {
    use sd::{CALL, CUR, PREV};
    let mut stable = false;
    PREV.with(|p| {
        let p = p.borrow();
        let idx = CALL.get();
        stable = idx < p.len() && p[idx] == hash;
    });
    if stable {
        add_raw(SSTABLE, 1.0);
    }
    add_raw(SCALLS, 1.0);
    CUR.with(|c| c.borrow_mut().push(hash));
    CALL.with(|c| c.set(c.get() + 1));
}

#[cfg(feature = "prof")]
pub fn add_raw(id: usize, val: f64) {
    if id < COUNT {
        use std::sync::atomic::Ordering;
        COUNTERS[id].fetch_add((val * 1_000_000.0) as u64, Ordering::Relaxed);
    }
}

#[cfg(feature = "prof")]
pub fn frame_begin() {
    use sd::{CALL, CUR, PREV};
    if CALL.get() > 0 {
        PREV.with(|p| {
            CUR.with(|c| {
                let mut p = p.borrow_mut();
                let mut c = c.borrow_mut();
                std::mem::swap(&mut *p, &mut *c);
                c.clear();
            });
        });
    }
    CALL.set(0);
}

#[cfg(not(feature = "prof"))]
pub fn totals() -> [(f64, &'static str); COUNT] {
    [(0.0, ""); COUNT]
}

pub fn dump() {
    #[cfg(feature = "prof")]
    {
        let ts = totals();
        for (ms, name) in ts.iter() {
            println!("[prof] {:>6} {:.2} ms", name, ms);
        }
        alloc_dump();
    }
}

#[cfg(feature = "prof")]
pub mod alloc_count {
    use std::alloc::{GlobalAlloc, Layout, System};
    use std::sync::atomic::{AtomicUsize, Ordering};

    pub const NPH: usize = super::aprobe::NPH;
    #[allow(unused_imports)]
    use super::aprobe::PHASE;
    pub static ABYTES: [AtomicUsize; NPH] = [const { AtomicUsize::new(0) }; NPH];
    pub static ACALLS: [AtomicUsize; NPH] = [const { AtomicUsize::new(0) }; NPH];
    pub static FBYTES: AtomicUsize = AtomicUsize::new(0);
    pub static FCALLS: AtomicUsize = AtomicUsize::new(0);

    struct Counting;

    #[inline(always)]
    fn note(size: usize) {
        let ph = super::aprobe::PHASE.load(Ordering::Relaxed);
        ACALLS[ph].fetch_add(1, Ordering::Relaxed);
        ABYTES[ph].fetch_add(size, Ordering::Relaxed);
    }

    unsafe impl GlobalAlloc for Counting {
        #[inline]
        unsafe fn alloc(&self, l: Layout) -> *mut u8 {
            let p = unsafe { System.alloc(l) };
            if !p.is_null() {
                note(l.size());
            }
            p
        }

        #[inline]
        unsafe fn alloc_zeroed(&self, l: Layout) -> *mut u8 {
            let p = unsafe { System.alloc_zeroed(l) };
            if !p.is_null() {
                note(l.size());
            }
            p
        }

        #[inline]
        unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
            FCALLS.fetch_add(1, Ordering::Relaxed);
            FBYTES.fetch_add(l.size(), Ordering::Relaxed);
            unsafe { System.dealloc(p, l) }
        }

        #[inline]
        unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
            let q = unsafe { System.realloc(p, l, n) };
            if !q.is_null() {
                FCALLS.fetch_add(1, Ordering::Relaxed);
                FBYTES.fetch_add(l.size(), Ordering::Relaxed);
                note(n);
            }
            q
        }

    }

    #[global_allocator]
    static GLOBAL: Counting = Counting;

    pub fn reset() {
        for i in 0..NPH {
            ABYTES[i].store(0, Ordering::Relaxed);
            ACALLS[i].store(0, Ordering::Relaxed);
        }
        FBYTES.store(0, Ordering::Relaxed);
        FCALLS.store(0, Ordering::Relaxed);
    }

    pub fn dump() {
        const NAMES: [&'static str; NPH] = super::aprobe::PHASE_NAMES;
        for i in 0..NPH {
            let b = ABYTES[i].load(Ordering::Relaxed);
            let c = ACALLS[i].load(Ordering::Relaxed);
            if c > 0 {
                println!("[allocs] {:>8} {:>12}B {:>9}c", NAMES[i], b, c);
            }
        }
        println!("[allocs]     free {:>12}B {:>9}c", FBYTES.load(Ordering::Relaxed), FCALLS.load(Ordering::Relaxed));
    }
}

#[cfg(feature = "prof")]
pub fn alloc_dump() {
    alloc_count::dump();
}

#[cfg(not(feature = "prof"))]
pub fn alloc_dump() {}
