use std::alloc::{GlobalAlloc, Layout, System};
use std::fs::read;
use std::sync::atomic::{AtomicIsize, AtomicUsize, Ordering};

struct Counting;

static BYTES: AtomicIsize = AtomicIsize::new(0);
static CALLS: AtomicIsize = AtomicIsize::new(0);
static GROSS_B: AtomicUsize = AtomicUsize::new(0);
static GROSS_C: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        BYTES.fetch_add(l.size() as isize, Ordering::Relaxed);
        CALLS.fetch_add(1, Ordering::Relaxed);
        GROSS_B.fetch_add(l.size(), Ordering::Relaxed);
        GROSS_C.fetch_add(1, Ordering::Relaxed);
        tgs::prof::aprobe::tag(l.size());
        System.alloc(l)
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        BYTES.fetch_sub(l.size() as isize, Ordering::Relaxed);
        CALLS.fetch_sub(1, Ordering::Relaxed);
        GROSS_B.fetch_add(l.size(), Ordering::Relaxed);
        GROSS_C.fetch_add(1, Ordering::Relaxed);
        System.dealloc(p, l)
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        BYTES.fetch_add(n as isize - l.size() as isize, Ordering::Relaxed);
        CALLS.fetch_add(1, Ordering::Relaxed);
        GROSS_B.fetch_add(n, Ordering::Relaxed);
        GROSS_C.fetch_add(1, Ordering::Relaxed);
        System.realloc(p, l, n)
    }
}

#[global_allocator]
static A: Counting = Counting;

fn snap() -> (i64, i64, usize, usize) {
    (
        BYTES.load(Ordering::Relaxed) as i64,
        CALLS.load(Ordering::Relaxed) as i64,
        GROSS_B.load(Ordering::Relaxed),
        GROSS_C.load(Ordering::Relaxed),
    )
}

fn env_num<T: std::str::FromStr>(name: &str, def: T) -> T {
    std::env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(def)
}

fn main() {
    let size: u32 = env_num("RB_SIZE", 64);
    let frames_max: usize = env_num("RB_FRAMES", 30);
    tgs::prof::aprobe::reset();
    #[cfg(feature = "prof")]
    {
        let flag = |name: &str| std::env::var(name).is_ok();
        tgs::set_skip_paint(flag("RB_SKIP_PAINT"));
        tgs::set_skip_raster(flag("RB_SKIP_RASTER"));
        tgs::set_skip_draw(flag("RB_SKIP_DRAW"));
    }
    let paths: Vec<String> = std::env::args().skip(1).collect();
    let mut tot_parse_b = 0i64;
    let mut tot_parse_c = 0i64;
    let mut tot_frame_b = 0i64;
    let mut tot_frame_c = 0i64;
    let mut tot_frames = 0i64;
    for path in &paths {
        let data = match read(path) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let json = match tgs::inflate_tgs(&data) {
            Ok(j) => j,
            Err(_) => continue,
        };
        let s0 = snap();
        let anim = match tgs::parse_tgs(&json, None) {
            Ok(a) => a,
            Err(_) => continue,
        };
        let s1 = snap();
        let mut inst = tgs::render::RenderInstance::new(anim);
        let mut pix = tgs::rast::PixBuf::new(size, size).expect("pixmap");
        let _s2 = snap();
        let ip = inst.anim.in_frame;
        let fc = ((inst.anim.out_frame - inst.anim.in_frame).ceil() as usize).max(1);
        let n = fc.min(frames_max);
        let mut fb = 0i64;
        let mut fcalls = 0i64;
        let mut gb = 0i64;
        let mut gc = 0i64;
        let mut maxb = 0i64;
        for f in 0..n {
            let a = snap();
            inst.render_frame_into(&mut pix, ip + f as f64);
            let b = snap();
            let db = b.0 - a.0;
            let dc = b.1 - a.1;
            let dgb = (b.2 - a.2) as i64;
            let dgc = (b.3 - a.3) as i64;
            fb += db;
            fcalls += dc;
            gb += dgb;
            gc += dgc;
            if dgb > maxb {
                maxb = dgb;
            }
        }
        tot_parse_b += s1.0 - s0.0;
        tot_parse_c += s1.1 - s0.1;
        tot_frame_b += gb;
        tot_frame_c += gc;
        tot_frames += n as i64;
        let base = path.rsplit(|c| c == '/' || c == '\\').next().unwrap_or(path);
        println!(
            "[ra] {:<42} parse {:>9}B/{:>6}c  frames {:>3}  gross/frame {:>8}B {:>6}c  net/frame {:>8}B {:>6}c  max1f {:>8}B",
            base,
            s1.0 - s0.0,
            s1.1 - s0.1,
            n,
            gb / n.max(1) as i64,
            gc / n.max(1) as i64,
            fb / n.max(1) as i64,
            fcalls / n.max(1) as i64,
            maxb,
        );
    }
    if tot_frames > 0 {
        println!(
            "[ra] TOTAL frames={} parse {}B/{}c  GROSS per_frame {}B {}c",
            tot_frames,
            tot_parse_b,
            tot_parse_c,
            tot_frame_b / tot_frames,
            tot_frame_c / tot_frames,
        );
        tgs::prof::aprobe::dump();
        println!("[aprobe] (per totals above; divide bytes/calls by frames={})", tot_frames);
    }
}
