use std::fs::read;
use std::time::Instant;

fn main() {
    let paths: Vec<String> = std::env::args().skip(1).collect();
    let reps: usize = 15;
    let mut total = 0.0f64;
    for path in &paths {
        let data = match read(path) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let json = match tgs::inflate_tgs(&data) {
            Ok(j) => j,
            Err(_) => continue,
        };
        let mut best = f64::INFINITY;
        let mut sink = 0usize;
        for _ in 0..reps {
            let t = Instant::now();
            let a = tgs::parse_tgs(&json, None).unwrap();
            let ms = t.elapsed().as_secs_f64() * 1000.0;
            sink += a.layers.len();
            if ms < best {
                best = ms;
            }
        }
        total += best;
        let name = path.rsplit('/').next().unwrap_or(path);
        println!("{:>22} bytes={:>7} parse={:8.3} sink={}", name, json.len(), best, sink & 1);
    }
    println!("TOTAL {:.3}", total);
}
