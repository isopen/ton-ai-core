use std::collections::HashSet;
use std::fs::read;
use tgs::json::Value;

const KEYS: &[&str] = &[
    "a", "ao", "assets", "bm", "c", "cm", "d", "ddd", "dr", "e", "ef", "eo", "f", "fc", "fr", "g", "h",
    "hd", "i", "id", "ind", "inv", "ip", "ir", "is", "it", "ix", "j", "k", "ks", "layers", "lc", "lh",
    "lj", "ls", "m", "markers", "masksProperties", "ml", "mm", "mn", "mode", "n", "nm", "o", "op", "or",
    "os", "p", "parent", "pt", "r", "rd", "refId", "s", "sa", "sc", "sh", "shapes", "sk", "so", "sr", "st",
    "sw", "sy", "t", "td", "tgs", "ti", "tm", "to", "tr", "tt", "ty", "u", "ut-r1", "v", "w", "x", "y",
];

fn containers(v: &Value) -> usize {
    match v {
        Value::Array(a) => 1 + a.iter().map(containers).sum::<usize>(),
        Value::Object(m) => 1 + m.iter().map(|(_, x)| containers(x)).sum::<usize>(),
        _ => 0,
    }
}

fn walk(v: &Value, keep: &HashSet<&str>, kept: &mut usize, skipped: &mut usize) {
    match v {
        Value::Array(a) => {
            *kept += 1;
            for x in a {
                walk(x, keep, kept, skipped);
            }
        }
        Value::Object(m) => {
            *kept += 1;
            for (k, x) in m.iter() {
                if keep.contains(k.as_str()) {
                    walk(x, keep, kept, skipped);
                } else {
                    *skipped += containers(x);
                }
            }
        }
        _ => {}
    }
}

fn main() {
    let keep: HashSet<&str> = KEYS.iter().copied().collect();
    let paths: Vec<String> = std::env::args().skip(1).collect();
    let mut kept = 0usize;
    let mut skipped = 0usize;
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
        walk(&v, &keep, &mut kept, &mut skipped);
        n += 1;
    }
    println!(
        "files={n} kept={:.0} skipped={:.0} skip_frac={:.3}",
        kept as f64 / n as f64,
        skipped as f64 / n as f64,
        skipped as f64 / (kept + skipped).max(1) as f64
    );
}
