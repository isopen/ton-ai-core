use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::UnsafeCell;
use std::fs::read;
use std::time::Instant;

struct Bump;

const CAP: usize = 512 << 20;

struct State {
    base: *mut u8,
    off: usize,
}

unsafe impl Sync for State {}

thread_local! {
    static STATE: UnsafeCell<State> = UnsafeCell::new(State { base: std::ptr::null_mut(), off: 0 });
}

unsafe impl GlobalAlloc for Bump {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        STATE.with(|s| {
            let st = &mut *s.get();
            if st.base.is_null() {
                st.base = System.alloc(Layout::from_size_align_unchecked(CAP, 4096));
            }
            let align = l.align().max(16);
            let off = (st.off + align - 1) & !(align - 1);
            if off + l.size() > CAP {
                return std::ptr::null_mut();
            }
            st.off = off + l.size();
            st.base.add(off)
        })
    }
    unsafe fn dealloc(&self, _p: *mut u8, _l: Layout) {}
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        let np = self.alloc(Layout::from_size_align_unchecked(n, l.align()));
        if !np.is_null() {
            std::ptr::copy_nonoverlapping(p, np, l.size().min(n));
        }
        np
    }
}

#[global_allocator]
static A: Bump = Bump;

fn main() {
    let paths: Vec<String> = std::env::args().skip(1).collect();
    let base_off = STATE.with(|s| unsafe { (*s.get()).off });
    let mut n = 0usize;
    let mut t_parse = 0.0f64;
    let mut t_total = 0.0f64;
    for path in &paths {
        let data = match read(path) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let json = match tgs::inflate_tgs(&data) {
            Ok(j) => j,
            Err(_) => continue,
        };
        let t = Instant::now();
        let v = tgs::json::parse(&json).expect("parse");
        t_parse += t.elapsed().as_secs_f64() * 1000.0;
        drop(v);
        let t = Instant::now();
        let anim = tgs::parse_tgs(&json, None).expect("model");
        t_total += t.elapsed().as_secs_f64() * 1000.0;
        drop(anim);
        drop(json);
        drop(data);
        STATE.with(|s| unsafe { (*s.get()).off = base_off });
        n += 1;
    }
    let f = |x: f64| x / n.max(1) as f64;
    println!(
        "files={} parse={:.3} total={:.3} build_only={:.3}",
        n,
        f(t_parse),
        f(t_total),
        f(t_total) - f(t_parse)
    );
}
