use std::fs::read;
use std::time::Instant;

fn main() {
    let size: u32 = std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(320);
    for path in std::env::args().skip(2) {
        let data = match read(&path) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let json = match tgs::inflate_tgs(&data) {
            Ok(j) => j,
            Err(_) => continue,
        };
        let t0 = Instant::now();
        let anim = match tgs::parse_tgs(&json, None) {
            Ok(a) => a,
            Err(_) => continue,
        };
        let tp = t0.elapsed().as_secs_f64() * 1000.0;
        let t1 = Instant::now();
        let mut inst = tgs::render::RenderInstance::new(anim);
        let ti = t1.elapsed().as_secs_f64() * 1000.0;
        let mut pix = tgs::rast::PixBuf::new(size, size).unwrap();
        let t2 = Instant::now();
        inst.render_frame_into(&mut pix, inst.anim.in_frame);
        let tf = t2.elapsed().as_secs_f64() * 1000.0;
        println!("{:.3}\t{:.3}\t{:.3}\t{}", tp, ti, tf, path);
    }
}
