use std::fs::read;
use std::time::Instant;

fn env_num<T: std::str::FromStr>(name: &str, def: T) -> T {
    std::env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(def)
}

fn main() {
    let size: u32 = env_num("AC_SIZE", 64);
    let frames_max: usize = env_num("AC_FRAMES", 30);
    let paths: Vec<String> = std::env::args().skip(1).collect();
    if paths.is_empty() {
        eprintln!("usage: ab_cov file.tgs ... (AC_SIZE=64 AC_FRAMES=30)");
        std::process::exit(2);
    }
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
        let n = fc.min(frames_max);
        let mut best_on = f64::MAX;
        let mut best_off = f64::MAX;
        for rep in 0..3 {
            for off in [false, true] {
                tgs::cov_cache_all_off(off);
                let mut inst = tgs::render::RenderInstance::new(anim.clone());
                let mut pix = tgs::rast::PixBuf::new(size, size).expect("pixmap");
                for f in 0..n {
                    inst.render_frame_into(&mut pix, ip + f as f64);
                }
                let t0 = Instant::now();
                for f in 0..n {
                    inst.render_frame_into(&mut pix, ip + f as f64);
                }
                let ms = t0.elapsed().as_secs_f64() * 1000.0 / n as f64;
                if off {
                    if ms < best_off {
                        best_off = ms;
                    }
                } else if ms < best_on {
                    best_on = ms;
                }
            }
            let _ = rep;
        }
        tgs::cov_cache_all_off(false);
        let base = path.rsplit(|c| c == '/' || c == '\\').next().unwrap_or(path);
        println!(
            "[ac] {:<40} on {:7.3} ms/fr  off {:7.3} ms/fr  ratio {:5.2}",
            base,
            best_on,
            best_off,
            best_on / best_off
        );
    }
}
