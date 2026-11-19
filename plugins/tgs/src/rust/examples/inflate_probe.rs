use std::fs::read;

fn main() {
    let raw_path = std::env::args().nth(1).expect("path");
    let out_path = std::env::args().nth(2).expect("out path");
    let raw = read(raw_path).expect("read raw");
    let want = read(out_path).expect("read out");
    match tgs::inflate::inflate_deflate(&raw) {
        Ok((got, _bits)) => {
            if got == want {
                println!("OK len={}", got.len());
            } else {
                let n = got.len().min(want.len());
                let mut i = 0;
                while i < n && got[i] == want[i] {
                    i += 1;
                }
                if i < n {
                    println!("MISMATCH at {} got={} want={} (gotb {} wantb {})", i, got.len(), want.len(), got[i], want[i]);
                } else {
                    println!("LEN-MISMATCH got={} want={}", got.len(), want.len());
                }
            }
        }
        Err(()) => println!("ERR"),
    }
}
