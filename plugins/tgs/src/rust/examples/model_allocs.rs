use std::alloc::{GlobalAlloc, Layout, System};
use std::fs::read;
use std::sync::atomic::{AtomicUsize, Ordering};

struct Counting;

static ALLOCS: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        ALLOCS.fetch_add(1, Ordering::Relaxed);
        System.alloc(l)
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        System.dealloc(p, l)
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        ALLOCS.fetch_add(1, Ordering::Relaxed);
        System.realloc(p, l, n)
    }
}

#[global_allocator]
static A: Counting = Counting;

fn main() {
    let paths: Vec<String> = std::env::args().skip(1).collect();
    let mut n = 0usize;
    let mut tree = 0usize;
    let mut model = 0usize;
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
        let v = tgs::json::parse(&json).expect("parse");
        tree += ALLOCS.load(Ordering::Relaxed) - a;
        drop(v);
        let a = ALLOCS.load(Ordering::Relaxed);
        let anim = tgs::parse_tgs(&json, None).expect("model");
        model += ALLOCS.load(Ordering::Relaxed) - a;
        drop(anim);
        n += 1;
    }
    println!(
        "files={} treeAllocs={:.0} modelAllocs={:.0}",
        n,
        tree as f64 / n as f64,
        model as f64 / n as f64
    );
}
