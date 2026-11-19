use std::fs::read;
use std::time::Instant;

fn main() {
    let paths: Vec<String> = std::env::args().skip(1).collect();
    let jsons: Vec<String> = paths
        .iter()
        .filter_map(|p| read(p).ok())
        .filter_map(|d| tgs::inflate_tgs(&d).ok())
        .collect();
    let mut best = f64::INFINITY;
    for it in 0..7 {
        let t = Instant::now();
        let mut ok = 0usize;
        for j in &jsons {
            if tgs::parse_tgs(j, None).is_ok() {
                ok += 1;
            }
        }
        let ms = t.elapsed().as_secs_f64() * 1000.0 / jsons.len() as f64;
        if ms < best {
            best = ms;
        }
        println!("run={} {:.4} ms/file ok={}", it, ms, ok);
    }
    println!("best={:.4} files={}", best, jsons.len());
}
