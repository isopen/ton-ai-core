use std::fs::read;
use std::time::Instant;

fn main() {
    let paths: Vec<String> = std::env::args().skip(1).collect();
    let mut t_parse = 0.0f64;
    let mut t_drop_tree = 0.0f64;
    let mut t_total = 0.0f64;
    let mut t_drop_model = 0.0f64;
    let mut n = 0usize;
    for path in &paths {
        let data = match read(path) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let json = match tgs::inflate_tgs(&data) {
            Ok(j) => j,
            Err(_) => continue,
        };
        let t = Instant::now();
        let v = tgs::json::parse(&json).expect("parse");
        t_parse += t.elapsed().as_secs_f64() * 1000.0;
        let t = Instant::now();
        drop(v);
        t_drop_tree += t.elapsed().as_secs_f64() * 1000.0;
        let t = Instant::now();
        let anim = tgs::parse_tgs(&json, None).expect("model");
        t_total += t.elapsed().as_secs_f64() * 1000.0;
        let t = Instant::now();
        drop(anim);
        t_drop_model += t.elapsed().as_secs_f64() * 1000.0;
        n += 1;
    }
    let f = |x: f64| x / n.max(1) as f64;
    println!(
        "files={} parse={:.3} drop_tree={:.3} parse_tgs={:.3} drop_model={:.3}",
        n,
        f(t_parse),
        f(t_drop_tree),
        f(t_total),
        f(t_drop_model)
    );
}
