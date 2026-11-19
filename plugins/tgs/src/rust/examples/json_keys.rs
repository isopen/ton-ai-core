use std::collections::HashMap;
use std::fs::read;
use tgs::json::Value;

const USED: &str = "a ao assets bm c cm d ddd dr e ef eo f fc fr g h hd i id ind inv ip ir is it ix j k ks layers lc lh lj ls m markers masksProperties ml mm mn mode n nm o op or os p parent pt r rd refId s sa sc sh shapes sk so sr st sw sy t td tgs ti tm to tr tt ty u v w x y";

fn size(v: &Value) -> usize {
    match v {
        Value::Null | Value::Bool(_) => 1,
        Value::Number(_) => 1,
        Value::Nums(n) => n.len() + 1,
        Value::String(s) => s.len() + 1,
        Value::Array(a) => a.iter().map(size).sum::<usize>() + 1,
        Value::Object(m) => m.iter().map(|(k, x)| k.len() + 1 + size(x)).sum::<usize>() + 1,
    }
}

fn walk(v: &Value, agg: &mut HashMap<String, (usize, usize)>) {
    match v {
        Value::Array(a) => {
            for x in a {
                walk(x, agg);
            }
        }
        Value::Object(o) => {
            for (k, x) in o.iter() {
                let e = agg.entry(k.to_string()).or_insert((0, 0));
                e.0 += 1;
                e.1 += size(x);
                walk(x, agg);
            }
        }
        _ => {}
    }
}

fn main() {
    let used: std::collections::HashSet<&str> = USED.split(' ').collect();
    let paths: Vec<String> = std::env::args().skip(1).collect();
    let mut agg: HashMap<String, (usize, usize)> = HashMap::new();
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
        walk(&v, &mut agg);
    }
    let mut rows: Vec<_> = agg.into_iter().collect();
    rows.sort_by(|a, b| b.1 .1.cmp(&a.1 .1));
    let total: usize = rows.iter().map(|r| r.1 .1).sum();
    for (k, (n, s)) in rows.iter().take(30) {
        println!(
            "{:16} used={} entries={:6} bytes={:8} ({:5.2}%)",
            k,
            used.contains(k.as_str()),
            n,
            s,
            *s as f64 * 100.0 / total as f64
        );
    }
    let unused: usize = rows.iter().filter(|(k, _)| !used.contains(k.as_str())).map(|r| r.1 .1).sum();
    println!("total={} unused_share={:.2}%", total, unused as f64 * 100.0 / total as f64);
}
