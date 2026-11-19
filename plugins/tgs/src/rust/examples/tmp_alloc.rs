use std::alloc::{GlobalAlloc, Layout, System};
use std::fs::read;
use std::sync::atomic::{AtomicUsize, Ordering};

struct Counting;

static ALLOCS: AtomicUsize = AtomicUsize::new(0);
static BYTES: AtomicUsize = AtomicUsize::new(0);

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
        ALLOCS.fetch_add(1, Ordering::Relaxed);
        BYTES.fetch_add(n, Ordering::Relaxed);
        System.realloc(p, l, n)
    }
}

#[global_allocator]
static A: Counting = Counting;

fn main() {
    let paths: Vec<String> = std::env::args().skip(1).collect();
    let mut ta = 0usize;
    let mut tb = 0usize;
    for path in &paths {
        let data = match read(path) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let json = match tgs::inflate_tgs(&data) {
            Ok(j) => j,
            Err(_) => continue,
        };
        let a = ALLOCS.load(Ordering::Relaxed);
        let b = BYTES.load(Ordering::Relaxed);
        let anim = tgs::parse_tgs(&json, None).expect("model");
        let da = ALLOCS.load(Ordering::Relaxed) - a;
        let db = BYTES.load(Ordering::Relaxed) - b;
        drop(anim);
        ta += da;
        tb += db;
        let name = path.rsplit('/').next().unwrap_or(path);
        println!("{:>22} allocs={:>8} bytes={:>10}", name, da, db);
    }
    println!("TOTAL allocs={} bytes={}", ta, tb);
}
