use std::fs::read;
use std::hash::{Hash, Hasher};

fn main() {
    let paths: Vec<String> = std::env::args().skip(1).collect();
    for path in &paths {
        let data = match read(path) {
            Ok(d) => d,
            Err(_) => {
                println!("{path} ERR read");
                continue;
            }
        };
        let json = match tgs::inflate_tgs(&data) {
            Ok(j) => j,
            Err(_) => {
                println!("{path} ERR inflate");
                continue;
            }
        };
        match tgs::parse_tgs(&json, None) {
            Ok(anim) => match tgs::serialize::serialize_animation(&anim) {
                Ok(s) => {
                    let mut h = std::collections::hash_map::DefaultHasher::new();
                    s.hash(&mut h);
                    println!("{path} {:016x} {}", h.finish(), s.len());
                }
                Err(_) => println!("{path} ERR serialize"),
            },
            Err(_) => println!("{path} ERR parse"),
        }
    }
}
