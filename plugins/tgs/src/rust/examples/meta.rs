use std::fs::read;

fn main() {
    for path in std::env::args().skip(1) {
        let data = match read(&path) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let json = match tgs::inflate_tgs(&data) {
            Ok(j) => j,
            Err(_) => continue,
        };
        let anim = match tgs::parse_tgs(&json, None) {
            Ok(a) => a,
            Err(_) => continue,
        };
        let base = path.rsplit(|c| c == '/' || c == '\\').next().unwrap_or(&path);
        println!(
            "{} in={} out={} layers={} assets={} static={}",
            base,
            anim.in_frame,
            anim.out_frame,
            anim.layers.len(),
            anim.assets.len(),
            tgs::is_frame_invariant(&anim)
        );
    }
}
