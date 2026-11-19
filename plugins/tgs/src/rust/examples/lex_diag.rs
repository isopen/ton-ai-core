use std::fs::read;

fn main() {
    for path in std::env::args().skip(1) {
        let data = match read(&path) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let json = match tgs::inflate_tgs(&data) {
            Ok(j) => j,
            Err(e) => {
                println!("{} inflate err {}", path, e.0);
                continue;
            }
        };
        let n = json.len();
        match tgs::json::parse(&json) {
            Ok(_) => println!("{} lex OK len={}", path, n),
            Err(_) => {
                println!("{} lex FAIL len={}", path, n);
                let mut lo = 0usize;
                let mut hi = n;
                while lo < hi {
                    let mid = (lo + hi) / 2;
                    let mut trimmed = mid;
                    while trimmed < n {
                        let c = json.as_bytes()[trimmed];
                        if c == b'{' || c == b'[' || c == b'"' || c == b',' || c == b'}' || c == b']' {
                            break;
                        }
                        trimmed += 1;
                    }
                    if tgs::json::parse(&json[..trimmed]).is_ok() {
                        lo = trimmed + 1;
                    } else {
                        hi = trimmed;
                    }
                }
                let s = lo.saturating_sub(60);
                let e = (lo + 60).min(n);
                println!("  fail near offset {} near={:?}", lo, &json[s..e]);
            }
        }
    }
}
