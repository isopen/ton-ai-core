use tgs::rast::{self, Blend, PaintStyle, PixBuf, RgbaF};
use tgs::render::Pc;

fn circle_cmds(cx: f64, cy: f64, r: f64, n: usize, start_deg: f64) -> Vec<Pc> {
    let mut pts = Vec::with_capacity(n);
    for i in 0..n {
        let a = start_deg.to_radians() + 2.0 * std::f64::consts::PI * (i as f64) / (n as f64);
        pts.push([cx + r * a.cos(), cy + r * a.sin()]);
    }
    let mut cmds = vec![Pc::M(pts[0])];
    for p in &pts[1..] {
        cmds.push(Pc::L(*p));
    }
    cmds.push(Pc::Z);
    cmds
}

fn missing_degrees(join: u8, start_deg: f64) -> Vec<i32> {
    let w = 200u32;
    let h = 200u32;
    let (cx, cy, r, width) = (100.0f64, 100.0f64, 60.0f64, 12.0f64);
    let cmds = circle_cmds(cx, cy, r, 72, start_deg);
    let mut pix = PixBuf::new(w, h).unwrap();
    let style = PaintStyle::Solid(RgbaF { r: 1.0, g: 1.0, b: 1.0, a: 1.0 });
    rast::stroke(&mut pix, &cmds, width, 0, join, 4.0, &style, Blend::SrcOver);
    let data = pix.data();
    let mut miss = Vec::new();
    for deg in 0..360 {
        let a = (deg as f64).to_radians();
        let mut hit = false;
        for k in 0..=40 {
            let rr = r - width * 0.5 + width * (k as f64) / 40.0;
            let x = (cx + rr * a.cos()).round() as i32;
            let y = (cy + rr * a.sin()).round() as i32;
            if x >= 0 && y >= 0 && (x as u32) < w && (y as u32) < h {
                let o = ((y as u32 * w + x as u32) * 4) as usize;
                if data[o + 3] > 128 {
                    hit = true;
                    break;
                }
            }
        }
        if !hit {
            miss.push(deg);
        }
    }
    miss
}

#[test]
fn closed_stroke_has_no_gap_at_the_path_start() {
    for join in 0..=3u8 {
        for start in [0.0f64, 45.0, 137.0, 359.0] {
            let miss = missing_degrees(join, start);
            assert!(miss.is_empty(), "join={join} start={start} missing={miss:?}");
        }
    }
}
