use std::fs::read;
use std::time::Instant;

fn main() {
    let size: u32 = std::env::var("CB_SIZE")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(512);
    let frames_max: usize = std::env::var("CB_FRAMES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(30);
    let paths: Vec<String> = std::env::args().skip(1).collect();
    if paths.is_empty() {
        eprintln!("usage: cov_probe file.tgs ... (CB_SIZE=512 CB_FRAMES=30)");
        std::process::exit(2);
    }
    for path in &paths {
        let data = match read(path) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("[cp] read failed {}: {}", path, e);
                continue;
            }
        };
        let json = match tgs::inflate_tgs(&data) {
            Ok(j) => j,
            Err(e) => {
                eprintln!("[cp] inflate failed {}: {}", path, e.0);
                continue;
            }
        };
        let anim = match tgs::parse_tgs(&json, None) {
            Ok(a) => a,
            Err(e) => {
                eprintln!("[cp] parse failed {}: {}", path, e.0);
                continue;
            }
        };
        let mut inst = tgs::render::RenderInstance::new(anim);
        let mut pix = tgs::rast::PixBuf::new(size, size).expect("pixmap");
        let ip = inst.anim.in_frame;
        let fc = ((inst.anim.out_frame - inst.anim.in_frame).ceil() as usize).max(1);
        let n = fc.min(frames_max);
        tgs::cov_cache_probe_reset();
        let t0 = Instant::now();
        for f in 0..n {
            inst.render_frame_into(&mut pix, ip + f as f64);
        }
        let ms = t0.elapsed().as_secs_f64() * 1000.0;
        let base = path.rsplit(|c| c == '/' || c == '\\').next().unwrap_or(path);
        println!(
            "[cp] {:<40} frames {:>3} ms {:>9.2}  {}",
            base,
            n,
            ms,
            tgs::cov_stats()
        );
    }
}
