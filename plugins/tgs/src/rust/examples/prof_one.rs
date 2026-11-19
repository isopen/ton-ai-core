use std::fs::read;
use std::time::Instant;

fn main() {
    let path = std::env::args().nth(1).expect("file");
    let size: u32 = std::env::args().nth(2).and_then(|s| s.parse().ok()).unwrap_or(320);
    let frames: usize = std::env::args().nth(3).and_then(|s| s.parse().ok()).unwrap_or(60);
    let data = read(&path).expect("read");
    let json = tgs::inflate_tgs(&data).expect("inflate");
    let anim = tgs::parse_tgs(&json, None).expect("parse");
    let mut inst = tgs::render::RenderInstance::new(anim);
    let mut pix = tgs::rast::PixBuf::new(size, size).expect("pix");
    let ip = inst.anim.in_frame;
    let fc = ((inst.anim.out_frame - inst.anim.in_frame).ceil() as usize).max(1);
    inst.render_frame_into(&mut pix, ip);
    let t0 = Instant::now();
    for f in 0..frames {
        inst.render_frame_into(&mut pix, ip + (f % fc) as f64);
    }
    let ms = t0.elapsed().as_secs_f64() * 1000.0;
    println!("{:.3} ms/fr", ms / frames as f64);
}
