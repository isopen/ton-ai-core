use std::alloc::{GlobalAlloc, Layout, System};
use std::fs::read;
use std::sync::atomic::{AtomicUsize, Ordering};

struct Counting;

static ALLOCS: AtomicUsize = AtomicUsize::new(0);
static BYTES: AtomicUsize = AtomicUsize::new(0);
static REALLOCS: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        ALLOCS.fetch_add(1, Ordering::Relaxed);
        BYTES.fetch_add(l.size(), Ordering::Relaxed);
        System.alloc(l)
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        System.dealloc(p, l)
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        REALLOCS.fetch_add(1, Ordering::Relaxed);
        BYTES.fetch_add(n.saturating_sub(l.size()), Ordering::Relaxed);
        System.realloc(p, l, n)
    }
}

#[global_allocator]
static A: Counting = Counting;

fn main() {
    let paths: Vec<String> = std::env::args().skip(1).collect();
    let mut n = 0usize;
    let mut a0 = 0usize;
    let mut r0 = 0usize;
    let mut b0 = 0usize;
    let mut bytes = 0usize;
    for path in &paths {
        let data = match read(path) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let json = match tgs::inflate_tgs(&data) {
            Ok(j) => j,
            Err(_) => continue,
        };
        bytes += json.len();
        let a = ALLOCS.load(Ordering::Relaxed);
        let r = REALLOCS.load(Ordering::Relaxed);
        let b = BYTES.load(Ordering::Relaxed);
        let v = tgs::json::parse(&json).expect("parse");
        a0 += ALLOCS.load(Ordering::Relaxed) - a;
        r0 += REALLOCS.load(Ordering::Relaxed) - r;
        b0 += BYTES.load(Ordering::Relaxed) - b;
        drop(v);
        n += 1;
    }
    println!(
        "files={} avgKB={} allocs={:.0} reallocs={:.0} allocBytes={:.0}",
        n,
        bytes / n.max(1) / 1024,
        a0 as f64 / n as f64,
        r0 as f64 / n as f64,
        b0 as f64 / n as f64
    );
}
