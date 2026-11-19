use std::fs::read;
use tgs::json::Value;

fn walk(v: &Value, e: &mut [usize; 4]) {
    match v {
        Value::Array(a) => {
            if a.is_empty() {
                e[0] += 1;
            } else if a.len() == 1 {
                e[1] += 1;
            }
            for x in a {
                walk(x, e);
            }
        }
        Value::Object(m) => {
            if m.is_empty() {
                e[2] += 1;
            } else if m.len() == 1 {
                e[3] += 1;
            }
            for (_, x) in m.iter() {
                walk(x, e);
            }
        }
        _ => {}
    }
}

fn main() {
    let paths: Vec<String> = std::env::args().skip(1).collect();
    let mut n = 0usize;
    let mut e = [0usize; 4];
    for path in &paths {
        let data = match read(path) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let json = match tgs::inflate_tgs(&data) {
            Ok(j) => j,
            Err(_) => continue,
        };
        let v = match tgs::json::parse(&json) {
            Ok(v) => v,
            Err(_) => continue,
        };
        walk(&v, &mut e);
        n += 1;
    }
    println!(
        "files={} emptyArr={:.0} oneArr={:.0} emptyObj={:.0} oneObj={:.0}",
        n,
        e[0] as f64 / n as f64,
        e[1] as f64 / n as f64,
        e[2] as f64 / n as f64,
        e[3] as f64 / n as f64
    );
}
