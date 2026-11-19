use std::fs::read;
use std::time::Instant;

fn main() {
    let paths: Vec<String> = std::env::args().skip(1).collect();
    let mut t_parse = 0.0f64;
    let mut t_clone = 0.0f64;
    let mut t_build = 0.0f64;
    let mut t_ser = 0.0f64;
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
        let v = match tgs::json::parse(&json) {
            Ok(v) => v,
            Err(_) => continue,
        };
        t_parse += t.elapsed().as_secs_f64() * 1000.0;
        let t = Instant::now();
        let c = v.clone();
        t_clone += t.elapsed().as_secs_f64() * 1000.0;
        drop(v);
        let t = Instant::now();
        let a = tgs::parse_tgs(&json, None).unwrap();
        t_build += t.elapsed().as_secs_f64() * 1000.0;
        let t = Instant::now();
        let s = tgs::serialize::serialize_animation(&a).unwrap();
        t_ser += t.elapsed().as_secs_f64() * 1000.0;
        drop(c);
        drop(s);
        n += 1;
    }
    let f = |x: f64| x / n.max(1) as f64;
    println!(
        "files={} parse={:.3} clone={:.3} parse_tgs={:.3} build_only={:.3} serialize={:.3}",
        n,
        f(t_parse),
        f(t_clone),
        f(t_build),
        f(t_build) - f(t_parse),
        f(t_ser)
    );
}
