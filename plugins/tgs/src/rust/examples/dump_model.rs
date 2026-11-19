use std::fs::read;

fn main() {
    let path = std::env::args().nth(1).expect("path");
    let data = read(&path).expect("read");
    let json = tgs::inflate_tgs(&data).expect("inflate");
    let anim = tgs::parse_tgs(&json, None).expect("parse");
    print!("{}", tgs::serialize::serialize_animation(&anim).expect("ser"));
}
