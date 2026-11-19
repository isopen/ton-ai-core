use std::collections::HashMap;
use std::fs::read;
use std::time::Instant;

fn main() {
    #[cfg(feature = "prof")]
    {
        if std::env::var("TGS_SKIP_DRAW").is_ok() {
            tgs::set_skip_draw(true);
        }
        if std::env::var("TGS_SKIP_RASTER").is_ok() {
            tgs::set_skip_raster(true);
        }
        if std::env::var("TGS_SKIP_WALK").is_ok() {
            tgs::set_skip_walk(true);
        }
        if std::env::var("TGS_SKIP_SINK").is_ok() {
            tgs::set_skip_sink(true);
        }
        if std::env::var("TGS_SKIP_FRESH").is_ok() {
            tgs::set_skip_fresh(true);
        }
    }
    let list_path = std::env::args().nth(1).expect("list");
    let size: u32 = std::env::args().nth(2).and_then(|s| s.parse().ok()).unwrap_or(64);
    let frames: usize = std::env::args().nth(3).and_then(|s| s.parse().ok()).unwrap_or(30);
    let dump_prof = std::env::var("AGG_PROF").is_ok();
    let text = std::fs::read_to_string(&list_path).expect("list read");
    let mut total = 0.0f64;
    let mut rendered = 0usize;
    let mut failures = 0usize;
    let mut packs: HashMap<String, f64> = HashMap::new();
    let mut files: Vec<(String, f64)> = Vec::new();
    for path in text.split('"').filter(|s| s.ends_with(".tgs")) {
        let data = match read(path) {
            Ok(d) => d,
            Err(_) => {
                failures += 1;
                continue;
            }
        };
        let json = match tgs::inflate_tgs(&data) {
            Ok(j) => j,
            Err(_) => {
                failures += 1;
                continue;
            }
        };
        let anim = match tgs::parse_tgs(&json, None) {
            Ok(a) => a,
            Err(_) => {
                failures += 1;
                continue;
            }
        };
        let mut inst = tgs::render::RenderInstance::new(anim);
        let mut pix = tgs::rast::PixBuf::new(size, size).expect("pix");
        let ip = inst.anim.in_frame;
        let fc = ((inst.anim.out_frame - inst.anim.in_frame).ceil() as usize).max(1);
        let n = fc.min(frames);
        inst.render_frame_into(&mut pix, ip);
        let t0 = Instant::now();
        for f in 0..n {
            inst.render_frame_into(&mut pix, ip + (f % fc) as f64);
        }
        let ms = t0.elapsed().as_secs_f64() * 1000.0;
        total += ms;
        rendered += 1;
        let mut it = path.rsplit('/');
        let name = it.next().unwrap_or(path).to_string();
        let pack = it.next().unwrap_or("-").to_string();
        *packs.entry(pack.clone()).or_insert(0.0) += ms;
        files.push((format!("{}/{}", pack, name), ms));
    }
    let mut pr: Vec<(String, f64)> = packs.into_iter().collect();
    pr.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    files.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    println!("files={} failures={} total={:.2}ms", rendered, failures, total);
    println!("--packs");
    for (p, ms) in pr.iter().take(15) {
        println!("{:<40} {:>10.2}  {:>5.2}%", p, ms, 100.0 * ms / total);
    }
    println!("--files");
    for (p, ms) in files.iter().take(15) {
        println!("{:<40} {:>10.2}", p, ms);
    }
    if dump_prof {
        tgs::prof::dump();
    }
}
