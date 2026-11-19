use std::cell::RefCell;
use std::fs::read;
thread_local! { static ARR: RefCell<[usize;7]> = const { RefCell::new([0usize;7]) }; }
use std::time::Instant;
use tgs::json::Value;

fn walk(v: &Value, acc: &mut [usize; 6]) {
    match v {
        Value::Null => acc[0] += 1,
        Value::Bool(_) => acc[1] += 1,
        Value::Number(_) => acc[2] += 1,
        Value::Nums(n) => {
            acc[2] += n.len();
        }
        Value::String(_) => acc[3] += 1,
        Value::Array(a) => {
            acc[4] += 1;
            acc[5] += a.len();
            let b = match a.len() {
                0..=2 => 0,
                3..=4 => 1,
                5..=8 => 2,
                9..=16 => 3,
                17..=64 => 4,
                65..=256 => 5,
                _ => 6,
            };
            ARR.with(|c| c.borrow_mut()[b] += 1);
            for x in a {
                walk(x, acc);
            }
        }
        Value::Object(m) => {
            acc[4] += 1;
            acc[5] += m.len();
            for (_, val) in m.iter() {
                walk(val, acc);
            }
        }
    }
}

fn main() {
    sizes();
    let paths: Vec<String> = std::env::args().skip(1).collect();
    let mut total = [0usize; 6];
    let mut ms = 0.0f64;
    let mut n = 0usize;
    let mut bytes = 0usize;
    let mut obj_sizes: std::collections::BTreeMap<usize, usize> = std::collections::BTreeMap::new();
    for path in &paths {
        let data = match read(path) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let json = match tgs::inflate_tgs(&data) {
            Ok(j) => j,
            Err(_) => continue,
        };
        bytes += json.len();
        let t0 = Instant::now();
        let v = match tgs::json::parse(&json) {
            Ok(v) => v,
            Err(_) => continue,
        };
        ms += t0.elapsed().as_secs_f64() * 1000.0;
        let mut acc = [0usize; 6];
        walk(&v, &mut acc);
        collect_objects(&v, &mut obj_sizes);
        for i in 0..6 {
            total[i] += acc[i];
        }
        n += 1;
    }
    let per = |x: usize| x as f64 / n.max(1) as f64;
    println!(
        "files={} avgKB={} parse={:.3}ms/file null={:.0} bool={:.0} num={:.0} str={:.0} containers={:.0} entries={:.0}",
        n,
        bytes / n.max(1) / 1024,
        ms / n.max(1) as f64,
        per(total[0]),
        per(total[1]),
        per(total[2]),
        per(total[3]),
        per(total[4]),
        per(total[5])
    );
    let mut buckets = [0usize; 6];
    let mut maxsz = 0;
    for (&k, &c) in &obj_sizes {
        maxsz = maxsz.max(k);
        let b = match k {
            0..=2 => 0,
            3..=4 => 1,
            5..=8 => 2,
            9..=16 => 3,
            17..=64 => 4,
            _ => 5,
        };
        buckets[b] += c;
    }
    ARR.with(|c| {
        let a = c.borrow();
        println!("arrays by size 0-2 {} 3-4 {} 5-8 {} 9-16 {} 17-64 {} 65-256 {} >256 {}", a[0], a[1], a[2], a[3], a[4], a[5], a[6]);
    });
    println!("objects by size 0-2 {} 3-4 {} 5-8 {} 9-16 {} 17-64 {} >64 {} max={}", buckets[0], buckets[1], buckets[2], buckets[3], buckets[4], buckets[5], maxsz);
}

fn collect_objects(v: &Value, m: &mut std::collections::BTreeMap<usize, usize>) {
    match v {
        Value::Array(a) => {
            for x in a {
                collect_objects(x, m);
            }
        }
        Value::Object(o) => {
            *m.entry(o.len()).or_insert(0) += 1;
            for (_, val) in o.iter() {
                collect_objects(val, m);
            }
        }
        _ => {}
    }
}

#[allow(dead_code)]
fn sizes() {
    println!(
        "size Value={} JsonStr={} MapEntry={}",
        std::mem::size_of::<Value>(),
        std::mem::size_of::<tgs::json::JsonStr>(),
        std::mem::size_of::<(tgs::json::JsonStr, Value)>()
    );
}
