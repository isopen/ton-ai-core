use std::collections::BTreeMap;
use std::fs::read;
use tgs::json::{write_value, Value};

fn nodes(v: &Value) -> usize {
    match v {
        Value::Array(a) => 1 + a.iter().map(nodes).sum::<usize>(),
        Value::Object(m) => 1 + m.iter().map(|(_, x)| nodes(x)).sum::<usize>(),
        _ => 1,
    }
}

fn main() {
    let paths: Vec<String> = std::env::args().skip(1).collect();
    let mut bytes: BTreeMap<String, usize> = BTreeMap::new();
    let mut cnt: BTreeMap<String, usize> = BTreeMap::new();
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
        let v = match tgs::json::parse(&json) {
            Ok(v) => v,
            Err(_) => continue,
        };
        n += 1;
        if let Value::Object(m) = &v {
            for (k, val) in m.iter() {
                let mut s = String::new();
                write_value(&mut s, val);
                *bytes.entry(k.to_string()).or_insert(0) += s.len();
                *cnt.entry(k.to_string()).or_insert(0) += nodes(val);
            }
        }
    }
    let mut rows: Vec<(String, usize, usize)> = bytes
        .into_iter()
        .map(|(k, b)| {
            let c = cnt.get(&k).copied().unwrap_or(0);
            (k, b, c)
        })
        .collect();
    rows.sort_by(|a, b| b.1.cmp(&a.1));
    println!("files={n}");
    for (k, b, c) in rows {
        println!("{k:24} bytes/file={:7.0} nodes/file={:6.0}", b as f64 / n as f64, c as f64 / n as f64);
    }
}
