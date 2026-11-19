use std::fs::read;
use std::time::Instant;

#[repr(C)]
struct Ts {
    sec: i64,
    nsec: i64,
}

extern "C" {
    fn clock_gettime(clk: i32, tp: *mut Ts) -> i32;
}

const CLOCK_PROCESS_CPUTIME_ID: i32 = 2;

fn cpu_ns() -> u64 {
    let mut t = Ts { sec: 0, nsec: 0 };
    unsafe {
        clock_gettime(CLOCK_PROCESS_CPUTIME_ID, &mut t);
    }
    (t.sec as u64) * 1_000_000_000 + (t.nsec as u64)
}

fn env_num<T: std::str::FromStr>(name: &str, def: T) -> T {
    std::env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(def)
}

fn main() {
    let size: u32 = env_num("RB_SIZE", 64);
    let frames_max: usize = env_num("RB_FRAMES", 30);
    #[cfg(feature = "prof")]
    {
        let flag = |name: &str| std::env::var(name).is_ok();
        tgs::set_skip_paint(flag("RB_SKIP_PAINT"));
        tgs::set_skip_raster(flag("RB_SKIP_RASTER"));
        tgs::set_skip_draw(flag("RB_SKIP_DRAW"));
    }
    let paths: Vec<String> = std::env::args().skip(1).collect();
    if paths.is_empty() {
        eprintln!("usage: native_render_bench [-] file.tgs [file.tgs...]  (RB_SIZE=64 RB_FRAMES=30)");
        std::process::exit(2);
    }
    let mut total_load = 0.0f64;
    let mut total_render = 0.0f64;
    let mut total_cpu = 0.0f64;
    let mut total_frames = 0usize;
    for path in &paths {
        let data = match read(path) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("[rb] read failed {}: {}", path, e);
                continue;
            }
        };
        let json = match tgs::inflate_tgs(&data) {
            Ok(j) => j,
            Err(e) => {
                eprintln!("[rb] inflate failed {}: {}", path, e.0);
                continue;
            }
        };
        let t0 = Instant::now();
        let anim = match tgs::parse_tgs(&json, None) {
            Ok(a) => a,
            Err(e) => {
                eprintln!("[rb] parse failed {}: {}", path, e.0);
                continue;
            }
        };
        let mut inst = tgs::render::RenderInstance::new(anim);
        let mut pix = tgs::rast::PixBuf::new(size, size).expect("pixmap");
        let load_ms = t0.elapsed().as_secs_f64() * 1000.0;
        let ip = inst.anim.in_frame;
        let fc = ((inst.anim.out_frame - inst.anim.in_frame).ceil() as usize).max(1);
        let n = fc.min(frames_max);
        let c0 = cpu_ns();
        let t1 = Instant::now();
        let mut alpha_px = 0u64;
        let dbg_alpha = std::env::var("RB_DBG_ALPHA").is_ok();
        for f in 0..n {
            inst.render_frame_into(&mut pix, ip + f as f64);
            if dbg_alpha {
                alpha_px += pix.data().chunks_exact(4).filter(|p| p[3] != 0).count() as u64;
            }
        }
        let render_ms = t1.elapsed().as_secs_f64() * 1000.0;
        let cpu_ms = (cpu_ns() - c0) as f64 / 1_000_000.0;
        total_load += load_ms;
        total_render += render_ms;
        total_cpu += cpu_ms;
        total_frames += n;
        let fms = if render_ms > 0.0 { n as f64 / render_ms } else { 0.0 };
        if dbg_alpha && n > 0 {
            eprintln!("[rb] alpha px/frame {:.0}", alpha_px as f64 / n as f64);
        }
        let base = path.rsplit(|c| c == '/' || c == '\\').next().unwrap_or(path);
        println!(
            "[rb] {:<42} load {:7.2}ms  render {:8.2}ms  cpu {:8.2}ms  frames {:>3}  fms {:5.2}  bytes {:>7}",
            base,
            load_ms,
            render_ms,
            cpu_ms,
            n,
            fms,
            data.len()
        );
    }
    if total_render > 0.0 && total_frames > 0 {
        println!(
            "[rb] TOTAL files={} frames={} load={:.2}ms render={:.2}ms cpu={:.2}ms fms={:.2}",
            paths.len(),
            total_frames,
            total_load,
            total_render,
            total_cpu,
            total_frames as f64 / total_render
        );
    }
    tgs::prof::dump();
}
