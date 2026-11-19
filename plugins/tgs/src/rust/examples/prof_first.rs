use std::fs::read;
use std::time::Instant;

fn main() {
    let path = std::env::args().nth(1).expect("file");
    let size: u32 = std::env::args().nth(2).and_then(|s| s.parse().ok()).unwrap_or(320);
    let data = read(&path).expect("read");
    let json = tgs::inflate_tgs(&data).expect("inflate");
    let anim = tgs::parse_tgs(&json, None).expect("parse");
    let mut inst = tgs::render::RenderInstance::new(anim);
    let mut pix = tgs::rast::PixBuf::new(size, size).expect("pix");
    let ip = inst.anim.in_frame;
    tgs::prof::reset();
    let t0 = Instant::now();
    inst.render_frame_into(&mut pix, ip);
    let ms = t0.elapsed().as_secs_f64() * 1000.0;
    println!("file={} {:.4} ms first", path, ms);
    for (v, name) in tgs::prof::totals().iter() {
        if *v > 0.0 {
            println!("  {:>12} {:.4}", name, v);
        }
    }
}
