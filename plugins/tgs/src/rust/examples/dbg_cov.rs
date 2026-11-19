use std::fs::read;

fn main() {
    let path = std::env::args().nth(1).unwrap();
    let data = read(&path).unwrap();
    let json = match tgs::inflate_tgs(&data) {
        Ok(j) => j,
        Err(_) => String::from_utf8(data.clone()).unwrap(),
    };
    let anim = tgs::parse_tgs(&json, None).unwrap();
    let mut inst = tgs::render::RenderInstance::new(anim);
    let mut pix = tgs::rast::PixBuf::new(256, 256).unwrap();
    tgs::cov_cache_probe_reset();
    for f in 0..10u32 {
        inst.render_frame_into(&mut pix, f as f64);
        println!("frame {:>2} {}", f, tgs::cov_stats());
    }
    let non = pix.data().iter().filter(|&&b| b != 0).count();
    println!("nonzero bytes: {}/{}", non, pix.data().len());
}
