use std::fs::read;
use std::sync::atomic::{AtomicUsize, Ordering};

const MAX_SAMPLES: usize = 262144;
static SAMPLES: [AtomicUsize; MAX_SAMPLES] = {
    #[allow(unused_mut)]
    let mut a = [const { AtomicUsize::new(0) }; MAX_SAMPLES];
    a
};
static NSAMPLES: AtomicUsize = AtomicUsize::new(0);

const SIGPROF: i32 = 27;
const ITIMER_PROF: i32 = 2;

#[repr(C)]
struct Timeval {
    sec: i64,
    usec: i64,
}
#[repr(C)]
struct Itimerval {
    interval: Timeval,
    value: Timeval,
}

#[cfg(target_os = "linux")]
unsafe extern "C" {
    fn setitimer(which: i32, new: *const Itimerval, old: *mut Itimerval) -> i32;
    fn sigaction(sig: i32, act: *const SigAction, old: *mut SigAction) -> i32;
}

#[repr(C)]
struct SigAction {
    handler: usize,
    mask: [u64; 16],
    flags: i32,
    restorer: usize,
}

static mut SAMPLE_BUF: [u64; MAX_SAMPLES] = [0; MAX_SAMPLES];

unsafe extern "C" fn handler(_sig: i32, _info: *mut u8, uctx: *mut u8) {
    unsafe {
        let rip = *(uctx.add(168) as *const u64);
        let idx = NSAMPLES.load(Ordering::Relaxed);
        if idx < MAX_SAMPLES {
            SAMPLE_BUF[idx] = rip;
            NSAMPLES.store(idx + 1, Ordering::Relaxed);
        }
    }
}

fn main() {
    let rounds: u32 = std::env::var("SB_ROUNDS").ok().and_then(|v| v.parse().ok()).unwrap_or(40);
    let paths: Vec<String> = std::env::args().skip(1).collect();
    if paths.is_empty() {
        eprintln!("usage: sampler_bench file.tgs [file.tgs...]");
        std::process::exit(2);
    }
    let mut frames_total = 0usize;
    let mut prepared: Vec<(tgs::render::RenderInstance, u32, u32, f64)> = Vec::new();
    for _ in 0..rounds.max(1) {
        for path in &paths {
            let data = match read(path) {
                Ok(d) => d,
                Err(_) => continue,
            };
            let json = match tgs::inflate_tgs(&data) {
                Ok(j) => j,
                Err(_) => continue,
            };
            let anim = match tgs::parse_tgs(&json, None) {
                Ok(a) => a,
                Err(_) => continue,
            };
            let ip = anim.in_frame;
            let fc = ((anim.out_frame - anim.in_frame).ceil() as usize).max(1);
            let sc = 64.0 / anim.width.max(anim.height).max(1.0);
            let w = ((anim.width * sc).round().max(1.0)) as u32;
            let h = ((anim.height * sc).round().max(1.0)) as u32;
            prepared.push((tgs::render::RenderInstance::new(anim), w, h, ip));
        }
        if std::env::var("SB_RENDER_ONLY").is_ok() {
            break;
        }
    }
    if prepared.is_empty() {
        eprintln!("no files loaded");
        std::process::exit(1);
    }
    if std::env::var("SB_NOCACHE").is_ok() {
        tgs::cache_all_off(true);
    }
    unsafe {
        let act = SigAction {
            handler: handler as usize,
            mask: [0; 16],
            flags: 0x10000000 | 0x00000004,
            restorer: 0,
        };
        sigaction(SIGPROF, &act, std::ptr::null_mut());
        let it = Itimerval {
            interval: Timeval { sec: 0, usec: 200 },
            value: Timeval { sec: 0, usec: 200 },
        };
        setitimer(ITIMER_PROF, &it, std::ptr::null_mut());
    }
    let rounds_render = if std::env::var("SB_RENDER_ONLY").is_ok() { rounds } else { rounds };
    for _ in 0..rounds_render {
        for (inst, w, h, ip) in prepared.iter_mut() {
            let mut pix = tgs::rast::PixBuf::new(*w, *h).unwrap();
            let fc = if std::env::var("SB_RENDER_ONLY").is_ok() {
                std::env::var("SB_FRAMES").ok().and_then(|v| v.parse().ok()).unwrap_or(90)
            } else {
                1
            };
            for f in 0..fc {
                inst.render_frame_into(&mut pix, *ip + f as f64);
                frames_total += 1;
            }
        }
    }
    unsafe {
        let it = Itimerval { interval: Timeval { sec: 0, usec: 0 }, value: Timeval { sec: 0, usec: 0 } };
        setitimer(ITIMER_PROF, &it, std::ptr::null_mut());
    }
    let n = NSAMPLES.load(Ordering::Relaxed);
    let base = std::fs::read_to_string("/proc/self/maps")
        .ok()
        .and_then(|m| m.lines().next().and_then(|l| l.split('-').next().and_then(|h| u64::from_str_radix(h, 16).ok())))
        .unwrap_or(0);
    eprintln!("frames={} samples={} base={:x}", frames_total, n, base);
    eprintln!("BASE={:x}", base);
    let mut ips: std::collections::HashMap<u64, usize> = std::collections::HashMap::new();
    for i in 0..n {
        let rip = unsafe { SAMPLE_BUF[i] };
        if rip > 0x400000 {
            *ips.entry(rip.wrapping_sub(base)).or_insert(0) += 1;
        }
    }
    let mut v: Vec<(u64, usize)> = ips.into_iter().collect();
    v.sort_by(|a, b| b.1.cmp(&a.1));
    for (rip, cnt) in v.iter().take(100000) {
        println!("{:x} {}", rip, cnt);
    }
    if std::env::var("SB_PROF").is_ok() {
        tgs::prof::dump();
    }
}
