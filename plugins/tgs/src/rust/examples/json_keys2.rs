use std::fs::read;
use tgs::json::Value;

fn walk(v: &Value, c: &mut [usize; 12]) {
    match v {
        Value::Array(a) => {
            for x in a {
                walk(x, c);
            }
        }
        Value::Object(m) => {
            if let Some(Value::Array(k)) = m.get("k") {
                for kf in k {
                    if let Value::Object(ko) = kf {
                        if let Some(Value::Array(t)) = ko.get("t") {
                            c[0] += 1;
                            match t.len() {
                                1 => c[1] += 1,
                                2 => c[2] += 1,
                                _ => c[3] += 1,
                            }
                        }
                        for key in ["o", "i"] {
                            if let Some(Value::Object(d)) = ko.get(key) {
                                c[4] += 1;
                                for axis in ["x", "y"] {
                                    if let Some(Value::Array(a)) = d.get(axis) {
                                        match a.len() {
                                            1 => c[5] += 1,
                                            2 => c[6] += 1,
                                            _ => c[7] += 1,
                                        }
                                    }
                                }
                            }
                        }
                        for key in ["to", "ti"] {
                            if let Some(Value::Array(a)) = ko.get(key) {
                                c[8] += 1;
                                match a.len() {
                                    1 => c[9] += 1,
                                    2 => c[10] += 1,
                                    _ => c[11] += 1,
                                }
                            }
                        }
                    }
                }
            }
            for (_, x) in m.iter() {
                walk(x, c);
            }
        }
        _ => {}
    }
}

fn main() {
    let paths: Vec<String> = std::env::args().skip(1).collect();
    let mut n = 0usize;
    let mut c = [0usize; 12];
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
        walk(&v, &mut c);
        n += 1;
    }
    let f = |x: usize| x as f64 / n as f64;
    println!(
        "files={} kfs={:.0} t1={:.0} t2={:.0} tN={:.0} | bez={:.0} oxy1={:.0} oxy2={:.0} oxyN={:.0} | to={:.0} to1={:.0} to2={:.0} toN={:.0}",
        n, f(c[0]), f(c[1]), f(c[2]), f(c[3]), f(c[4]), f(c[5]), f(c[6]), f(c[7]), f(c[8]), f(c[9]), f(c[10]), f(c[11])
    );
}
