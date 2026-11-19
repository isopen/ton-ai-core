use std::fs::read;
use std::time::Instant;

fn main() {
    let paths: Vec<String> = std::env::args().skip(1).collect();
    let size = 512u32;
    for path in &paths {
        let data = match read(path) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let json = match tgs::inflate_tgs(&data) {
            Ok(j) => j,
            Err(_) => {
                eprintln!("[x] inflate fail {}", path);
                continue;
            }
        };
        let t0 = Instant::now();
        let opts = tgs::ParseOptions { key: None, cache: false };
        let anim = match tgs::parse_tgs(&json, Some(opts)) {
            Ok(a) => a,
            Err(e) => {
                eprintln!("[x] parse fail {}: {}", path, e.0);
                continue;
            }
        };
        let _ms = t0.elapsed().as_secs_f64() * 1000.0;
        let mut inst = tgs::render::RenderInstance::new(anim);
        let mut pix = tgs::rast::PixBuf::new(size, size).expect("pixmap");
        let ip = inst.anim.in_frame;
        let fc = ((inst.anim.out_frame - inst.anim.in_frame).ceil() as usize).max(1);
        for f in 0..fc.min(30) {
            inst.render_frame_into(&mut pix, ip + f as f64);
        }
        eprintln!("[ok] {} frames={}", path, fc.min(30));
    }
}
