use std::fs::read;
use tgs::json::Value;

fn walk(v: &Value, arr: &mut [usize; 9], obj: &mut [usize; 9], numarr: &mut [usize; 9]) {
    match v {
        Value::Array(a) => {
            arr[a.len().min(8)] += 1;
            if a.iter().all(|x| x.is_number()) {
                numarr[a.len().min(8)] += 1;
            }
            for x in a { walk(x, arr, obj, numarr); }
        }
        Value::Object(m) => {
            obj[m.len().min(8)] += 1;
            for (_, x) in m.iter() { walk(x, arr, obj, numarr); }
        }
        _ => {}
    }
}

fn main() {
    let paths: Vec<String> = std::env::args().skip(1).collect();
    let mut arr = [0usize; 9];
    let mut obj = [0usize; 9];
    let mut numarr = [0usize; 9];
    let mut n = 0usize;
    for path in &paths {
        let data = match read(path) { Ok(d) => d, Err(_) => continue };
        let json = match tgs::inflate_tgs(&data) { Ok(j) => j, Err(_) => continue };
        let v = match tgs::json::parse(&json) { Ok(v) => v, Err(_) => continue };
        walk(&v, &mut arr, &mut obj, &mut numarr);
        n += 1;
    }
    println!("files={n} arr={:?}", arr.map(|x| x / n));
    println!("files={n} obj={:?}", obj.map(|x| x / n));
    println!("files={n} numarr={:?}", numarr.map(|x| x / n));
}
