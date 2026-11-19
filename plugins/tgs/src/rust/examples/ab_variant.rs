use std::fs::read;

#[repr(C)]
struct Timespec {
    tv_sec: i64,
    tv_nsec: i64,
}

extern "C" {
    fn clock_gettime(clk_id: i32, tp: *mut Timespec) -> i32;
}

fn cpu_ms() -> f64 {
    let mut ts = Timespec { tv_sec: 0, tv_nsec: 0 };
    unsafe {
        clock_gettime(3, &mut ts);
    }
    ts.tv_sec as f64 * 1000.0 + ts.tv_nsec as f64 / 1.0e6
}

fn env_num<T: std::str::FromStr>(name: &str, def: T) -> T {
    std::env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(def)
}

fn main() {
    let size: u32 = env_num("AB_SIZE", 320);
    let frames_max: usize = env_num("AB_FRAMES", 30);
    let reps: usize = env_num("AB_REPS", 5);
    let warm: usize = env_num("AB_WARM", 2);
    let variants: Vec<u32> = std::env::var("AB_K").unwrap_or_else(|_| "2,4".into())
        .split(',').filter_map(|v| v.trim().parse().ok()).collect();
    let paths: Vec<String> = std::env::args().skip(1).collect();
    for path in &paths {
        let data = read(path).expect("read");
        let json = tgs::inflate_tgs(&data).expect("inflate");
        let anim = tgs::parse_tgs(&json, None).expect("parse");
        let ip = anim.in_frame;
        let fc = ((anim.out_frame - anim.in_frame).ceil() as usize).max(1);
        let n = fc.min(frames_max);
        let mut inst = tgs::render::RenderInstance::new(anim);
        let mut pix = tgs::rast::PixBuf::new(size, size).expect("pix");
        let mut best: Vec<f64> = vec![f64::INFINITY; variants.len()];
        for rep in 0..reps {
            let order: Vec<usize> = if rep % 2 == 0 {
                (0..variants.len()).collect()
            } else {
                (0..variants.len()).rev().collect()
            };
            for vi in order {
                tgs::set_sparse_k(variants[vi]);
                for f in 0..warm {
                    inst.render_frame_into(&mut pix, ip + (f % fc) as f64);
                }
                let t0 = cpu_ms();
                for f in 0..n {
                    inst.render_frame_into(&mut pix, ip + ((warm + f) % fc) as f64);
                }
                let ms = (cpu_ms() - t0) / n as f64;
                if std::env::var("AB_PRINT").is_ok() {
                    eprintln!("  rep {} var {} {:.3}", rep, variants[vi], ms);
                }
                if ms < best[vi] {
                    best[vi] = ms;
                }
            }
        }
        let base = path.rsplit('/').next().unwrap_or(path);
        let mut line = format!("{:<44}", &base[..base.len().min(44)]);
        for (i, k) in variants.iter().enumerate() {
            line.push_str(&format!(" K{}={:.3}", k, best[i]));
        }
        let r: Vec<String> = (1..variants.len()).map(|i| format!("{:.3}", best[i] / best[0])).collect();
        line.push_str(&format!(" ratios {}", r.join(" ")));
        println!("{}", line);
    }
}
