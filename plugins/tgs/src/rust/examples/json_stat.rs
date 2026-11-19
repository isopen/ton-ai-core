use std::fs::read;
use std::time::Instant;
use tgs::json::Value;

fn walk(v: &Value, strings: &mut usize, short: &mut usize, long: &mut usize, bytes: &mut usize) {
    match v {
        Value::Null | Value::Bool(_) => {}
        Value::Number(_) => {}
        Value::Nums(_) => {}
        Value::String(s) => {
            *strings += 1;
            *bytes += s.len();
            if s.len() <= 22 {
                *short += 1;
            } else {
                *long += 1;
            }
        }
        Value::Array(a) => {
            for x in a {
                walk(x, strings, short, long, bytes);
            }
        }
        Value::Object(m) => {
            for (k, val) in m.iter() {
                *strings += 1;
                *bytes += k.len();
                if k.len() <= 22 {
                    *short += 1;
                } else {
                    *long += 1;
                }
                walk(val, strings, short, long, bytes);
            }
        }
    }
}

fn main() {
    let paths: Vec<String> = std::env::args().skip(1).collect();
    let mut total = (0usize, 0usize, 0usize, 0usize);
    let mut ms = 0.0f64;
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
        let t0 = Instant::now();
        let v = tgs::json::parse(&json).expect("parse");
        ms += t0.elapsed().as_secs_f64() * 1000.0;
        n += 1;
        walk(&v, &mut total.0, &mut total.1, &mut total.2, &mut total.3);
    }
    println!(
        "files={} parse={:.2}ms/files strings={} short(<=22)={} long={} avg_len={:.1} strbytes/file={}",
        n,
        ms / n as f64,
        total.0 / n,
        total.1 / n,
        total.2 / n,
        total.3 as f64 / total.0 as f64,
        total.3 / n
    );
}
