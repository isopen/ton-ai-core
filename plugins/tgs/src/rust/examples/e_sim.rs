use std::fs::read;
use tgs::json::Value;

fn key_time(raw: &Value) -> f64 {
    let t = match raw.get("t") {
        Some(Value::Array(a)) => a.first(),
        other => other,
    };
    match t {
        Some(Value::Number(n)) => *n,
        _ => f64::INFINITY,
    }
}

fn key_time_exact(raw: &Value) -> Option<f64> {
    match raw.get("t") {
        Some(Value::Array(a)) if !a.is_empty() => match &a[0] {
            Value::Number(n) => Some(*n),
            _ => None,
        },
        Some(Value::Number(n)) => Some(*n),
        _ => None,
    }
}

fn unwrap(v: Value) -> Value {
    match v {
        Value::Array(mut a) if a.len() == 1 && (a[0].is_object() || a[0].is_null()) => a.swap_remove(0),
        other => other,
    }
}

struct K {
    s: Value,
    e_raw: Option<Value>,
    e_stored_old: Option<Value>,
    hold: bool,
}

fn walk(v: &Value, diffs: &mut usize, kf_lists: &mut usize) {
    match v {
        Value::Array(a) => {
            for x in a {
                walk(x, diffs, kf_lists);
            }
        }
        Value::Object(m) => {
            if let Some(Value::Array(items)) = m.get("k") {
                if items.iter().any(|it| it.is_object() && key_time_exact(it).is_some() && it.get("s").is_some()) {
                    *kf_lists += 1;
                    let mut ordered: Vec<(f64, Value)> = items.iter().cloned().map(|v| (key_time(&v), v)).collect();
                    ordered.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
                    let mut out: Vec<K> = Vec::new();
                    for (_, raw_) in ordered {
                        let mut raw = raw_;
                        if !raw.is_object() {
                            continue;
                        }
                        if key_time_exact(&raw).is_none() {
                            continue;
                        }
                        let s_val = raw.take("s");
                        if let Some(prev) = out.last_mut() {
                            if s_val.is_some() && raw.get("e").is_none() {
                                prev.e_stored_old = Some(unwrap(s_val.as_ref().unwrap().clone()));
                            }
                        }
                        let s = match s_val {
                            Some(s) => s,
                            None => continue,
                        };
                        let hold = matches!(raw.get("h"), Some(Value::Number(n)) if *n == 1.0);
                        let s_unwrapped = unwrap(s);
                        let e_raw = raw.take("e").map(unwrap);
                        let stored = if hold { Some(s_unwrapped.clone()) } else { e_raw.clone() };
                        out.push(K { s: s_unwrapped, e_raw, e_stored_old: stored, hold });
                    }
                    for i in 0..out.len() {
                        let kf = &out[i];
                        let old = if kf.hold {
                            Some(kf.s.clone())
                        } else {
                            match out.get(i + 1) {
                                Some(next) => {
                                    if next.e_raw.is_some() {
                                        kf.e_stored_old.clone()
                                    } else {
                                        Some(next.s.clone())
                                    }
                                }
                                None => kf.e_raw.clone(),
                            }
                        };
                        let new = if kf.hold {
                            Some(kf.s.clone())
                        } else {
                            match out.get(i + 1) {
                                Some(next) => {
                                    if next.e_raw.is_some() {
                                        kf.e_raw.clone()
                                    } else {
                                        Some(next.s.clone())
                                    }
                                }
                                None => kf.e_raw.clone(),
                            }
                        };
                        if old != new {
                            *diffs += 1;
                            if *diffs <= 8 {
                                println!("DIFF kf {i} hold={} old={:?} new={:?}", kf.hold, old, new);
                            }
                        }
                    }
                }
            }
            for (_, x) in m.iter() {
                walk(x, diffs, kf_lists);
            }
        }
        _ => {}
    }
}

fn main() {
    let path = std::env::args().nth(1).expect("path");
    let data = read(&path).expect("read");
    let json = tgs::inflate_tgs(&data).expect("inflate");
    let v = tgs::json::parse(&json).expect("parse");
    let mut diffs = 0;
    let mut lists = 0;
    walk(&v, &mut diffs, &mut lists);
    println!("lists={lists} diffs={diffs}");
}
