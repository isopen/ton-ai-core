use std::alloc::{GlobalAlloc, Layout, System};
use std::fs::read;
use std::sync::atomic::{AtomicUsize, Ordering};

struct Counting;

const N: usize = 160;
static COUNTS: [AtomicUsize; N] = [const { AtomicUsize::new(0) }; N];
static OVER: AtomicUsize = AtomicUsize::new(0);

fn bucket(size: usize) -> usize {
    (size + 7) / 8
}

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        let b = bucket(l.size());
        if b < N {
            COUNTS[b].fetch_add(1, Ordering::Relaxed);
        } else {
            OVER.fetch_add(1, Ordering::Relaxed);
        }
        System.alloc(l)
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        System.dealloc(p, l)
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        let b = bucket(n);
        if b < N {
            COUNTS[b].fetch_add(1, Ordering::Relaxed);
        } else {
            OVER.fetch_add(1, Ordering::Relaxed);
        }
        System.realloc(p, l, n)
    }
}

#[global_allocator]
static A: Counting = Counting;

fn snap() -> ([usize; N], usize) {
    let mut a = [0usize; N];
    for i in 0..N {
        a[i] = COUNTS[i].load(Ordering::Relaxed);
    }
    (a, OVER.load(Ordering::Relaxed))
}

fn main() {
    let paths: Vec<String> = std::env::args().skip(1).collect();
    let mut n = 0usize;
    let mut tree = [0i64; N];
    let mut model = [0i64; N];
    let mut tree_over = 0i64;
    let mut model_over = 0i64;
    for path in &paths {
        let data = match read(path) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let json = match tgs::inflate_tgs(&data) {
            Ok(j) => j,
            Err(_) => continue,
        };
        let (a0, o0) = snap();
        let v = tgs::json::parse(&json).expect("parse");
        let (a1, o1) = snap();
        drop(v);
        let (b0, p0) = snap();
        let anim = tgs::parse_tgs(&json, None).expect("model");
        let (b1, p1) = snap();
        drop(anim);
        for i in 0..N {
            let t = a1[i] as i64 - a0[i] as i64;
            let m = b1[i] as i64 - b0[i] as i64 - t;
            tree[i] += t;
            model[i] += m;
        }
        let t = o1 as i64 - o0 as i64;
        let m = p1 as i64 - p0 as i64 - t;
        tree_over += t;
        model_over += m;
        n += 1;
    }
    println!("files={n}");
    let mut rows: Vec<(usize, i64, i64)> = (1..N)
        .map(|i| (i * 8, tree[i], model[i]))
        .filter(|&(_, t, m)| t > 0 || m > 0)
        .collect();
    rows.sort_by(|a, b| b.2.cmp(&a.2));
    for (size, t, m) in rows.iter().take(40) {
        println!("size={size:5} tree={:8.1} model={:8.1}", *t as f64 / n as f64, *m as f64 / n as f64);
    }
    println!("over tree={:.0} model={:.0}", tree_over as f64 / n as f64, model_over as f64 / n as f64);
}
