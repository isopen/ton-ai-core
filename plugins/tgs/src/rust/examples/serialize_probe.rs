use std::fs::read;

fn main() {
    for path in std::env::args().skip(1) {
        let raw = read(&path).expect("read");
        let json = match tgs::inflate::inflate_tgs(&raw) {
            Ok(v) => v,
            Err(e) => {
                println!("[probe] {} GZIP-ERR {:?}", path, e);
                continue;
            }
        };
        match tgs::parser::parse_tgs(&json, None) {
            Ok(anim) => match tgs::serialize::serialize_animation(&anim) {
                Ok(s) => println!("[probe] {} OK len={}", path, s.len()),
                Err(()) => println!("[probe] {} SERIALIZE-ERR", path),
            },
            Err(e) => println!("[probe] {} PARSE-ERR {:?}", path, e),
        }
    }
}
