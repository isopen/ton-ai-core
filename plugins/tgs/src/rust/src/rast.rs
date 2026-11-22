use crate::cells::CellRaster;
use crate::cells::RowSink;
use crate::cov_cache::SPAN_CAPTURE_MAX;
use crate::prof;
use crate::render::Pc;

use std::cell::RefCell;
use std::f64::consts::PI;

thread_local! {
    static CELL_RASTER: RefCell<CellRaster> = RefCell::new(CellRaster::new());
    static FLATTEN: RefCell<FlattenCache> = RefCell::new(FlattenCache::new());
    static STROKE: RefCell<StrokeScratch> = RefCell::new(StrokeScratch::new());
    static FLAT_POOL: RefCell<Vec<Vec<[f64; 2]>>> = RefCell::new(Vec::new());
    static STROKE_CACHE: RefCell<StrokeCache> = RefCell::new(StrokeCache::new());
}

const STROKE_CACHE_CAP: usize = 8;

struct StrokeCacheEntry {
    key: u128,
    out: Option<std::rc::Rc<Vec<Poly>>>,
}

struct StrokeCache {
    entries: Vec<StrokeCacheEntry>,
}

impl StrokeCache {
    fn new() -> Self {
        StrokeCache { entries: Vec::new() }
    }
}

fn take_flat_buf() -> Vec<[f64; 2]> {
    FLAT_POOL.with(|p| p.borrow_mut().pop()).unwrap_or_default()
}

fn recycle_flat_buf(mut buf: Vec<[f64; 2]>) {
    buf.clear();
    FLAT_POOL.with(|p| {
        let mut pool = p.borrow_mut();
        if pool.len() < 512 {
            pool.push(buf);
        }
    });
}

struct StrokeScratch {
    segs: Vec<(usize, [f64; 2], f64)>,
    free: Vec<Vec<[f64; 2]>>,
    outlines: Vec<Poly>,
}

impl Default for StrokeScratch {
    fn default() -> Self {
        StrokeScratch::new()
    }
}

impl StrokeScratch {
    fn new() -> Self {
        StrokeScratch {
            segs: Vec::new(),
            free: Vec::new(),
            outlines: Vec::new(),
        }
    }

    fn point_buf(&mut self) -> Vec<[f64; 2]> {
        let mut v = self.free.pop().unwrap_or_default();
        v.clear();
        v
    }

    fn recycle(&mut self) {
        for poly in self.outlines.drain(..) {
            self.free.push(poly.pts);
        }
    }
}

struct FlattenCache {
    inp: Vec<Pc>,
    out: Option<std::rc::Rc<Vec<Poly>>>,
}

impl FlattenCache {
    fn new() -> Self {
        FlattenCache { inp: Vec::new(), out: None }
    }
}

fn flatten_shared(cmds: &[Pc]) -> std::rc::Rc<Vec<Poly>> {
    let _g = crate::prof::aprobe::enter(crate::prof::aprobe::FLAT);
    FLATTEN.with(|slot| {
        let mut c = slot.borrow_mut();
        if let Some(out) = &c.out {
            if c.inp.len() == cmds.len() && c.inp.as_slice() == cmds {
                return out.clone();
            }
        }
        if let Some(old) = c.out.take() {
            if let Ok(mut polys) = std::rc::Rc::try_unwrap(old) {
                for poly in polys.drain(..) {
                    recycle_flat_buf(poly.pts);
                }
            }
        }
        let polys = std::rc::Rc::new(flatten_cmds(cmds));
        c.inp.clear();
        c.inp.extend_from_slice(cmds);
        c.out = Some(polys.clone());
        polys
    })
}

thread_local! {
    static PROBE_ON: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static PROBE: std::cell::RefCell<Vec<String>> = const { std::cell::RefCell::new(Vec::new()) };
}

#[doc(hidden)]
pub fn probe_set(on: bool) {
    PROBE_ON.with(|c| c.set(on));
    if on {
        PROBE.with(|p| p.borrow_mut().clear());
    }
}

#[doc(hidden)]
pub fn probe_dump() -> String {
    PROBE.with(|p| p.borrow().join("\n"))
}

thread_local! {
    static CLIP_STACK: std::cell::RefCell<Vec<[[f32; 2]; 4]>> = const { std::cell::RefCell::new(Vec::new()) };
}

pub(crate) fn clip_push(quad: [[f32; 2]; 4]) {
    CLIP_STACK.with(|s| s.borrow_mut().push(quad));
}

pub(crate) fn clip_pop() {
    CLIP_STACK.with(|s| {
        s.borrow_mut().pop();
    });
}

fn mix_clip(h: &mut crate::cov_cache::Hasher128) {
    CLIP_STACK.with(|s| {
        let stack = s.borrow();
        h.mix(stack.len() as u32);
        for q in stack.iter() {
            for p in q {
                h.mix(p[0].to_bits());
                h.mix(p[1].to_bits());
            }
        }
    });
}

fn quad_contains_box(q: &[[f32; 2]; 4], x0: f32, y0: f32, x1: f32, y1: f32) -> bool {
    let area = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]);
    let sign = if area >= 0.0 { 1.0f32 } else { -1.0f32 };
    for e in 0..4usize {
        let a = q[e];
        let b = q[(e + 1) % 4];
        let (ex, ey) = (b[0] - a[0], b[1] - a[1]);
        let inside = |px: f32, py: f32| sign * (ex * (py - a[1]) - ey * (px - a[0])) >= 0.0;
        if !(inside(x0, y0) && inside(x1, y0) && inside(x0, y1) && inside(x1, y1)) {
            return false;
        }
    }
    true
}

fn clip_poly_quad(pts: &[[f64; 2]], quad: &[[f32; 2]; 4]) -> Vec<[f64; 2]> {
    let area = (quad[1][0] - quad[0][0]) * (quad[2][1] - quad[0][1]) - (quad[2][0] - quad[0][0]) * (quad[1][1] - quad[0][1]);
    let sign = if area >= 0.0 { 1.0f32 } else { -1.0f32 };
    let mut cur: Vec<[f32; 2]> = pts.iter().map(|p| [p[0] as f32, p[1] as f32]).collect();
    for e in 0..4usize {
        if cur.len() < 3 {
            return Vec::new();
        }
        let a = quad[e];
        let b = quad[(e + 1) % 4];
        let (ex, ey) = (b[0] - a[0], b[1] - a[1]);
        let inside = |p: &[f32; 2]| sign * (ex * (p[1] - a[1]) - ey * (p[0] - a[0])) >= 0.0;
        if cur.iter().all(inside) {
            continue;
        }
        let intersect = |p: &[f32; 2], q: &[f32; 2]| -> [f32; 2] {
            let dpx = q[0] - p[0];
            let dpy = q[1] - p[1];
            let denom = ex * dpy - ey * dpx;
            if denom.abs() < 1e-12 {
                return *q;
            }
            let t = (ex * (a[1] - p[1]) - ey * (a[0] - p[0])) / denom;
            let t = t.clamp(0.0, 1.0);
            [p[0] + dpx * t, p[1] + dpy * t]
        };
        let n = cur.len();
        let mut out: Vec<[f32; 2]> = Vec::with_capacity(n * 2);
        for i in 0..n {
            let prev = cur[(i + n - 1) % n];
            let curp = cur[i];
            let cur_in = inside(&curp);
            let prev_in = inside(&prev);
            if cur_in {
                if !prev_in {
                    out.push(intersect(&prev, &curp));
                }
                out.push(curp);
            } else if prev_in {
                out.push(intersect(&prev, &curp));
            }
        }
        cur = out;
    }
    cur.iter().map(|p| [p[0] as f64, p[1] as f64]).collect()
}

fn clip_polys(polys: &std::rc::Rc<Vec<Poly>>) -> std::rc::Rc<Vec<Poly>> {
    CLIP_STACK.with(|slot| {
        let stack = slot.borrow();
        if stack.is_empty() {
            return polys.clone();
        }
        let mut need = false;
        'outer: for poly in polys.iter() {
            if poly.pts.len() < 3 {
                need = true;
                break;
            }
            let mut x0 = f64::INFINITY;
            let mut y0 = f64::INFINITY;
            let mut x1 = f64::NEG_INFINITY;
            let mut y1 = f64::NEG_INFINITY;
            for p in poly.pts.iter() {
                if p[0] < x0 {
                    x0 = p[0];
                }
                if p[0] > x1 {
                    x1 = p[0];
                }
                if p[1] < y0 {
                    y0 = p[1];
                }
                if p[1] > y1 {
                    y1 = p[1];
                }
            }
            for q in stack.iter() {
                if !quad_contains_box(q, x0 as f32, y0 as f32, x1 as f32, y1 as f32) {
                    need = true;
                    break 'outer;
                }
            }
        }
        if !need {
            return polys.clone();
        }
        let mut out: Vec<Poly> = Vec::with_capacity(polys.len());
        for poly in polys.iter() {
            let mut pts = poly.pts.clone();
            for q in stack.iter() {
                pts = clip_poly_quad(&pts, q);
                if pts.len() < 3 {
                    break;
                }
            }
            out.push(Poly { pts, closed: poly.closed });
        }
        std::rc::Rc::new(out)
    })
}

fn poly_in_rect(pts: &[[f64; 2]], w: f64, h: f64) -> bool {
    for p in pts.iter() {
        if !(p[0] >= 0.0 && p[0] <= w && p[1] >= 0.0 && p[1] <= h) {
            return false;
        }
    }
    true
}

fn clip_poly_rect(pts: &[[f64; 2]], w: f32, h: f32) -> Vec<[f64; 2]> {
    let mut cur: Vec<[f32; 2]> = pts.iter().map(|p| [p[0] as f32, p[1] as f32]).collect();
    for edge in 0..4u8 {
        if cur.len() < 3 {
            return Vec::new();
        }
        let inside = |p: &[f32; 2]| -> bool {
            match edge {
                0 => p[0] >= 0.0,
                1 => p[0] <= w,
                2 => p[1] >= 0.0,
                _ => p[1] <= h,
            }
        };
        if cur.iter().all(inside) {
            continue;
        }
        let intersect = |a: &[f32; 2], b: &[f32; 2]| -> [f32; 2] {
            let (bound, vertical) = match edge {
                0 => (0.0f32, true),
                1 => (w, true),
                2 => (0.0f32, false),
                _ => (h, false),
            };
            if vertical {
                let t = if (b[0] - a[0]).abs() > 1e-9 { (bound - a[0]) / (b[0] - a[0]) } else { 0.0 };
                [bound, a[1] + (b[1] - a[1]) * t]
            } else {
                let t = if (b[1] - a[1]).abs() > 1e-9 { (bound - a[1]) / (b[1] - a[1]) } else { 0.0 };
                [a[0] + (b[0] - a[0]) * t, bound]
            }
        };
        let n = cur.len();
        let mut out: Vec<[f32; 2]> = Vec::with_capacity(n * 2);
        for i in 0..n {
            let curp = cur[i];
            let prev = cur[(i + n - 1) % n];
            let cur_in = inside(&curp);
            let prev_in = inside(&prev);
            if cur_in {
                if !prev_in {
                    out.push(intersect(&prev, &curp));
                }
                out.push(curp);
            } else if prev_in {
                out.push(intersect(&prev, &curp));
            }
        }
        cur = out;
    }
    cur.iter().map(|p| [p[0] as f64, p[1] as f64]).collect()
}

fn clip_polys_rect(polys: &std::rc::Rc<Vec<Poly>>, w: f32, h: f32) -> std::rc::Rc<Vec<Poly>> {
    let (wf, hf) = (w as f64, h as f64);
    if polys.iter().all(|p| poly_in_rect(&p.pts, wf, hf)) {
        return polys.clone();
    }
    let mut out: Vec<Poly> = Vec::with_capacity(polys.len());
    for poly in polys.iter() {
        let pts = if poly_in_rect(&poly.pts, wf, hf) {
            poly.pts.clone()
        } else {
            clip_poly_rect(&poly.pts, w, h)
        };
        out.push(Poly { pts, closed: poly.closed });
    }
    std::rc::Rc::new(out)
}

#[derive(Clone, Copy, PartialEq)]
pub enum Blend {
    SrcOver,
    Multiply,
    Screen,
    Overlay,
    Darken,
    Lighten,
    ColorDodge,
    ColorBurn,
    HardLight,
    SoftLight,
    Difference,
    Exclusion,
    Hue,
    Saturation,
    Color,
    Luminosity,
    Plus,
    DestIn,
    DestOut,
}

pub struct PixBuf {
    width: u32,
    height: u32,
    data: Vec<u8>,
    rx0: Vec<u32>,
    rx1: Vec<u32>,
    dx0: u32,
    dy0: u32,
    dx1: u32,
    dy1: u32,
}

impl PixBuf {
    pub fn new(w: u32, h: u32) -> Option<PixBuf> {
        let len = w.checked_mul(h)?.checked_mul(4)?;
        Some(PixBuf {
            width: w,
            height: h,
            data: vec![0u8; len as usize],
            rx0: vec![u32::MAX; h as usize],
            rx1: vec![0u32; h as usize],
            dx0: u32::MAX,
            dy0: u32::MAX,
            dx1: 0,
            dy1: 0,
        })
    }

    #[inline]
    pub fn mark(&mut self, y: usize, x0: usize, x1: usize) {
        if x0 >= x1 {
            return;
        }
        let x1 = (x1 as u32).min(self.width);
        let x0 = (x0 as u32).min(x1);
        let y = y as u32;
        if y >= self.height || x0 >= x1 {
            return;
        }
        let yi = y as usize;
        if self.rx0[yi] > x0 {
            self.rx0[yi] = x0;
        }
        if self.rx1[yi] < x1 {
            self.rx1[yi] = x1;
        }
        if self.dx0 > x0 {
            self.dx0 = x0;
        }
        if self.dx1 < x1 {
            self.dx1 = x1;
        }
        if self.dy0 > y {
            self.dy0 = y;
        }
        if self.dy1 <= y {
            self.dy1 = y + 1;
        }
    }

    pub fn mark_all(&mut self) {
        let w = self.width;
        for y in 0..self.height as usize {
            self.rx0[y] = 0;
            self.rx1[y] = w;
        }
        self.dx0 = 0;
        self.dy0 = 0;
        self.dx1 = w;
        self.dy1 = self.height;
    }

    #[inline]
    pub fn row_dirty(&self, y: usize) -> Option<(usize, usize)> {        if y >= self.height as usize {
            return None;
        }
        let a = self.rx0[y];
        let b = self.rx1[y];
        if a < b {
            Some((a as usize, b as usize))
        } else {
            None
        }
    }

    #[inline]
    pub fn dirty(&self) -> Option<(usize, usize, usize, usize)> {
        if self.dx0 >= self.dx1 || self.dy0 >= self.dy1 {
            None
        } else {
            Some((self.dx0 as usize, self.dy0 as usize, self.dx1 as usize, self.dy1 as usize))
        }
    }

    pub fn clear(&mut self) {
        if self.dy0 < self.dy1 {
            let stride = self.width as usize * 4;
            if self.dx0 == 0 && self.dx1 == self.width {
                let a = self.dy0 as usize * stride;
                let b = self.dy1 as usize * stride;
                self.data[a..b].fill(0);
                for y in self.dy0 as usize..self.dy1 as usize {
                    self.rx0[y] = u32::MAX;
                    self.rx1[y] = 0;
                }
            } else {
                for y in self.dy0 as usize..self.dy1 as usize {
                    let a = self.rx0[y];
                    let b = self.rx1[y];
                    if a < b {
                        let base = y * stride;
                        self.data[base + a as usize * 4..base + b as usize * 4].fill(0);
                    }
                    self.rx0[y] = u32::MAX;
                    self.rx1[y] = 0;
                }
            }
        }
        self.dx0 = u32::MAX;
        self.dy0 = u32::MAX;
        self.dx1 = 0;
        self.dy1 = 0;
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    pub fn data(&self) -> &[u8] {
        &self.data
    }

    pub fn data_mut(&mut self) -> &mut [u8] {
        &mut self.data
    }

    pub fn fill(&mut self, b: u8) {
        self.data.fill(b);
        if b == 0 {
            if self.dy0 < self.dy1 {
                for y in self.dy0 as usize..self.dy1 as usize {
                    self.rx0[y] = u32::MAX;
                    self.rx1[y] = 0;
                }
            }
            self.dx0 = u32::MAX;
            self.dy0 = u32::MAX;
            self.dx1 = 0;
            self.dy1 = 0;
        } else {
            for y in 0..self.height as usize {
                self.rx0[y] = 0;
                self.rx1[y] = self.width;
            }
            self.dx0 = 0;
            self.dy0 = 0;
            self.dx1 = self.width;
            self.dy1 = self.height;
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
pub struct RgbaF {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

#[derive(Clone, Copy, PartialEq)]
pub struct RadialMap {
    pub ia: f32,
    pub ib: f32,
    pub ic: f32,
    pub id: f32,
    pub ox: f32,
    pub oy: f32,
    pub inv_r: f32,
}

impl RadialMap {
    #[inline]
    pub fn row_origin(&self, y: usize) -> (f32, f32) {
        let yf = y as f32 + 0.5;
        (self.ia * 0.5 + self.ic * yf + self.ox, self.ib * 0.5 + self.id * yf + self.oy)
    }

    #[inline]
    pub fn at(&self, x: f32, y: f32) -> f32 {
        let lx = self.ia * x + self.ic * y + self.ox;
        let ly = self.ib * x + self.id * y + self.oy;
        (lx * lx + ly * ly).sqrt() * self.inv_r
    }
}

pub enum PaintStyle {
    Solid(RgbaF),
    Linear { x0: f32, y0: f32, x1: f32, y1: f32, stops: crate::gradlut::GradStops },
    Radial { map: RadialMap, stops: crate::gradlut::GradStops },
}

impl PaintStyle {
    fn sample(&self, x: f32, y: f32) -> RgbaF {
        match self {
            PaintStyle::Solid(c) => *c,
            PaintStyle::Linear { x0, y0, x1, y1, stops } => {
                let dx = x1 - x0;
                let dy = y1 - y0;
                let len2 = dx * dx + dy * dy;
                let t = if len2 <= 1e-9 { 0.0 } else { ((x - x0) * dx + (y - y0) * dy) / len2 };
                crate::gradlut::sample_rgba(stops, t)
            }
            PaintStyle::Radial { map, stops } => crate::gradlut::sample_rgba(stops, map.at(x, y)),
        }
    }
}

fn lum3(c: [f32; 3]) -> f32 {
    0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
}

fn clip_color3(c: [f32; 3]) -> [f32; 3] {
    let l = lum3(c);
    let mut out = c;
    let mn = c[0].min(c[1]).min(c[2]);
    if mn < 0.0 {
        let k = l / (l - mn);
        for v in out.iter_mut() {
            *v = l + (*v - l) * k;
        }
    }
    let mx = out[0].max(out[1]).max(out[2]);
    if mx > 1.0 {
        let l2 = lum3(out);
        let k = (1.0 - l2) / (mx - l2);
        for v in out.iter_mut() {
            *v = l2 + (*v - l2) * k;
        }
    }
    out
}

fn set_lum3(c: [f32; 3], l: f32) -> [f32; 3] {
    let d = l - lum3(c);
    clip_color3([c[0] + d, c[1] + d, c[2] + d])
}

fn sat3(c: [f32; 3]) -> f32 {
    c[0].max(c[1]).max(c[2]) - c[0].min(c[1]).min(c[2])
}

fn set_sat3(c: [f32; 3], s: f32) -> [f32; 3] {
    let mx = c[0].max(c[1]).max(c[2]);
    let mn = c[0].min(c[1]).min(c[2]);
    let mut out = [0.0f32; 3];
    if mx > mn {
        for i in 0..3 {
            if c[i] == mn {
                out[i] = 0.0;
            } else if c[i] == mx {
                out[i] = s;
            } else {
                out[i] = (c[i] - mn) / (mx - mn) * s;
            }
        }
    }
    out
}

fn soft_light_b(cd: f32, cs: f32) -> f32 {
    if cs <= 0.5 {
        cd - (1.0 - 2.0 * cs) * cd * (1.0 - cd)
    } else {
        let d = if cd <= 0.25 {
            ((16.0 * cd - 12.0) * cd + 4.0) * cd
        } else {
            cd.sqrt()
        };
        cd + (2.0 * cs - 1.0) * (d - cd)
    }
}

fn backdrop3(mode: Blend, cd: [f32; 3], cs: [f32; 3]) -> [f32; 3] {
    match mode {
        Blend::Multiply => [cd[0] * cs[0], cd[1] * cs[1], cd[2] * cs[2]],
        Blend::Screen => {
            [cd[0] + cs[0] - cd[0] * cs[0], cd[1] + cs[1] - cd[1] * cs[1], cd[2] + cs[2] - cd[2] * cs[2]]
        }
        Blend::Overlay => {
            let mut r = [0.0f32; 3];
            for i in 0..3 {
                r[i] = if cd[i] <= 0.5 { 2.0 * cd[i] * cs[i] } else { 1.0 - 2.0 * (1.0 - cd[i]) * (1.0 - cs[i]) };
            }
            r
        }
        Blend::Darken => [cd[0].min(cs[0]), cd[1].min(cs[1]), cd[2].min(cs[2])],
        Blend::Lighten => [cd[0].max(cs[0]), cd[1].max(cs[1]), cd[2].max(cs[2])],
        Blend::ColorDodge => {
            let mut r = [0.0f32; 3];
            for i in 0..3 {
                r[i] = if cd[i] <= 0.0 {
                    0.0
                } else if cs[i] >= 1.0 {
                    1.0
                } else {
                    (cd[i] / (1.0 - cs[i])).min(1.0)
                };
            }
            r
        }
        Blend::ColorBurn => {
            let mut r = [0.0f32; 3];
            for i in 0..3 {
                r[i] = if cd[i] >= 1.0 {
                    1.0
                } else if cs[i] <= 0.0 {
                    0.0
                } else {
                    1.0 - ((1.0 - cd[i]) / cs[i]).min(1.0)
                };
            }
            r
        }
        Blend::HardLight => {
            let mut r = [0.0f32; 3];
            for i in 0..3 {
                r[i] = if cs[i] <= 0.5 { 2.0 * cd[i] * cs[i] } else { 1.0 - 2.0 * (1.0 - cd[i]) * (1.0 - cs[i]) };
            }
            r
        }
        Blend::SoftLight => [soft_light_b(cd[0], cs[0]), soft_light_b(cd[1], cs[1]), soft_light_b(cd[2], cs[2])],
        Blend::Difference => [(cd[0] - cs[0]).abs(), (cd[1] - cs[1]).abs(), (cd[2] - cs[2]).abs()],
        Blend::Exclusion => {
            [cd[0] + cs[0] - 2.0 * cd[0] * cs[0], cd[1] + cs[1] - 2.0 * cd[1] * cs[1], cd[2] + cs[2] - 2.0 * cd[2] * cs[2]]
        }
        Blend::Hue => {
            let st = set_sat3(cs, sat3(cd));
            set_lum3(st, lum3(cd))
        }
        Blend::Saturation => {
            let st = set_sat3(cd, sat3(cs));
            set_lum3(st, lum3(cd))
        }
        Blend::Color => set_lum3(cs, lum3(cd)),
        Blend::Luminosity => set_lum3(cd, lum3(cs)),
        _ => [0.0, 0.0, 0.0],
    }
}

#[inline]
fn compose(mode: Blend, s: [f32; 4], d: [f32; 4]) -> [f32; 4] {
    match mode {
        Blend::DestIn => return [d[0] * s[3], d[1] * s[3], d[2] * s[3], d[3] * s[3]],
        Blend::DestOut => return [d[0] * (1.0 - s[3]), d[1] * (1.0 - s[3]), d[2] * (1.0 - s[3]), d[3] * (1.0 - s[3])],
        Blend::Plus => {
            if s[3] <= 0.0 {
                return d;
            }
            return [
                (s[0] + d[0]).min(1.0),
                (s[1] + d[1]).min(1.0),
                (s[2] + d[2]).min(1.0),
                (s[3] + d[3]).min(1.0),
            ];
        }
        _ => {}
    }
    let sa = s[3];
    if sa <= 0.0 {
        return d;
    }
    let da = d[3];
    let mut r = [0.0f32; 4];
    let inv_da = 1.0 - da;
    let inv_sa = 1.0 - sa;
    match mode {
        Blend::SrcOver => {
            r[0] = s[0] + d[0] * inv_sa;
            r[1] = s[1] + d[1] * inv_sa;
            r[2] = s[2] + d[2] * inv_sa;
        }
        _ => {
            let cs = [s[0] / sa, s[1] / sa, s[2] / sa];
            if da > 1e-6 {
                let cd = [d[0] / da, d[1] / da, d[2] / da];
                let b = backdrop3(mode, cd, cs);
                r[0] = sa * da * b[0] + s[0] * inv_da + d[0] * inv_sa;
                r[1] = sa * da * b[1] + s[1] * inv_da + d[1] * inv_sa;
                r[2] = sa * da * b[2] + s[2] * inv_da + d[2] * inv_sa;
            } else {
                r[0] = s[0];
                r[1] = s[1];
                r[2] = s[2];
            }
        }
    }
    r[3] = sa + da * inv_sa;
    r
}

const FLATTEN_TOL: f64 = 0.3;
const DENSE_MAX_PX: usize = 160 * 160;

const DENSE_BBOX_PX: f64 = 160.0 * 160.0;
const MAX_FLAT_SEGS: usize = 128;

struct Poly {
    pts: Vec<[f64; 2]>,
    closed: bool,
}

fn cubic_segments(p0: [f64; 2], p1: [f64; 2], p2: [f64; 2], p3: [f64; 2]) -> usize {
    let d2a = (p0[0] - 2.0 * p1[0] + p2[0]).abs().max((p0[1] - 2.0 * p1[1] + p2[1]).abs());
    let d2b = (p1[0] - 2.0 * p2[0] + p3[0]).abs().max((p1[1] - 2.0 * p2[1] + p3[1]).abs());
    let m_norm = d2a.max(d2b);
    let coefficient = 0.75 / FLATTEN_TOL;
    ((m_norm * coefficient).sqrt().ceil() as usize).clamp(1, MAX_FLAT_SEGS)
}

fn flatten_cubic(out: &mut Vec<[f64; 2]>, p0: [f64; 2], p1: [f64; 2], p2: [f64; 2], p3: [f64; 2]) {
    let n = cubic_segments(p0, p1, p2, p3);
    if n > 1 {
        out.reserve(n - 1);
    }
    let step = 1.0 / n as f64;
    let mut t = step;
    for _ in 1..n {
        let omt = 1.0 - t;
        let a = omt * omt * omt;
        let b = 3.0 * omt * omt * t;
        let c = 3.0 * omt * t * t;
        let d = t * t * t;
        out.push([
            a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
            a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
        ]);
        t += step;
    }
    out.push(p3);
}

fn flatten_cmds(cmds: &[Pc]) -> Vec<Poly> {
    let mut polys: Vec<Poly> = Vec::new();
    let mut cur: Vec<[f64; 2]> = take_flat_buf();
    let mut closed = false;
    let flush = |polys: &mut Vec<Poly>, cur: &mut Vec<[f64; 2]>, closed: bool| {
        if !cur.is_empty() {
            polys.push(Poly { pts: core::mem::take(cur), closed });
            *cur = take_flat_buf();
        }
    };
    for cmd in cmds {
        match cmd {
            Pc::M(p) => {
                flush(&mut polys, &mut cur, closed);
                closed = false;
                cur.push([p[0], p[1]]);
            }
            Pc::L(p) => {
                if cur.is_empty() {
                    cur.push([p[0], p[1]]);
                } else {
                    cur.push([p[0], p[1]]);
                }
            }
            Pc::C(c) => {
                let p_prev = if cur.is_empty() { [c[4], c[5]] } else { cur[cur.len() - 1] };
                flatten_cubic(&mut cur, p_prev, [c[0], c[1]], [c[2], c[3]], [c[4], c[5]]);
            }
            Pc::Z => {
                closed = true;
                flush(&mut polys, &mut cur, closed);
                closed = false;
            }
        }
    }
    flush(&mut polys, &mut cur, closed);
    recycle_flat_buf(core::mem::take(&mut cur));
    polys
}

#[inline]
fn poly_offscreen(pts: &[[f64; 2]], w: f64, h: f64) -> bool {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    let mut cull = true;
    for p in pts {
        if p[0] < min_x {
            min_x = p[0];
        }
        if p[1] < min_y {
            min_y = p[1];
        }
        if p[1] > max_y {
            max_y = p[1];
        }
        if min_x < w && min_y < h && max_y > 0.0 {
            cull = false;
            break;
        }
    }
    cull
}

struct ShapeMetrics {
    wb: f64,
    hb: f64,
    perim: f64,
    valid: bool,
}

fn shape_metrics(polys: &[Poly]) -> ShapeMetrics {
    let mut bx0 = f64::INFINITY;
    let mut by0 = f64::INFINITY;
    let mut bx1 = f64::NEG_INFINITY;
    let mut by1 = f64::NEG_INFINITY;
    let mut perim = 0.0f64;
    for poly in polys {
        let pts = &poly.pts;
        let n = pts.len();
        let mut i = 0usize;
        while i < n {
            let p = pts[i];
            bx0 = bx0.min(p[0]);
            by0 = by0.min(p[1]);
            bx1 = bx1.max(p[0]);
            by1 = by1.max(p[1]);
            let q = if i + 1 < n { pts[i + 1] } else { pts[0] };
            perim += (q[0] - p[0]).abs() + (q[1] - p[1]).abs();
            i += 1;
        }
    }
    let valid = bx1 > bx0 && by1 > by0;
    ShapeMetrics {
        wb: if valid { bx1 - bx0 } else { 0.0 },
        hb: if valid { by1 - by0 } else { 0.0 },
        perim,
        valid,
    }
}

fn sparse_shape(m: &ShapeMetrics, cpx: usize) -> bool {
    if !m.valid {
        return false;
    }
    if m.wb.max(m.hb) <= 42.0 {
        return false;
    }
    let density = if cpx <= 160 * 160 {
        12.0
    } else if cpx <= 448 * 448 {
        18.0
    } else {
        6.0
    };
    m.perim * density < m.wb * m.hb
}

fn sparse_wins(polys: &[Poly], wpx: usize, hpx: usize) -> bool {
    let m = shape_metrics(polys);
    if !m.valid {
        return false;
    }
    if m.wb * m.hb <= (wpx * hpx) as f64 {
        return true;
    }
    sparse_shape(&m, wpx * hpx)
}

pub fn fill_pix(
    dst: &mut PixBuf,
    cmds: &[Pc],
    even_odd: bool,
    style: &PaintStyle,
    blend: Blend,
    mult: f64,
) {
    if dst.width == 0 || dst.height == 0 {
        return;
    }
    let _g = crate::prof::aprobe::enter(crate::prof::aprobe::AFILL);
    let t0k = prof::now();
    let key = cmds_key(1, even_odd, dst.width as usize, dst.height as usize, cmds, &[]);
    prof::add(prof::KEYS, t0k);
    crate::cov_cache::seen_note(key);
    #[cfg(feature = "prof")]
    if crate::cov_cache::seen_cur(key) {
        prof::count(prof::DUPKEY, 1);
    }
    let t0r = prof::now();
    let mut cov = crate::cov_cache::take_cov_buf();
    let hit = crate::cov_cache::hit(key, &mut |e| replay_cov(dst, e, &mut cov, style, blend, mult));
    if hit {
        crate::cov_cache::stow_cov_buf(cov);
        #[cfg(feature = "prof")]
        prof::count(prof::COVHIT, 1);
        prof::add(prof::REPC, t0r);
        prof::add(prof::FRAS, t0r);
        return;
    }
    if crate::cov_cache::skip_fresh() {
        crate::cov_cache::stow_cov_buf(cov);
        prof::add(prof::FRAS, t0r);
        return;
    }
    let t0f = prof::now();
    let raw = flatten_shared(cmds);
    let polys = clip_polys_rect(&clip_polys(&raw), dst.width as f32, dst.height as f32);
    if PROBE_ON.with(|c| c.get()) {
        let depth = CLIP_STACK.with(|s| s.borrow().len());
        let (mut x0, mut y0, mut x1, mut y1) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
        for poly in raw.iter() {
            for p in poly.pts.iter() {
                if p[0] < x0 { x0 = p[0]; }
                if p[0] > x1 { x1 = p[0]; }
                if p[1] < y0 { y0 = p[1]; }
                if p[1] > y1 { y1 = p[1]; }
            }
        }
        let quads = CLIP_STACK.with(|s| {
            let st = s.borrow();
            st.iter().map(|q| format!("[{}]", q.iter().map(|p| format!("{:.1},{:.1}", p[0], p[1])).collect::<Vec<_>>().join(" "))).collect::<Vec<_>>().join(" ")
        });
        PROBE.with(|pp| pp.borrow_mut().push(format!(
            "fill depth={} raw={} clipped={} rawbox={:.1},{:.1}..{:.1},{:.1} quads={}",
            depth, raw.len(), polys.len(), x0, y0, x1, y1, quads
        )));
    }
    #[cfg(feature = "prof")]
    {
        let mut fpts = 0u64;
        for poly in polys.iter() {
            fpts += poly.pts.len() as u64;
        }
        prof::count(prof::FPTS, fpts);
    }
    if polys.is_empty() {
        crate::cov_cache::stow_cov_buf(cov);
        prof::add(prof::FPREP, t0f);
        prof::add(prof::FRAS, t0r);
        return;
    }
    let sparse_mode = sparse_wins(&polys, dst.width as usize, dst.height as usize);
    prof::add(prof::FPREP, t0f);
    if crate::cov_cache::skip_raster() {
        crate::cov_cache::stow_cov_buf(cov);
        return;
    }
    if sparse_mode {
        #[cfg(feature = "prof")]
        prof::count(prof::RCALLS, 1);
        #[cfg(feature = "prof")]
        prof::count(prof::FROWG, 1);
        raster_cells(dst, &polys, even_odd, style, blend, mult, &mut cov, key, false);
    } else {
        #[cfg(feature = "prof")]
        prof::count(prof::RACC, 1);
        #[cfg(feature = "prof")]
        prof::count(prof::FPTS, 1);
        raster_accum(dst, &polys, even_odd, style, blend, mult, &mut cov, key);
    }
    crate::cov_cache::stow_cov_buf(cov);
    prof::add(prof::FRAS, t0r);
}

pub(crate) fn cmds_key_for_mask(kind: u32, even_odd: bool, w: usize, h: usize, cmds: &[Pc], extra: &[u64]) -> u128 {
    cmds_key(kind, even_odd, w, h, cmds, extra)
}

fn cmds_key(kind: u32, even_odd: bool, w: usize, h: usize, cmds: &[Pc], extra: &[u64]) -> u128 {
    let mut hs = crate::cov_cache::Hasher128::new();
    hs.mix(w as u32);
    hs.mix(h as u32);
    hs.mix(kind);
    hs.mix(if even_odd { 2 } else { 1 });
    hs.mix(cmds.len() as u32);
    for cmd in cmds {
        match cmd {
            Pc::M(p) => {
                hs.mix(1);
                hs.mix_f64(p[0]);
                hs.mix_f64(p[1]);
            }
            Pc::L(p) => {
                hs.mix(2);
                hs.mix_f64(p[0]);
                hs.mix_f64(p[1]);
            }
            Pc::C(c) => {
                hs.mix(3);
                for v in c {
                    hs.mix_f64(*v);
                }
            }
            Pc::Z => {
                hs.mix(4);
            }
        }
    }
    for v in extra {
        hs.mix_u64(*v);
    }
    mix_clip(&mut hs);
    hs.finish()
}

fn replay_cov(
    dst: &mut PixBuf,
    entry: &crate::cov_cache::CovEntry,
    cov: &mut Vec<f32>,
    style: &PaintStyle,
    blend: Blend,
    mult: f64,
) {
    let w = dst.width as usize;
    if w == 0 || cov.len() < w {
        cov.resize(w, 0.0f32);
    }
    let h = dst.height as usize;
    if blend == Blend::SrcOver && mult == 1.0 {
        if let PaintStyle::Solid(c) = style {
            let col = crate::gradlut::solid_col_u32(c);
            let t0c = prof::now();
            if let crate::cov_cache::PlaneData::Spans(spans) = &entry.data {
                let stride = 4usize * w;
                prof::count(prof::FROWU, spans.len() as u64);
                let mut pxsum = 0u64;
                let mut mk_y = usize::MAX;
                let (mut mk0, mut mk1) = (0usize, 0usize);
                for &s in spans.iter() {
                    pxsum += u64::from((s >> 8) & 0xffff);
                    let (y, x0s, len, cv) = crate::cov_cache::unpack_span(s);
                    let e1 = x0s + len;
                    if y >= h || e1 > w {
                        continue;
                    }
                    if y != mk_y {
                        if mk_y != usize::MAX {
                            dst.mark(mk_y, mk0, mk1);
                        }
                        mk_y = y;
                        mk0 = x0s;
                        mk1 = e1;
                    } else {
                        mk0 = mk0.min(x0s);
                        mk1 = mk1.max(e1);
                    }
                    unsafe {
                        let p = dst.data.as_mut_ptr().add(y * stride + x0s * 4);
                        if len < 8 {
                            crate::paint_simd::solid_span_small(p, col, u32::from(cv), len);
                        } else {
                            crate::paint_simd::solid_grad_span(p, col, u32::from(cv), len);
                        }
                    }
                }
                if mk_y != usize::MAX {
                    dst.mark(mk_y, mk0, mk1);
                }
                prof::count(prof::FROWX, pxsum);
                prof::add(prof::FROWUS, t0c);
                return;
            }
        }
        if let PaintStyle::Linear { x0, y0, x1, y1, stops } = style {
            let dx = x1 - x0;
            let dy = y1 - y0;
            let len2 = dx * dx + dy * dy;
            if len2 > 1e-9 {
                let dinv = 1.0 / len2;
                let gdtx = dx * dinv;
                let (lut, grad_opaque) = crate::gradlut::lut_pix_and_opaque(stops);
                let t0c = prof::now();
                if let crate::cov_cache::PlaneData::Spans(spans) = &entry.data {
                    let mut pxsum = 0u64;
                    let mut mk_y = usize::MAX;
                    let (mut mk0, mut mk1) = (0usize, 0usize);
                    let mut row_bias = 0f32;
                    for &s in spans.iter() {
                        let (y, x0s, len, cv) = crate::cov_cache::unpack_span(s);
                        let e1 = x0s + len;
                        if y >= h || e1 > w {
                            continue;
                        }
                        pxsum += len as u64;
                        if y != mk_y {
                            if mk_y != usize::MAX {
                                dst.mark(mk_y, mk0, mk1);
                            }
                            mk_y = y;
                            mk0 = x0s;
                            mk1 = e1;
                            
                            
                            
                            let gc = (y as f32 + 0.5 - *y0) * dy * dinv;
                            row_bias = gc - *x0 * gdtx;
                        } else {
                            mk0 = mk0.min(x0s);
                            mk1 = mk1.max(e1);
                        }
                        paint_grad_span_bias(dst, y, x0s, e1, cv, row_bias, gdtx, &lut, grad_opaque);
                    }
                    if mk_y != usize::MAX {
                        dst.mark(mk_y, mk0, mk1);
                    }
                    prof::count(prof::FROWU, spans.len() as u64);
                    prof::count(prof::RS, pxsum);
                    prof::add(prof::FROWUL, t0c);
                    return;
                }
            }
        }
        if let PaintStyle::Radial { map, stops } = style {
            let (lut, rad_opaque) = crate::gradlut::lut_pix_and_opaque(stops);
            let t0c = prof::now();
            if let crate::cov_cache::PlaneData::Spans(spans) = &entry.data {
                let mut pxsum = 0u64;
                let mut mk_y = usize::MAX;
                let (mut mk0, mut mk1) = (0usize, 0usize);
                for &s in spans.iter() {
                    let (y, x0s, len, cv) = crate::cov_cache::unpack_span(s);
                    let e1 = x0s + len;
                    if y >= h || e1 > w {
                        continue;
                    }
                    pxsum += len as u64;
                    if y != mk_y {
                        if mk_y != usize::MAX {
                            dst.mark(mk_y, mk0, mk1);
                        }
                        mk_y = y;
                        mk0 = x0s;
                        mk1 = e1;
                    } else {
                        mk0 = mk0.min(x0s);
                        mk1 = mk1.max(e1);
                    }
                    paint_rgrad_span(dst, y, x0s, e1, cv, map, &lut, rad_opaque);
                }
                if mk_y != usize::MAX {
                    dst.mark(mk_y, mk0, mk1);
                }
                prof::count(prof::FROWU, spans.len() as u64);
                prof::count(prof::RW, pxsum);
                prof::add(prof::FROWUR, t0c);
                return;
            }
        }
    }
    match &entry.data {
        crate::cov_cache::PlaneData::Spans(spans) => {
            for &s in spans.iter() {
                let (y, x0, len, cv) = crate::cov_cache::unpack_span(s);
                let e1 = x0 + len;
                if y >= h || e1 > w {
                    continue;
                }
                let a = u32::from(cv) as f32 / 255.0;
                for col in x0..e1 {
                    cov[col] = a;
                }
                paint_span_row(dst, y, x0, e1, cv, cov, style, blend, mult);
            }
        }
        crate::cov_cache::PlaneData::Cov(data) => {
            let t0c = prof::now();
            let mut off = 0usize;
            let mut lin8: Option<(f32, f32, f32, f32, std::rc::Rc<Vec<u32>>)> = None;
            let mut rad8: Option<(RadialMap, std::rc::Rc<Vec<u32>>)> = None;
            if blend == Blend::SrcOver && mult == 1.0 {
                if let PaintStyle::Solid(c) = style {
                    let col = crate::gradlut::solid_col_u32(c);
                    let stride = 4usize * w;
                    for &(ry, rx0, rlen) in &entry.rows {
                        let (y, x0, len) = (ry as usize, rx0 as usize, rlen as usize);
                        if y >= h || x0 + len > w || len > data.len() || off > data.len() - len {
                            break;
                        }
                        dst.mark(y, x0, x0 + len);
                        let span = &data[off..off + len];
                        unsafe {
                            crate::paint_simd::solid_cov_row(
                                dst.data.as_mut_ptr().add(y * stride + x0 * 4),
                                span.as_ptr(),
                                col,
                                len,
                            );
                        }
                        off += len;
                    }
                    prof::count(prof::RZC, entry.rows.len() as u64);
                    prof::add(prof::COVROW, t0c);
                    return;
                }
                if let PaintStyle::Linear { x0, y0, x1, y1, stops } = style {
                    let dx = x1 - x0;
                    let dy = y1 - y0;
                    let len2 = dx * dx + dy * dy;
                    if len2 > 1e-9 {
                        lin8 = Some((
                            *x0,
                            *y0,
                            dx / len2,
                            dy / len2,
                            crate::gradlut::lut_pix_of(stops),
                        ));
                    }
                }
                if let PaintStyle::Radial { map, stops } = style {
                    rad8 = Some((*map, crate::gradlut::lut_pix_of(stops)));
                }
            }
            let mut nrows = 0u64;
            let mut npxc = 0u64;
            for &(ry, rx0, rlen) in &entry.rows {
                let (y, x0, len) = (ry as usize, rx0 as usize, rlen as usize);
                if y >= h || x0 + len > w || len > data.len() || off > data.len() - len {
                    break;
                }
                nrows += 1;
                npxc += len as u64;
                dst.mark(y, x0, x0 + len);
                let span = &data[off..off + len];
                if let Some((gx0, gy0, gdnx, gdny, lut)) = &lin8 {
                    let t0 = (x0 as f32 + 0.5 - *gx0) * gdnx + (y as f32 + 0.5 - gy0) * gdny;
                    let base = y * 4 * w;
                    let n = len;
                    #[cfg(target_arch = "wasm32")]
                    let mut i = {
                        let nvec = n & !3;
                        if nvec > 0 {
                            unsafe {
                                crate::paint_simd::grad_lut_cov_span(
                                    dst.data.as_mut_ptr().add(base + x0 * 4),
                                    t0,
                                    *gdnx,
                                    nvec,
                                    lut.as_ptr(),
                                    span.as_ptr(),
                                );
                            }
                        }
                        nvec
                    };
                    #[cfg(not(target_arch = "wasm32"))]
                    let mut i = 0usize;
                    while i < n {
                        let px = lut[crate::gradlut::lut_index(t0 + i as f32 * gdnx)];
                        if (px >> 24) != 0 {
                            grad_blend_px(&mut dst.data, base + (x0 + i) * 4, px, u32::from(span[i]));
                        }
                        i += 1;
                    }
                    off += len;
                    continue;
                }
                if let Some((map, lut)) = &rad8 {
                    let (bx, by) = map.row_origin(y);
                    let (ax, ay, inv_r) = (map.ia, map.ib, map.inv_r);
                    let base = y * 4 * w;
                    let n = len;
                    #[cfg(target_arch = "wasm32")]
                    let mut i = {
                        let nvec = n & !3;
                        if nvec > 0 {
                            unsafe {
                                crate::paint_simd::rgrad_lut_cov_span(
                                    dst.data.as_mut_ptr().add(base + x0 * 4),
                                    bx + x0 as f32 * ax,
                                    by + x0 as f32 * ay,
                                    ax,
                                    ay,
                                    inv_r,
                                    nvec,
                                    lut.as_ptr(),
                                    span.as_ptr(),
                                );
                            }
                        }
                        nvec
                    };
                    #[cfg(not(target_arch = "wasm32"))]
                    let mut i = 0usize;
                    while i < n {
                        let lx = bx + (x0 + i) as f32 * ax;
                        let ly = by + (x0 + i) as f32 * ay;
                        let t = (lx * lx + ly * ly).sqrt() * inv_r;
                        let px = lut[crate::gradlut::lut_index(t)];
                        if (px >> 24) != 0 {
                            grad_blend_px(&mut dst.data, base + (x0 + i) * 4, px, u32::from(span[i]));
                        }
                        i += 1;
                    }
                    off += len;
                    continue;
                }
                for i in 0..len {
                    cov[x0 + i] = span[i] as f32 / 255.0;
                }
                paint_row(dst, y, x0, x0 + len, cov, style, blend, mult);
                off += len;
            }
            prof::count(prof::RZC, nrows);
            prof::count(prof::RINIT, npxc);
            prof::add(prof::COVROW, t0c);
        }
    }
}

fn capture_insert(key: u128, spans: Vec<u64>, px_total: usize, as_plane: bool) {
    #[cfg(feature = "prof")]
    if as_plane && spans.len() >= 8 {
        let (nrows, plane_bytes) = crate::cov_cache::plane_stats(&spans);
        prof::count(prof::PCHK, 1);
        if spans.len() > nrows * 4 && plane_bytes <= px_total.saturating_mul(2) {
            prof::count(prof::PCNV, 1);
            prof::count(prof::PCS, spans.len() as u64);
            prof::count(prof::PCPX, px_total as u64);
            prof::count(prof::PCBY, plane_bytes as u64);
            prof::count(prof::PCROW, nrows as u64);
        }
    }
    if as_plane && crate::cov_cache::spans_fragmented(&spans, px_total) {
        crate::cov_cache::insert(key, crate::cov_cache::spans_to_cov_entry(&spans));
        crate::cov_cache::stow_span_buf(spans);
    } else {
        crate::cov_cache::insert(
            key,
            crate::cov_cache::CovEntry {
                rows: Vec::new(),
                data: crate::cov_cache::PlaneData::Spans(spans),
            },
        );
    }
}




struct RowPainter<'a> {
    dst: &'a mut PixBuf,
    data_ptr: *mut u8,
    stride: usize,
    solid_col: Option<u32>,
    capture: bool,
    skip_paint: bool,
    scan: bool,
    probe_on: bool,
    dbg_shape: bool,
    dbg_rows: &'a mut u64,
    dbg_ext: &'a mut u64,
    dbg_nz: &'a mut u64,
    spans: &'a mut Vec<u64>,
    px_total: &'a mut usize,
    overflow: &'a mut bool,
    #[allow(dead_code)]
    nspans: &'a mut u64,
    #[allow(dead_code)]
    npx: &'a mut u64,
    painter_ref: Option<&'a SpanPaint>,
    cov: &'a mut Vec<f32>,
    style: &'a PaintStyle,
    blend: Blend,
    mult: f64,
}

impl RowSink for RowPainter<'_> {
    #[inline(always)]
    fn span(&mut self, _y: usize, _x0: usize, _len: usize, _cv: u8) {}

    #[inline(always)]
    fn row(&mut self, y: usize, x0: usize, row: &[u8]) {
        let dst = &mut *self.dst;
        let data_ptr = self.data_ptr;
        let stride = self.stride;
        let scan = self.scan;
        let probe_on = self.probe_on;
        let dbg_shape = self.dbg_shape;
        let dbg_rows = &mut *self.dbg_rows;
        let dbg_ext = &mut *self.dbg_ext;
        let dbg_nz = &mut *self.dbg_nz;
        let solid_col = self.solid_col;
        let capture = self.capture;
        let skip_paint = self.skip_paint;
        let spans = &mut *self.spans;
        let px_total = &mut *self.px_total;
        let overflow = &mut *self.overflow;
        #[cfg(feature = "prof")]
        let nspans = &mut *self.nspans;
        #[cfg(feature = "prof")]
        let npx = &mut *self.npx;
        let painter_ref = self.painter_ref;
        let cov = &mut *self.cov;
        let style: &PaintStyle = self.style;
        let blend = self.blend;
        let mult = self.mult;
        let len = row.len();
        if len == 0 {
            return;
        }
        if probe_on && y == 20 {
            let mut segs = String::new();
            let mut i = 0usize;
            while i < len {
                let cv = row[i];
                let s0 = i;
                i += 1;
                while i < len && row[i] == cv {
                    i += 1;
                }
                if cv != 0 {
                    segs.push_str(&format!(" [{},{} cv={}]", x0 + s0, x0 + i, cv));
                }
            }
            PROBE.with(|pp| pp.borrow_mut().push(format!("row20 x0={} len={}{}", x0, len, segs)));
        }
        if dbg_shape {
            *dbg_rows += 1;
            *dbg_ext += len as u64;
            *dbg_nz += row.iter().filter(|&&c| c != 0).count() as u64;
        }
        dst.mark(y, x0, x0 + len);
        if let Some(col) = solid_col {
            if !skip_paint && !capture {
                #[cfg(feature = "prof")]
                {
                    *nspans += 1;
                    *npx += len as u64;
                }
                
                
                
                
                unsafe {
                    crate::paint_simd::solid_cov_row(
                        data_ptr.add(y * stride + x0 * 4),
                        row.as_ptr(),
                        col,
                        len,
                    );
                }
                return;
            }
            if !skip_paint && capture {
                let mut i = 0usize;
                while i < len {
                    let cv = row[i];
                    let s = i;
                    i += 1;
                    while i < len && row[i] == cv {
                        i += 1;
                    }
                    if cv == 0 {
                        continue;
                    }
                    let run = i - s;
                    #[cfg(feature = "prof")]
                    {
                        *nspans += 1;
                        *npx += run as u64;
                    }
                    if spans.len() < SPAN_CAPTURE_MAX {
                        spans.push(crate::cov_cache::pack_span(y, x0 + s, run, cv));
                        *px_total += run;
                    } else {
                        *overflow = true;
                    }
                    unsafe {
                        let p = data_ptr.add(y * stride + (x0 + s) * 4);
                        let cov8 = u32::from(cv);
                        if run < 8 {
                            crate::paint_simd::solid_span_small(p, col, cov8, run);
                        } else {
                            crate::paint_simd::solid_grad_span(p, col, cov8, run);
                        }
                    }
                }
                return;
            }
            if capture {
                let mut i = 0usize;
                while i < len {
                    let cv = row[i];
                    let s = i;
                    i += 1;
                    while i < len && row[i] == cv {
                        i += 1;
                    }
                    if cv == 0 {
                        continue;
                    }
                    let run = i - s;
                    #[cfg(feature = "prof")]
                    {
                        *nspans += 1;
                        *npx += run as u64;
                    }
                    if spans.len() < SPAN_CAPTURE_MAX {
                        spans.push(crate::cov_cache::pack_span(y, x0 + s, run, cv));
                        *px_total += run;
                    } else {
                        *overflow = true;
                    }
                }
            }
            return;
        }
        if !scan {
            return;
        }
        let mut i = 0usize;
        while i < len {
            let cv = row[i];
            let s = i;
            i += 1;
            while i < len && row[i] == cv {
                i += 1;
            }
            if cv == 0 {
                continue;
            }
            let run = i - s;
            #[cfg(feature = "prof")]
            {
                *nspans += 1;
                *npx += run as u64;
            }
            if capture {
                if spans.len() < SPAN_CAPTURE_MAX {
                    spans.push(crate::cov_cache::pack_span(y, x0 + s, run, cv));
                    *px_total += run;
                } else {
                    *overflow = true;
                }
            }
            if skip_paint {
                continue;
            }
            let xs0 = x0 + s;
            let xe = x0 + i;
            if let Some(p) = painter_ref {
                paint_span_fast(p, dst, y, xs0, xe, cv);
            } else {
                let a = cv as f32 / 255.0;
                cov[xs0..xe].fill(a);
                paint_row(dst, y, xs0, xe, cov, style, blend, mult);
            }
        }
    }
}

fn raster_cells(
    dst: &mut PixBuf,
    polys: &[Poly],
    even_odd: bool,
    style: &PaintStyle,
    blend: Blend,
    mult: f64,
    cov: &mut Vec<f32>,
    key: u128,
    prefer_dense: bool,
) {
    #[cfg(feature = "prof")]
    prof::count(prof::FROWG, 1);
    let w = dst.width as usize;
    let h = dst.height as usize;
    if w == 0 || h == 0 || polys.is_empty() {
        return;
    }
    if cov.len() < w {
        cov.resize(w, 0.0f32);
    }
    let capture = if crate::cov_cache::capture_enabled() {
        let rep = crate::cov_cache::seen_recent(key);
        crate::cov_cache::seen_note(key);
        rep
    } else {
        false
    };
    let painter = span_paint_of(style, blend, mult);
    if painter.is_none() {
        prof::count(prof::PAINTS, 1);
    }
    let cov_capture = matches!(style, PaintStyle::Solid(_)) && blend == Blend::SrcOver && mult == 1.0;
    let mut spans = crate::cov_cache::take_span_buf();
    spans.clear();
    let mut px_total = 0usize;
    let mut overflow = false;
    let mut nspans = 0u64;
    let mut npx = 0u64;
    let dbg_shape = cfg!(feature = "prof") && std::env::var("TGS_DBG_SHAPE").is_ok();
    let mut dbg_rows = 0u64;
    let mut dbg_ext = 0u64;
    let mut dbg_nz = 0u64;
    prof::count(prof::RC, 1);
    prof::count(prof::MASKR, 1);
    CELL_RASTER.with(|slot| {
        let mut cells = slot.borrow_mut();
        cells.ensure(w, h);
        let t0d = prof::now();
        let t0s = prof::now();
        let wf = (w as f32) * crate::cells::ONE_SCALE;
        let hf = (h as f32) * crate::cells::ONE_SCALE;
        let deposit_poly = |cells: &mut CellRaster, pts: &[[f64; 2]], wf: f32, hf: f32| {
            let mut prev: Option<(i32, i32)> = None;
            let mut first: Option<(i32, i32)> = None;
            for (idx, p) in pts.iter().enumerate() {
                let (px, py) = (p[0] as f32, p[1] as f32);
                let sp = if px.is_finite() && py.is_finite() {
                    Some((CellRaster::snap_coord(px, wf), CellRaster::snap_coord(py, hf)))
                } else {
                    None
                };
                if idx == 0 {
                    first = sp;
                }
                if let (Some(a), Some(b)) = (prev, sp) {
                    cells.draw_line_snapped(a.0, a.1, b.0, b.1);
                }
                prev = sp;
            }
            if let (Some(a), Some(b)) = (prev, first) {
                cells.draw_line_snapped(a.0, a.1, b.0, b.1);
            }
        };
        let mut bx0 = f32::MAX;
        let mut by0 = f32::MAX;
        let mut bx1 = f32::MIN;
        let mut by1 = f32::MIN;
        let small_canvas = w * h <= DENSE_MAX_PX;
        let want_bbox = prefer_dense && !small_canvas;
        for poly in polys {
            let pts = &poly.pts;
            if pts.len() < 3 {
                continue;
            }
            if poly_offscreen(pts, w as f64, h as f64) {
                continue;
            }
            if want_bbox {
                for p in pts.iter() {
                    let (px, py) = (p[0] as f32, p[1] as f32);
                    if px < bx0 {
                        bx0 = px;
                    }
                    if py < by0 {
                        by0 = py;
                    }
                    if px > bx1 {
                        bx1 = px;
                    }
                    if py > by1 {
                        by1 = py;
                    }
                }
            }
            deposit_poly(&mut cells, pts, wf, hf);
        }
        prof::add(prof::RCDEP, t0d);
        prof::add(prof::SRASDL, t0d);
        let skip_paint = crate::cov_cache::skip_paint();
        let painter_ref = painter.as_ref();
        let solid_col = match painter_ref {
            Some(SpanPaint::Solid(c)) => Some(*c),
            _ => None,
        };
        let small_canvas = w * h <= DENSE_MAX_PX;
        let bbox_px = if bx1 > bx0 && by1 > by0 {
            (bx1 - bx0) as f64 * (by1 - by0) as f64
        } else {
            0.0
        };
        let dense_shape = want_bbox
            && solid_col.is_some()
            && !capture
            && bbox_px <= DENSE_BBOX_PX;
        if small_canvas || dense_shape {
            let data_ptr = dst.data.as_mut_ptr();
            let stride = w * 4;
            let scan = capture || (solid_col.is_none() && !skip_paint);
            let probe_on = PROBE_ON.with(|c| c.get());
            let mut rp = RowPainter {
                dst: &mut *dst,
                data_ptr,
                stride,
                solid_col,
                capture,
                skip_paint,
                scan,
                probe_on,
                dbg_shape,
                dbg_rows: &mut dbg_rows,
                dbg_ext: &mut dbg_ext,
                dbg_nz: &mut dbg_nz,
                spans: &mut spans,
                px_total: &mut px_total,
                overflow: &mut overflow,
                nspans: &mut nspans,
                npx: &mut npx,
                painter_ref,
                cov: &mut *cov,
                style,
                blend,
                mult,
            };
            let t_sw = prof::now();
            if small_canvas {
                cells.sweep_rows_sink(even_odd, &mut rp);
            } else {
                cells.sweep_rows_bits_sink(even_odd, &mut rp);
            }
            prof::add(prof::RCSW, t_sw);
        } else {
            let data_ptr = dst.data.as_mut_ptr();
            let stride = w * 4;
            let solid_prem: Option<[u32; 256]> = match solid_col {
                Some(col) if !skip_paint => {
                    let mut t = [0u32; 256];
                    let a8 = (col >> 24) & 0xff;
                    let cr = col & 0xff;
                    let cg = (col >> 8) & 0xff;
                    let cb = (col >> 16) & 0xff;
                    let mut cv = 0usize;
                    while cv < 256 {
                        let c8 = cv as u32;
                        let sa = if a8 == 255 {
                            c8
                        } else {
                            let x = a8 * c8 + 127;
                            (x + 1 + (x >> 8)) >> 8
                        };
                        let f = |c: u32| -> u32 {
                            let x = c * sa + 127;
                            (x + 1 + (x >> 8)) >> 8
                        };
                        t[cv] = f(cr) | (f(cg) << 8) | (f(cb) << 16) | (sa << 24);
                        cv += 1;
                    }
                    Some(t)
                }
                _ => None,
            };
            let prem_tab = solid_prem.as_ref();
            let mut mk_y = usize::MAX;
            let mut mk0 = 0usize;
            let mut mk1 = 0usize;
            let emit = |y: usize, x0: usize, len: usize, cv: u8| {
                if len == 0 {
                    return;
                }
                if dbg_shape {
                    dbg_rows += 1;
                    dbg_ext += len as u64;
                    dbg_nz += len as u64;
                }
                if !crate::cov_cache::skip_mark() {
                    if y != mk_y {
                        if mk_y != usize::MAX {
                            dst.mark(mk_y, mk0, mk1);
                        }
                        mk_y = y;
                        mk0 = x0;
                        mk1 = x0 + len;
                    } else {
                        if x0 < mk0 {
                            mk0 = x0;
                        }
                        let xe = x0 + len;
                        if xe > mk1 {
                            mk1 = xe;
                        }
                    }
                }
                if !skip_paint {
                    if let Some(tab) = prem_tab {
                        if len < 8 {
                            prof::count(prof::PAINTF, len as u64);
                            let prem = tab[cv as usize];
                            let inv = 256 - (prem >> 24);
                            let p = unsafe { data_ptr.add(y * stride + x0 * 4) };
                            let mut i = 0usize;
                            while i < len {
                                unsafe {
                                    crate::paint_simd::over_prem_px(p.add(i * 4), prem, inv);
                                }
                                i += 1;
                            }
                        } else if let Some(p) = painter_ref {
                            prof::count(prof::PAINTF, len as u64);
                            paint_span_fast(p, dst, y, x0, x0 + len, cv);
                        }
                    } else if let Some(p) = painter_ref {
                        prof::count(prof::PAINTF, len as u64);
                        paint_span_fast(p, dst, y, x0, x0 + len, cv);
                    } else {
                        prof::count(prof::PAINTSP, len as u64);
                        let a = cv as f32 / 255.0;
                        cov[x0..x0 + len].fill(a);
                        paint_row(dst, y, x0, x0 + len, cov, style, blend, mult);
                    }
                }
                if capture {
                    if spans.len() < SPAN_CAPTURE_MAX {
                        spans.push(crate::cov_cache::pack_span(y, x0, len, cv));
                        px_total += len;
                    } else {
                        overflow = true;
                    }
                }
                #[cfg(feature = "prof")]
                {
                    nspans += 1;
                    npx += len as u64;
                }
            };
            cells.sweep_spans(even_odd, emit);
            if mk_y != usize::MAX && !crate::cov_cache::skip_mark() {
                dst.mark(mk_y, mk0, mk1);
            }
        }
        prof::add(prof::SRASSW, t0s);

    });
    prof::count(prof::RACT, nspans);
    prof::count(prof::FROWM, npx);
    if dbg_shape {
        let mut bx0 = f64::MAX;
        let mut by0 = f64::MAX;
        let mut bx1 = f64::MIN;
        let mut by1 = f64::MIN;
        for poly in polys {
            for p in poly.pts.iter() {
                if p[0] < bx0 {
                    bx0 = p[0];
                }
                if p[1] < by0 {
                    by0 = p[1];
                }
                if p[0] > bx1 {
                    bx1 = p[0];
                }
                if p[1] > by1 {
                    by1 = p[1];
                }
            }
        }
        let kind = match style {
            PaintStyle::Solid(_) => "solid",
            PaintStyle::Linear { .. } | PaintStyle::Radial { .. } => "grad",
        };
        eprintln!(
            "[shape] polys={} rows={} ext={} nz={} bbox=({:.1},{:.1})-({:.1},{:.1}) kind={} eo={}",
            polys.len(),
            dbg_rows,
            dbg_ext,
            dbg_nz,
            bx0,
            by0,
            bx1,
            by1,
            kind,
            even_odd
        );
    }
    if capture && !overflow {
        let t_cap = prof::now();
        capture_insert(key, spans, px_total, cov_capture);
        prof::add(prof::RCCAP, t_cap);
    } else {
        crate::cov_cache::stow_span_buf(spans);
    }
}

fn raster_accum(
    dst: &mut PixBuf,
    polys: &[Poly],
    even_odd: bool,
    style: &PaintStyle,
    blend: Blend,
    mult: f64,
    cov: &mut Vec<f32>,
    key: u128,
) {
    #[cfg(feature = "prof")]
    prof::count(prof::FPTS, 1);
    let w = dst.width as usize;
    let h = dst.height as usize;
    if w == 0 || h == 0 || polys.is_empty() {
        return;
    }
    if cov.len() < w {
        cov.resize(w, 0.0f32);
    }
    let capture = if crate::cov_cache::capture_enabled() {
        let rep = crate::cov_cache::seen_recent(key);
        crate::cov_cache::seen_note(key);
        rep
    } else {
        false
    };
    let painter = span_paint_of(style, blend, mult);
    if painter.is_none() {
        prof::count(prof::PAINTS, 1);
    }
    let cov_capture = matches!(style, PaintStyle::Solid(_)) && blend == Blend::SrcOver && mult == 1.0;
    let mut spans = crate::cov_cache::take_span_buf();
    spans.clear();
    let mut px_total = 0usize;
    let mut overflow = false;
    prof::count(prof::RC, 1);
    let solid_col = match painter.as_ref() {
        Some(SpanPaint::Solid(col)) => Some(*col),
        _ => None,
    };
    let skip_paint = crate::cov_cache::skip_paint();
    crate::accum::with(w, h, |raster| {
        let t0ad = prof::now();
        for poly in polys {
            let pts = &poly.pts;
            if pts.len() < 2 {
                continue;
            }
            if pts.len() >= 3 && poly_offscreen(pts, w as f64, h as f64) {
                continue;
            }
            raster.fill_contours(pts);
        }
        prof::add(prof::ADL, t0ad);
        if let Some(col) = solid_col {
            let t0aw = prof::now();
            raster.sweep(even_odd, &mut |y: usize, x0: usize, slice: &[u8]| {
                let base = y * 4 * w + x0 * 4;
                dst.mark(y, x0, x0 + slice.len());
                if !skip_paint {
                    unsafe {
                        crate::paint_simd::solid_cov_row(dst.data.as_mut_ptr().add(base), slice.as_ptr(), col, slice.len());
                    }
                }
                if capture {
                    let mut pend: Option<(usize, usize, u8)> = None;
                    for (i, &c) in slice.iter().enumerate() {
                        let xe = x0 + i;
                        match &mut pend {
                            Some((px0, plen, pcov)) if *pcov == c && *px0 + *plen == xe => {
                                *plen += 1;
                            }
                            other => {
                                if let Some((px0, plen, pcov)) = other.take() {
                                    if spans.len() < SPAN_CAPTURE_MAX {
                                        spans.push(crate::cov_cache::pack_span(y, px0, plen, pcov));
                                        px_total += plen;
                                    } else {
                                        overflow = true;
                                    }
                                }
                                if c != 0 {
                                    *other = Some((xe, 1, c));
                                }
                            }
                        }
                    }
                    if let Some((px0, plen, pcov)) = pend.take() {
                        if spans.len() < SPAN_CAPTURE_MAX {
                            spans.push(crate::cov_cache::pack_span(y, px0, plen, pcov));
                            px_total += plen;
                        } else {
                            overflow = true;
                        }
                    }
                }
            });
            prof::add(prof::ASW, t0aw);
            return;
        }
        let t0aw = prof::now();
        raster.sweep(even_odd, &mut |y: usize, x0: usize, slice: &[u8]| {
            dst.mark(y, x0, x0 + slice.len());
            let mut pend: Option<(usize, usize, u8)> = None;
            for (i, &c) in slice.iter().enumerate() {
                let xe = x0 + i;
                match &mut pend {
                    Some((px0, plen, pcov)) if *pcov == c && *px0 + *plen == xe => {
                        *plen += 1;
                    }
                    other => {
                        if let Some((px0, plen, pcov)) = other.take() {
                            let e1 = px0 + plen;
                            if skip_paint {
                            } else if let Some(p) = painter.as_ref() {
                                paint_span_fast(p, dst, y, px0, e1, pcov);
                            } else {
                                let a = pcov as f32 / 255.0;
                                cov[px0..e1].fill(a);
                                paint_row(dst, y, px0, e1, cov, style, blend, mult);
                            }
                        }
                        if c != 0 {
                            *other = Some((xe, 1, c));
                        }
                    }
                }
            }
            if let Some((px0, plen, pcov)) = pend.take() {
                let e1 = px0 + plen;
                if skip_paint {
                } else if let Some(p) = painter.as_ref() {
                    paint_span_fast(p, dst, y, px0, e1, pcov);
                } else {
                    let a = pcov as f32 / 255.0;
                    cov[px0..e1].fill(a);
                    paint_row(dst, y, px0, e1, cov, style, blend, mult);
                }
            }
            if capture {
                let mut pend: Option<(usize, usize, u8)> = None;
                for (i, &c) in slice.iter().enumerate() {
                    let xe = x0 + i;
                    match &mut pend {
                        Some((px0, plen, pcov)) if *pcov == c && *px0 + *plen == xe => {
                            *plen += 1;
                        }
                        other => {
                            if let Some((px0, plen, pcov)) = other.take() {
                                if spans.len() < SPAN_CAPTURE_MAX {
                                    spans.push(crate::cov_cache::pack_span(y, px0, plen, pcov));
                                    px_total += plen;
                                } else {
                                    overflow = true;
                                }
                            }
                            if c != 0 {
                                *other = Some((xe, 1, c));
                            }
                        }
                    }
                }
                if let Some((px0, plen, pcov)) = pend.take() {
                    if spans.len() < SPAN_CAPTURE_MAX {
                        spans.push(crate::cov_cache::pack_span(y, px0, plen, pcov));
                        px_total += plen;
                    } else {
                        overflow = true;
                    }
                }
            }
        });
        prof::add(prof::ASW, t0aw);
    });
    if capture && !overflow {
        capture_insert(key, spans, px_total, cov_capture);
    } else {
        crate::cov_cache::stow_span_buf(spans);
    }
}

enum SpanPaint {
    Solid(u32),
    Linear { gx0: f32, gy0: f32, gdy: f32, gdtn: f32, gdinv: f32, lut: std::rc::Rc<Vec<u32>>, opaque: bool },
    Radial { map: RadialMap, lut: std::rc::Rc<Vec<u32>>, opaque: bool },
}

fn span_paint_of(style: &PaintStyle, blend: Blend, mult: f64) -> Option<SpanPaint> {
    if blend != Blend::SrcOver || mult != 1.0 {
        return None;
    }
    match style {
        PaintStyle::Solid(c) => Some(SpanPaint::Solid(crate::gradlut::solid_col_u32(c))),
        PaintStyle::Linear { x0, y0, x1, y1, stops } => {
            let dx = x1 - x0;
            let dy = y1 - y0;
            let len2 = dx * dx + dy * dy;
            let (lut, opaque) = crate::gradlut::lut_pix_and_opaque(stops);
            if len2 > 1e-9 {
                let dinv = 1.0 / len2;
                Some(SpanPaint::Linear {
                    gx0: *x0,
                    gy0: *y0,
                    gdy: dy,
                    gdtn: dx * dinv,
                    gdinv: dinv,
                    lut,
                    opaque,
                })
            } else {
                Some(SpanPaint::Solid(lut[0]))
            }
        }
        PaintStyle::Radial { map, stops } => {
            let (lut, opaque) = crate::gradlut::lut_pix_and_opaque(stops);
            if map.inv_r == 0.0 {
                Some(SpanPaint::Solid(lut[0]))
            } else {
                Some(SpanPaint::Radial {
                    map: *map,
                    lut,
                    opaque,
                })
            }
        }
    }
}

fn paint_span_fast(p: &SpanPaint, dst: &mut PixBuf, row: usize, c0: usize, c1: usize, cova8: u8) {
    #[cfg(feature = "prof")]
    match p {
        SpanPaint::Solid(_) => {
            prof::count(prof::SOLIDPX, (c1 - c0) as u64);
            prof::count(prof::SOLIDSP, 1);
        }
        _ => {
            prof::count(prof::GRADPX, (c1 - c0) as u64);
            prof::count(prof::GRADSP, 1);
        }
    }
    if c1 - c0 < 8 {
        prof::count(prof::SPANSHORT, 1);
        prof::count(prof::SPANSHORTPX, (c1 - c0) as u64);
    }
    prof::count(prof::SPANPXP, (c1 - c0) as u64);
    match p {
        SpanPaint::Solid(col) => {
            let base = row * 4 * dst.width as usize;
            unsafe {
                let p = dst.data.as_mut_ptr().add(base + c0 * 4);
                let n = c1 - c0;
                if n < 8 {
                    crate::paint_simd::solid_span_small(p, *col, u32::from(cova8), n);
                } else {
                    crate::paint_simd::solid_grad_span(p, *col, u32::from(cova8), n);
                }
            }
        }
        SpanPaint::Linear { gx0, gy0, gdy, gdtn, gdinv, lut, opaque } => {
            let gc = (row as f32 + 0.5 - *gy0) * *gdy;
            paint_grad_span(dst, row, c0, c1, cova8, *gx0, *gdtn, gc * *gdinv, lut, *opaque);
        }
        SpanPaint::Radial { map, lut, opaque } => {
            paint_rgrad_span(dst, row, c0, c1, cova8, map, lut, *opaque);
        }
    }
}

fn paint_span_row(
    dst: &mut PixBuf,
    row: usize,
    c0: usize,
    c1: usize,
    cova8: u8,
    cov: &mut [f32],
    style: &PaintStyle,
    blend: Blend,
    mult: f64,
) {
    if c0 >= c1 {
        return;
    }
    dst.mark(row, c0, c1);
    if blend == Blend::SrcOver && mult == 1.0 {
        if let PaintStyle::Solid(c) = style {
            let col = crate::gradlut::solid_col_u32(c);
            let n = c1 - c0;
            let base = row * 4 * dst.width as usize;
            unsafe {
                crate::paint_simd::solid_grad_span(
                    dst.data.as_mut_ptr().add(base + c0 * 4),
                    col,
                    u32::from(cova8),
                    n,
                );
            }
            return;
        }
        if let PaintStyle::Linear { x0, y0, x1, y1, stops } = style {
            let dx = x1 - x0;
            let dy = y1 - y0;
            let len2 = dx * dx + dy * dy;
            if len2 > 1e-9 {
                let dinv = 1.0 / len2;
                let gc = (row as f32 + 0.5 - *y0) * dy;
                let (lut, opaque) = crate::gradlut::lut_pix_and_opaque(stops);
                paint_grad_span(dst, row, c0, c1, cova8, *x0, dx * dinv, gc * dinv, &lut, opaque);
                return;
            }
        }
        if let PaintStyle::Radial { map, stops } = style {
            let (lut, opaque) = crate::gradlut::lut_pix_and_opaque(stops);
            paint_rgrad_span(dst, row, c0, c1, cova8, map, &lut, opaque);
            return;
        }
    }
    paint_row(dst, row, c0, c1, cov, style, blend, mult);
}

fn grad_blend_px(data: &mut [u8], p: usize, px: u32, cov: u32) {
    let f = |n: u32| -> u32 {
        let t = n + 127;
        (t + 1 + (t >> 8)) >> 8
    };
    let sa = f(u32::from((px >> 24) & 0xff) * cov);
    let s_r = f(u32::from(px & 0xff) * cov);
    let s_g = f(u32::from((px >> 8) & 0xff) * cov);
    let s_b = f(u32::from((px >> 16) & 0xff) * cov);
    let prem = s_r | (s_g << 8) | (s_b << 16) | (sa << 24);
    unsafe { crate::paint_simd::over_prem_px(data.as_mut_ptr().add(p), prem, 256 - sa) };
}

fn paint_rgrad_span(
    dst: &mut PixBuf,
    row: usize,
    c0: usize,
    c1: usize,
    cova8: u8,
    map: &RadialMap,
    lut: &[u32],
    lut_opaque: bool,
) {
    let base = row * 4 * dst.width as usize;
    let data = &mut dst.data;
    let c8 = u32::from(cova8);
    let direct = lut_opaque && c8 == 255;
    let (bx, by) = map.row_origin(row);
    let (ax, ay, inv_r) = (map.ia, map.ib, map.inv_r);
    #[cfg(target_arch = "wasm32")]
    let mut col0 = c0;
    #[cfg(not(target_arch = "wasm32"))]
    let col0 = c0;
    #[cfg(target_arch = "wasm32")]
    {
        let n = c1 - c0;
        if n >= 8 {
            let head = n & !3;
            let out = core::ptr::null_mut();
            let x0 = c0 as f32;
            unsafe {
                if direct {
                    crate::paint_simd::rgrad_lut_fill(
                        data.as_mut_ptr().add(base + c0 * 4),
                        bx + x0 * ax,
                        by + x0 * ay,
                        ax,
                        ay,
                        inv_r,
                        head,
                        lut.as_ptr(),
                        out,
                    );
                } else {
                    crate::paint_simd::rgrad_lut_span(
                        data.as_mut_ptr().add(base + c0 * 4),
                        bx + x0 * ax,
                        by + x0 * ay,
                        ax,
                        ay,
                        inv_r,
                        head,
                        lut.as_ptr(),
                        c8,
                        out,
                    );
                }
            }
            col0 = c0 + head;
        }
    }
    for col in col0..c1 {
        let lx = bx + col as f32 * ax;
        let ly = by + col as f32 * ay;
        let t = (lx * lx + ly * ly).sqrt() * inv_r;
        let idx = crate::gradlut::lut_index(t);
        let px = lut[idx];
        if direct {
            let p = base + col * 4;
            unsafe {
                core::ptr::write_unaligned(data.as_mut_ptr().add(p) as *mut u32, px);
            }
            continue;
        }
        if (px >> 24) != 0 {
            grad_blend_px(data, base + col * 4, px, c8);
        }
    }
}

#[inline(always)]
fn paint_grad_span(
    dst: &mut PixBuf,
    row: usize,
    c0: usize,
    c1: usize,
    cova8: u8,
    gx0: f32,
    gdtn: f32,
    gcn: f32,
    lut: &[u32],
    lut_opaque: bool,
) {
    paint_grad_span_bias(dst, row, c0, c1, cova8, gcn - gx0 * gdtn, gdtn, lut, lut_opaque);
}

fn paint_grad_span_bias(
    dst: &mut PixBuf,
    row: usize,
    c0: usize,
    c1: usize,
    cova8: u8,
    bias: f32,
    gdtn: f32,
    lut: &[u32],
    lut_opaque: bool,
) {
    let base = row * 4 * dst.width as usize;
    let data = &mut dst.data;
    let c8 = u32::from(cova8);
    let direct = lut_opaque && c8 == 255;
    let n = c1 - c0;
    
    
    
    
    if !direct && n > 0 {
        let t0v = (c0 as f32 + 0.5) * gdtn + bias;
        let i0 = crate::gradlut::lut_index(t0v);
        let i1 = crate::gradlut::lut_index(t0v + (n - 1) as f32 * gdtn);
        if i0 == i1 {
            let px = lut[i0];
            if (px >> 24) != 0 {
                unsafe {
                    crate::paint_simd::blend_prem_span(
                        data.as_mut_ptr().add(base + c0 * 4),
                        px,
                        c8,
                        n,
                    );
                }
            }
            return;
        }
    }
    #[cfg(target_arch = "wasm32")]
    if n >= 8 {
        let full = n & !3;
        let out = core::ptr::null_mut();
        unsafe {
            if direct {
                crate::paint_simd::grad_lut_fill(
                    data.as_mut_ptr().add(base + c0 * 4),
                    (c0 as f32 + 0.5) * gdtn + bias,
                    gdtn,
                    full,
                    lut.as_ptr(),
                    out,
                );
            } else {
                crate::paint_simd::grad_lut_span(
                    data.as_mut_ptr().add(base + c0 * 4),
                    (c0 as f32 + 0.5) * gdtn + bias,
                    gdtn,
                    full,
                    lut.as_ptr(),
                    c8,
                    out,
                );
            }
        }
        let s1 = c0 + full;
        let t0s = (s1 as f32 + 0.5) * gdtn + bias;
        let mut i = s1;
        while i < c1 {
            let idx = crate::gradlut::lut_index(t0s + (i - s1) as f32 * gdtn);
            let px = lut[idx];
            if direct {
                let p = base + i * 4;
                unsafe {
                    core::ptr::write_unaligned(data.as_mut_ptr().add(p) as *mut u32, px);
                }
                i += 1;
                continue;
            }
            if (px >> 24) != 0 {
                grad_blend_px(data, base + i * 4, px, u32::from(c8));
            }
            i += 1;
        }
        return;
    }
    let t0 = (c0 as f32 + 0.5) * gdtn + bias;
    let mut i = 0usize;
    while c0 + i < c1 {
        let col = c0 + i;
        let idx = crate::gradlut::lut_index(t0 + i as f32 * gdtn);
        let px = lut[idx];
        if direct {
            let p = base + col * 4;
            unsafe {
                core::ptr::write_unaligned(data.as_mut_ptr().add(p) as *mut u32, px);
            }
            i += 1;
            continue;
        }
        if (px >> 24) != 0 {
            grad_blend_px(data, base + col * 4, px, c8);
        }
        i += 1;
    }
}

fn paint_row(
    dst: &mut PixBuf,
    row: usize,
    c0: usize,
    c1: usize,
    cov: &mut [f32],
    style: &PaintStyle,
    blend: Blend,
    mult: f64,
) {
    let wpx = dst.width as usize;
    if c0 >= c1 {
        return;
    }
    dst.mark(row, c0, c1);
    let y = row as f64;
    let base = row * 4 * wpx;
    let data = &mut dst.data;
    if blend == Blend::SrcOver && mult == 1.0 {
        if let PaintStyle::Solid(c) = style {
            unsafe {
                crate::paint_simd::paint_solid_row(
                    data.as_mut_ptr().add(base + c0 * 4),
                    cov.as_ptr().add(c0),
                    c.r,
                    c.g,
                    c.b,
                    c.a,
                    c1 - c0,
                );
            }
            return;
        }
    }
    let lin: Option<(f32, f32, f32, std::rc::Rc<Vec<[f32; 4]>>)> = match style {
        PaintStyle::Linear { x0, y0, x1, y1, stops } => {
            let dx = x1 - x0;
            let dy = y1 - y0;
            let len2 = dx * dx + dy * dy;
            if len2 <= 1e-9 {
                None
            } else {
                let ys = y as f32 + 0.5;
                let c = (ys - *y0) * dy;
                let dinv = 1.0 / len2;
                let lut = crate::gradlut::lut_of(stops);
                Some((*x0, dx * dinv, c * dinv, lut))
            }
        }
        _ => None,
    };
    let rad: Option<(RadialMap, std::rc::Rc<Vec<[f32; 4]>>)> = if lin.is_none() {
        match style {
            PaintStyle::Radial { map, stops } => Some((*map, crate::gradlut::lut_of(stops))),
            _ => None,
        }
    } else {
        None
    };
    let phase = if lin.is_some() {
        prof::FROWG
    } else if mult != 1.0 {
        prof::FROWM
    } else {
        prof::FROWX
    };
    prof::count(prof::BLEND0 + blend as usize, (c1 - c0) as u64);
    let t0x = prof::now();
    for col in c0..c1 {
        let a_cov = cov[col];
        if a_cov <= 0.0 {
            continue;
        }
        let a = (a_cov as f64 * mult).clamp(0.0, 1.0);
        let x = col as f32 + 0.5;
        let c = match (&lin, &rad, style) {
            (Some((gx0, gdtn, gcn, lut)), _, _) => {
                let t = (x - gx0) * gdtn + gcn;
                crate::gradlut::lut_at(lut, t)
            }
            (_, Some((map, lut)), _) => {
                let t = map.at(x, y as f32 + 0.5);
                crate::gradlut::lut_at(lut, t)
            }
            (_, _, PaintStyle::Solid(c)) => [c.r, c.g, c.b, c.a],
            (_, _, _) => {
                let p = style.sample(x, y as f32 + 0.5);
                [p.r, p.g, p.b, p.a]
            }
        };
        let sa = (c[3] * a as f32).clamp(0.0, 1.0);
        let idx = base + col * 4;
        if sa <= 0.0 && blend == Blend::SrcOver {
            continue;
        }
        let s = [c[0] * sa, c[1] * sa, c[2] * sa, sa];
        let d = [
            data[idx] as f32 / 255.0,
            data[idx + 1] as f32 / 255.0,
            data[idx + 2] as f32 / 255.0,
            data[idx + 3] as f32 / 255.0,
        ];
        let r = compose(blend, s, d);
        data[idx] = (r[0] * 255.0).round().clamp(0.0, 255.0) as u8;
        data[idx + 1] = (r[1] * 255.0).round().clamp(0.0, 255.0) as u8;
        data[idx + 2] = (r[2] * 255.0).round().clamp(0.0, 255.0) as u8;
        data[idx + 3] = (r[3] * 255.0).round().clamp(0.0, 255.0) as u8;
    }
    prof::count(phase, 1);
    prof::add(prof::PROW, t0x);
}

pub fn alpha_plane(buf: &PixBuf) -> Vec<u8> {
    let n = (buf.width as usize) * (buf.height as usize);
    let mut out = vec![0u8; n];
    for i in 0..n {
        out[i] = buf.data[i * 4 + 3];
    }
    out
}

pub fn blit_dest_in_u8(src_alpha: &[u8], dst: &mut PixBuf) {
    let w = dst.width as usize;
    let h = dst.height as usize;
    if src_alpha.len() < w * h {
        return;
    }
    dst.mark_all();
    for y in 0..h {
        let base = y * w * 4;
        let n = w * 4;
        let f = &src_alpha[y * w..(y + 1) * w];
        let d = &mut dst.data[base..base + n];
        unsafe {
            crate::paint_simd::blit_dest_in_u8(f.as_ptr(), d.as_mut_ptr(), n);
        }
    }
}

pub fn blit(src: &PixBuf, dst: &mut PixBuf, blend: Blend, opacity: f64) {
    if src.width != dst.width || src.height != dst.height {
        return;
    }
    let op = opacity.clamp(0.0, 1.0) as f64;
    if op <= 0.0 && blend != Blend::DestOut {
        return;
    }
    let w = dst.width as usize;
    let h = dst.height as usize;
    let full_opacity = op >= 1.0 - 1e-9;
    if blend == Blend::SrcOver && w % 4 == 0 {
        let Some((_, sy0, _, sy1)) = src.dirty() else {
            return;
        };
        for y in sy0..sy1 {
            let Some((a, b)) = src.row_dirty(y) else {
                continue;
            };
            let x0 = a & !3;
            let x1 = ((b + 3) & !3).min(w);
            if x0 >= x1 {
                continue;
            }
            let base = (y * w + x0) * 4;
            let n = (x1 - x0) * 4;
            dst.mark(y, x0, x1);
            let s = &src.data[base..base + n];
            let d = &mut dst.data[base..base + n];
            unsafe {
                crate::paint_simd::blit_srover(s.as_ptr(), d.as_mut_ptr(), n, op, full_opacity);
            }
        }
        return;
    }
    if src.dirty().is_none() {
        return;
    }
    dst.mark_all();
    let fast_src_over = blend == Blend::SrcOver;
    for y in 0..h {
        let base = y * w * 4;
        let n = w * 4;
        let s = &src.data[base..base + n];
        let d = &mut dst.data[base..base + n];
        if fast_src_over {
            unsafe {
                crate::paint_simd::blit_srover(s.as_ptr(), d.as_mut_ptr(), n, op, full_opacity);
            }
            continue;
        }
        if full_opacity {
            match blend {
                Blend::DestIn => {
                    unsafe {
                        crate::paint_simd::blit_dest_in(s.as_ptr(), d.as_mut_ptr(), n);
                    }
                    continue;
                }
                Blend::DestOut => {
                    unsafe {
                        crate::paint_simd::blit_dest_out(s.as_ptr(), d.as_mut_ptr(), n);
                    }
                    continue;
                }
                _ => {}
            }
        }
        for i in (0..n).step_by(4) {
            let mut sa = s[i + 3] as f32 / 255.0;
            if sa <= 0.0 && blend != Blend::DestOut {
                continue;
            }
            sa *= op as f32;
            let sv: [f32; 4] = [s[i] as f32 / 255.0, s[i + 1] as f32 / 255.0, s[i + 2] as f32 / 255.0, sa];
            let dv: [f32; 4] = [
                d[i] as f32 / 255.0,
                d[i + 1] as f32 / 255.0,
                d[i + 2] as f32 / 255.0,
                d[i + 3] as f32 / 255.0,
            ];
            let r = compose(blend, sv, dv);
            d[i] = (r[0] * 255.0).round().clamp(0.0, 255.0) as u8;
            d[i + 1] = (r[1] * 255.0).round().clamp(0.0, 255.0) as u8;
            d[i + 2] = (r[2] * 255.0).round().clamp(0.0, 255.0) as u8;
            d[i + 3] = (r[3] * 255.0).round().clamp(0.0, 255.0) as u8;
        }
    }
}

pub fn matte_apply(matte: &mut PixBuf, src: &PixBuf, cut: bool) {
    let Some((cy0, _, cy1, _)) = matte.dirty() else {
        return;
    };
    let sdirty = src.dirty();
    let w = matte.width as usize;
    let sw = src.width as usize;
    for y in cy0..=cy1 {
        let Some((a, b)) = matte.row_dirty(y) else {
            continue;
        };
        let srow = sdirty
            .filter(|d| y >= d.1 && y <= d.3)
            .and_then(|_| src.row_dirty(y));
        let (ia, ib) = match srow {
            Some((sa_, sb_)) => (a.max(sa_), b.min(sb_)),
            None => (a, a),
        };
        let mbase = y * w * 4;
        let sbase = y * sw * 4;
        let mut wrote = false;
        if cut {
            
            if ia > a {
                matte.data[mbase + a * 4..mbase + ia * 4].fill(0);
            }
            if b > ib {
                matte.data[mbase + ib * 4..mbase + b * 4].fill(0);
            }
            wrote = true;
        }
        if ib > ia {
            let n = (ib - ia) * 4;
            let d = matte.data[mbase + ia * 4..mbase + ia * 4 + n].as_mut_ptr();
            let s = src.data[sbase + ia * 4..sbase + ia * 4 + n].as_ptr();
            unsafe {
                if cut {
                    crate::paint_simd::blit_dest_in(s, d, n);
                } else {
                    
                    
                    
                    let nv = n & !15;
                    crate::paint_simd::blit_dest_out(s, d, nv);
                    let mut i = nv;
                    while i < n {
                        let f = 255 - u32::from(*s.add(i + 3));
                        for c in 0..4 {
                            let v = u32::from(*d.add(i + c));
                            let x = v * f + 127;
                            *d.add(i + c) = ((x + 1 + (x >> 8)) >> 8) as u8;
                        }
                        i += 4;
                    }
                }
            }
            wrote = true;
        }
        if wrote {
            matte.mark(y, a, b);
        }
    }
}


fn mask_factor(cov: u32, subtract: bool, inverted: bool, alpha: u32) -> u32 {
    let contribution = if inverted { 255 - cov } else { cov };
    let contribution = (contribution * alpha + 127) / 255;
    if subtract {
        255 - contribution
    } else {
        contribution
    }
}

fn modulate_mask_range(content: &mut PixBuf, y: usize, x0: usize, x1: usize, factor: u32) {
    if x0 >= x1 || factor == 255 {
        return;
    }
    let base = y * 4 * content.width as usize;
    for x in x0..x1 {
        let p = base + x * 4;
        if factor == 0 {
            content.data[p] = 0;
            content.data[p + 1] = 0;
            content.data[p + 2] = 0;
            content.data[p + 3] = 0;
        } else {
            for c in 0..4 {
                let v = u32::from(content.data[p + c]);
                content.data[p + c] = ((v * factor + 127) / 255).min(255) as u8;
            }
        }
    }
}

pub fn mask_spans(w: u32, h: u32, cmds: &[Pc], even_odd: bool) -> Vec<u64> {
    let mut spans: Vec<u64> = Vec::new();
    if w == 0 || h == 0 || cmds.is_empty() {
        return spans;
    }
    let polys = clip_polys_rect(&clip_polys(&flatten_shared(cmds)), w as f32, h as f32);
    if polys.is_empty() {
        return spans;
    }
    prof::count(prof::RC, 1);
    prof::count(prof::MASKR, 1);
    CELL_RASTER.with(|slot| {
        let mut cells = slot.borrow_mut();
        cells.ensure(w as usize, h as usize);
        let wf = (w as f32) * crate::cells::ONE_SCALE;
        let hf = (h as f32) * crate::cells::ONE_SCALE;
        for poly in polys.iter() {
            let pts = &poly.pts;
            if pts.len() < 3 {
                continue;
            }
            if poly_offscreen(pts, w as f64, h as f64) {
                continue;
            }
            let mut prev: Option<(i32, i32)> = None;
            let mut first: Option<(i32, i32)> = None;
            for (idx, p) in pts.iter().enumerate() {
                let (px, py) = (p[0] as f32, p[1] as f32);
                let sp = if px.is_finite() && py.is_finite() {
                    Some((CellRaster::snap_coord(px, wf), CellRaster::snap_coord(py, hf)))
                } else {
                    None
                };
                if idx == 0 {
                    first = sp;
                }
                if let (Some(a), Some(b)) = (prev, sp) {
                    cells.draw_line_snapped(a.0, a.1, b.0, b.1);
                }
                prev = sp;
            }
            if let (Some(a), Some(b)) = (prev, first) {
                cells.draw_line_snapped(a.0, a.1, b.0, b.1);
            }
        }
        cells.sweep_spans(even_odd, |y: usize, x0: usize, len: usize, cv: u8| {
            spans.push(crate::cov_cache::pack_span(y, x0, len, cv));
        });
    });
    spans
}

pub fn modulate_mask_spans(content: &mut PixBuf, spans: &[u64], subtract: bool, inverted: bool, alpha: u32) {
    let h = content.height as usize;
    let outside = mask_factor(0, subtract, inverted, alpha);
    let mut i = 0usize;
    while i < spans.len() {
        let (y, _, _, _) = crate::cov_cache::unpack_span(spans[i]);
        if y >= h {
            break;
        }
        let Some((a, b)) = content.row_dirty(y) else {
            while i < spans.len() {
                let (y2, _, _, _) = crate::cov_cache::unpack_span(spans[i]);
                if y2 != y {
                    break;
                }
                i += 1;
            }
            continue;
        };
        let mut cursor = a;
        while i < spans.len() {
            let (y2, x0, len, cv) = crate::cov_cache::unpack_span(spans[i]);
            if y2 != y {
                break;
            }
            i += 1;
            let s0 = x0.max(a);
            let s1 = (x0 + len).min(b);
            if s0 >= s1 {
                continue;
            }
            if cursor < s0 {
                modulate_mask_range(content, y, cursor, s0, outside);
            }
            let f = mask_factor(u32::from(cv), subtract, inverted, alpha);
            let p0 = cursor.max(s0);
            modulate_mask_range(content, y, p0, s1, f);
            cursor = cursor.max(s1);
        }
        if cursor < b {
            modulate_mask_range(content, y, cursor, b, outside);
        }
        content.mark(y, a, b);
    }
}

pub fn apply_luma(buf: &mut PixBuf) {
    buf.mark_all();
    let d = &mut buf.data;
    let n = d.len();
    let mut i = 0;
    while i + 3 < n {
        let a = d[i + 3] as u32;
        if a == 0 {
            d[i] = 0;
            d[i + 1] = 0;
            d[i + 2] = 0;
            i += 4;
            continue;
        }
        let af = a as f64 / 255.0;
        let r = (d[i] as f64 / 255.0) / af;
        let g = (d[i + 1] as f64 / 255.0) / af;
        let b = (d[i + 2] as f64 / 255.0) / af;
        let lum = ((0.299 * r + 0.587 * g + 0.114 * b).trunc() * 255.0).clamp(0.0, 255.0);
        d[i] = 0;
        d[i + 1] = 0;
        d[i + 2] = 0;
        d[i + 3] = lum as u8;
        i += 4;
    }
}

pub fn fill(dst: &mut PixBuf, cmds: &[Pc], even_odd: bool, style: &PaintStyle) {
    fill_pix(dst, cmds, even_odd, style, Blend::SrcOver, 1.0);
}

pub fn fill_with(dst: &mut PixBuf, cmds: &[Pc], even_odd: bool, style: &PaintStyle, blend: Blend, mult: f64) {
    fill_pix(dst, cmds, even_odd, style, blend, mult);
}

const ARC_TOL: f32 = 0.05;

thread_local! {
    static OUT_SCALE: core::cell::Cell<f64> = const { core::cell::Cell::new(1.0) };
}

fn set_out_scale(w: u32) {
    OUT_SCALE.with(|c| c.set((w as f64 / 512.0).clamp(0.05, 1.0)));
}

fn arc_step(r: f32) -> f32 {
    let scale = OUT_SCALE.with(|c| c.get()) as f32;
    let tol = ARC_TOL / scale.max(0.05);
    let max_step = (0.35 / scale.max(0.05)).min(1.2);
    (8.0 * tol / r.max(1e-3)).sqrt().clamp(0.0655, max_step)
}

fn dir_of(a: [f64; 2], b: [f64; 2]) -> [f64; 2] {
    [b[0] - a[0], b[1] - a[1]]
}

fn push_arc(out: &mut Vec<[f64; 2]>, c: [f64; 2], a0: f32, sweep: f32, r: f32) {
    let n = ((sweep.abs() / arc_step(r)).ceil() as usize).clamp(1, 48);
    for k in 1..=n {
        let t = k as f32 / n as f32;
        let ang = a0 + sweep * t;
        out.push([(c[0] as f32 + ang.cos() * r) as f64, (c[1] as f32 + ang.sin() * r) as f64]);
    }
}

const COS_SMOOTH: f32 = 0.995_184_7;

struct SBorder {
    pts: Vec<[f64; 2]>,
    movable: bool,
}

impl SBorder {
    fn new(pts: Vec<[f64; 2]>) -> Self {
        SBorder { pts, movable: false }
    }

    fn line_to(&mut self, x: f64, y: f64, movable: bool) {
        if self.movable {
            if let Some(last) = self.pts.last_mut() {
                last[0] = x;
                last[1] = y;
            }
        } else if let Some(q) = self.pts.last() {
            if (q[0] - x).abs() >= 0.03125 || (q[1] - y).abs() >= 0.03125 {
                self.pts.push([x, y]);
            }
        } else {
            self.pts.push([x, y]);
        }
        self.movable = movable;
    }

    fn arc_to(&mut self, c: [f64; 2], r: f64, a0: f64, sweep: f64) {
        self.movable = false;
        let n = ((sweep.abs() / f64::from(arc_step(r as f32))).ceil() as usize).clamp(1, 48);
        for k in 1..=n {
            let ang = a0 + sweep * (k as f64 / n as f64);
            self.pts.push([(c[0] + ang.cos() * r) as f64, (c[1] + ang.sin() * r) as f64]);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn process_corner(
    b0: &mut SBorder,
    b1: &mut SBorder,
    p: [f64; 2],
    d_in: [f64; 2],
    d_out: [f64; 2],
    prev_len: f64,
    next_len: f64,
    gap: bool,
    half: f64,
    join: u8,
    mlimit: f64,
) {
    let cross = d_in[0] * d_out[1] - d_in[1] * d_out[0];
    let dot = d_in[0] * d_out[0] + d_in[1] * d_out[1];
    if cross.abs() < 1e-6 && dot >= 0.0 && !gap {
        return;
    }
    let reversal = cross.abs() < 1e-6 && dot < 0.0;
    let inside_is_b0 = if reversal { true } else { cross > 0.0 };
    let (bi, bo, si, so) = if inside_is_b0 { (b0, b1, 1.0f64, -1.0f64) } else { (b1, b0, -1.0f64, 1.0f64) };
    let n_in = [-d_in[1], d_in[0]];
    let n_out = [-d_out[1], d_out[0]];
    let denom = 1.0 + dot;
    let can_intersect = !reversal && denom > 1e-6 && bi.movable && prev_len > 0.0 && next_len > 0.0 && {
        let t = (half * cross / denom).abs();
        prev_len >= t && next_len >= t
    };
    if can_intersect {
        let k = half / denom;
        bi.line_to(p[0] + si * (n_in[0] + n_out[0]) * k, p[1] + si * (n_in[1] + n_out[1]) * k, false);
    } else {
        bi.movable = false;
        bi.line_to(p[0] + si * n_out[0] * half, p[1] + si * n_out[1] * half, false);
    }
    let smooth = !gap && dot >= f64::from(COS_SMOOTH) && !reversal;
    if smooth {
        if denom > 1e-6 {
            let k = half / denom;
            bo.line_to(p[0] + so * (n_in[0] + n_out[0]) * k, p[1] + so * (n_in[1] + n_out[1]) * k, false);
        }
        return;
    }
    match join {
        2 => {
            let start = [so * n_in[0], so * n_in[1]];
            let sweep = if reversal { -so * PI } else { cross.atan2(dot) };
            let a0 = start[1].atan2(start[0]);
            bo.arc_to(p, half, a0, sweep);
        }
        _ => {
            let within = join == 1 && mlimit > 0.0 && denom > 1e-6 && 0.5 * mlimit * mlimit * denom >= 1.0;
            if within {
                let k = half / denom;
                bo.line_to(p[0] + so * (n_in[0] + n_out[0]) * k, p[1] + so * (n_in[1] + n_out[1]) * k, false);
                if next_len <= 0.0 {
                    bo.line_to(p[0] + so * n_out[0] * half, p[1] + so * n_out[1] * half, false);
                }
            } else {
                bo.movable = false;
                bo.line_to(p[0] + so * n_out[0] * half, p[1] + so * n_out[1] * half, false);
            }
        }
    }
}

fn stroke_borders(
    s: &mut StrokeScratch,
    pts: &[[f64; 2]],
    closed: bool,
    half: f64,
    join: u8,
    mlimit: f64,
) -> (Vec<[f64; 2]>, Vec<[f64; 2]>) {
    let n = pts.len();
    let en = if closed { n } else { n - 1 };
    s.segs.clear();
    s.segs.reserve(en);
    for j in 0..en {
        let a = pts[j];
        let b = pts[(j + 1) % n];
        let dx = b[0] - a[0];
        let dy = b[1] - a[1];
        let len = (dx * dx + dy * dy).sqrt();
        if !(len > 0.015625) || !len.is_finite() {
            continue;
        }
        s.segs.push((j, [dx / len, dy / len], len));
    }
    if s.segs.is_empty() {
        return (Vec::new(), Vec::new());
    }
    let reserve = 2 * s.segs.len() + 8;
    let mut b0 = SBorder::new(s.point_buf());
    let mut b1 = SBorder::new(s.point_buf());
    b0.pts.reserve(reserve);
    b1.pts.reserve(reserve);
    let (j0, d0, _) = s.segs[0];
    let n0 = [-d0[1], d0[0]];
    let fp = pts[j0];
    b0.line_to(fp[0] + n0[0] * half, fp[1] + n0[1] * half, false);
    b1.line_to(fp[0] - n0[0] * half, fp[1] - n0[1] * half, false);
    if s.segs.len() == 1 {
        let e = pts[(j0 + 1) % n];
        b0.line_to(e[0] + n0[0] * half, e[1] + n0[1] * half, true);
        b1.line_to(e[0] - n0[0] * half, e[1] - n0[1] * half, true);
        let r0 = std::mem::take(&mut b0.pts);
        let r1 = std::mem::take(&mut b1.pts);
        return (r0, r1);
    }
    for k in 1..s.segs.len() {
        let (ja, da, la) = s.segs[k - 1];
        let (jb, db, lb) = s.segs[k];
        let gap = jb != ja + 1;
        process_corner(
            &mut b0,
            &mut b1,
            pts[jb],
            da,
            db,
            la,
            lb,
            gap,
            half,
            join,
            mlimit,
        );
        let q = pts[(jb + 1) % n];
        let nn = [-db[1], db[0]];
        b0.line_to(q[0] + nn[0] * half, q[1] + nn[1] * half, true);
        b1.line_to(q[0] - nn[0] * half, q[1] - nn[1] * half, true);
    }
    let (jl, dl, ll) = s.segs[s.segs.len() - 1];
    if closed {
        let (jf, df, lf) = s.segs[0];
        for b in [&mut b0, &mut b1] {
            if let Some(&last) = b.pts.last() {
                b.pts.push(last);
                b.movable = true;
            }
        }
        process_corner(
            &mut b0,
            &mut b1,
            pts[jf],
            dl,
            df,
            ll,
            lf,
            jf != jl + 1,
            half,
            join,
            mlimit,
        );
        for b in [&mut b0, &mut b1] {
            if b.pts.len() > 1 {
                let last = b.pts.last().copied().unwrap();
                b.pts[0] = last;
                b.pts.pop();
            }
        }
    } else {
        let e = pts[(jl + 1) % n];
        let nl = [-dl[1], dl[0]];
        b0.line_to(e[0] + nl[0] * half, e[1] + nl[1] * half, false);
        b1.line_to(e[0] - nl[0] * half, e[1] - nl[1] * half, false);
    }
    let r0 = std::mem::take(&mut b0.pts);
    let r1 = std::mem::take(&mut b1.pts);
    (r0, r1)
}

fn dedupe_chain(pts: &mut Vec<[f64; 2]>) {
    let n = pts.len();
    if n < 2 {
        return;
    }
    let mut q = unsafe { *pts.get_unchecked(0) };
    let mut w = 1usize;
    let mut i = 1usize;
    while i < n {
        let p = unsafe { *pts.get_unchecked(i) };
        let dx = if p[0] >= q[0] { p[0] - q[0] } else { q[0] - p[0] };
        let dy = if p[1] >= q[1] { p[1] - q[1] } else { q[1] - p[1] };
        if dx >= 0.03125 || dy >= 0.03125 {
            unsafe {
                *pts.get_unchecked_mut(w) = p;
            }
            q = p;
            w += 1;
        }
        i += 1;
    }
    if w < n {
        pts.truncate(w);
    }
}

fn offset_chain_pair(
    s: &mut StrokeScratch,
    pts: &[[f64; 2]],
    closed: bool,
    half: f64,
    join: u8,
    mlimit: f64,
) -> (Vec<[f64; 2]>, Vec<[f64; 2]>) {
    let (mut left, mut right) = stroke_borders(s, pts, closed, half, join, mlimit);
    dedupe_chain(&mut left);
    dedupe_chain(&mut right);
    (left, right)
}

fn unit_dir(a: [f64; 2], b: [f64; 2]) -> [f64; 2] {
    let d = dir_of(a, b);
    let len = (d[0] * d[0] + d[1] * d[1]).sqrt();
    if len <= 1e-9 {
        [1.0, 0.0]
    } else {
        [d[0] / len, d[1] / len]
    }
}

fn push_cap(
    pts_out: &mut Vec<[f64; 2]>,
    center: [f64; 2],
    lt: [f64; 2],
    rt: [f64; 2],
    d: [f64; 2],
    half: f64,
    cap: u8,
    sweep: i32,
) {
    let h = half as f32;
    match cap {
        3 => {
            let ex = [(d[0] as f32 * h) as f64, (d[1] as f32 * h) as f64];
            pts_out.push([center[0] + ex[0] + (lt[0] - center[0]), center[1] + ex[1] + (lt[1] - center[1])]);
            pts_out.push([center[0] + ex[0] + (rt[0] - center[0]), center[1] + ex[1] + (rt[1] - center[1])]);
        }
        2 => {
            let lx = (lt[0] - center[0]) as f32;
            let ly = (lt[1] - center[1]) as f32;
            let rx = (rt[0] - center[0]) as f32;
            let ry = (rt[1] - center[1]) as f32;
            let a0 = if sweep > 0 { ly.atan2(lx) } else { ry.atan2(rx) };
            let r = lx.hypot(ly);
            push_arc(pts_out, center, a0, -PI as f32, r);
        }
        _ => {}
    }
}

#[doc(hidden)]
pub fn stroke_outline_for_bench(pts: &[[f64; 2]], closed: bool, half: f64, join: u8, mlimit: f64) -> (Vec<[f64; 2]>, Vec<[f64; 2]>) {
    STROKE.with(|c| {
        let mut sc = core::mem::take(&mut *c.borrow_mut());
        let out = offset_chain_pair(&mut sc, pts, closed, half, join, mlimit);
        sc.recycle();
        *c.borrow_mut() = sc;
        out
    })
}

#[doc(hidden)]
pub fn stroke_recycle_pair(left: Vec<[f64; 2]>, right: Vec<[f64; 2]>) {
    STROKE.with(|c| {
        let mut sc = c.borrow_mut();
        sc.free.push(left);
        sc.free.push(right);
    });
}

pub fn stroke(
    dst: &mut PixBuf,
    cmds: &[Pc],
    width: f64,
    cap: u8,
    join: u8,
    miter_limit: f64,
    style: &PaintStyle,
    blend: Blend,
) {
    if width <= 0.0 || !width.is_finite() {
        return;
    }
    let _g = crate::prof::aprobe::enter(crate::prof::aprobe::ASTROKE);
    set_out_scale(dst.width);
    let half = width * 0.5;
    let ml = miter_limit;
    let extra = [
        width.to_bits(),
        miter_limit.to_bits(),
        u64::from(cap) | (u64::from(join) << 8),
    ];
    let t0k = prof::now();
    let key = cmds_key(2, false, dst.width as usize, dst.height as usize, cmds, &extra);
    prof::add(prof::KEYS, t0k);
    crate::cov_cache::seen_note(key);
    let t0r = prof::now();
    let mut cov = crate::cov_cache::take_cov_buf();
    let hit = crate::cov_cache::hit(key, &mut |e| replay_cov(dst, e, &mut cov, style, blend, 1.0));
    if hit {
        crate::cov_cache::stow_cov_buf(cov);
        prof::add(prof::REPC, t0r);
        prof::add(prof::SRAS, t0r);
        return;
    }
    if crate::cov_cache::skip_fresh() {
        crate::cov_cache::stow_cov_buf(cov);
        prof::add(prof::SRAS, t0r);
        return;
    }
    let t0g = prof::now();
    let cached = STROKE_CACHE.with(|slot| {
        let mut c = slot.borrow_mut();
        let mut hit = None;
        for i in (0..c.entries.len()).rev() {
            let e = &c.entries[i];
            if e.key == key {
                if let Some(out) = &e.out {
                    hit = Some((i, out.clone()));
                }
                break;
            }
        }
        if let Some((i, out)) = hit {
            let e = c.entries.remove(i);
            c.entries.push(e);
            return Some(out);
        }
        None
    });
    let outlines = match cached {
        Some(out) => {
            if PROBE_ON.with(|c| c.get()) {
                PROBE.with(|p| p.borrow_mut().push(format!("cached w={:.4} half={:.4}", width, half)));
            }
            out
        }
        None => {
            #[cfg(feature = "prof")]
            let t_flat = prof::now();
            let polys = flatten_shared(cmds);
            #[cfg(feature = "prof")]
            prof::add(prof::SSORT, t_flat);
            let mut sc = STROKE.with(|c| core::mem::take(&mut *c.borrow_mut()));
            sc.outlines.clear();
            for poly in polys.iter() {
                let n = poly.pts.len();
                if n < 2 {
                    continue;
                }
                let (left, right) = offset_chain_pair(&mut sc, &poly.pts, poly.closed, half, join, ml);
                if left.is_empty() || right.is_empty() {
                    sc.free.push(left);
                    sc.free.push(right);
                    continue;
                }
                let mut pts_b = left;
                if !poly.closed {
                    let ve = poly.pts[n - 1];
                    let d = unit_dir(poly.pts[n - 2], ve);
                    let lt = pts_b[pts_b.len() - 1];
                    push_cap(&mut pts_b, ve, lt, right[right.len() - 1], d, half, cap, 1);
                }
                for p in right.iter().rev() {
                    pts_b.push(*p);
                }
                if !poly.closed {
                    let d = unit_dir(poly.pts[0], poly.pts[1]).map(|c| -c);
                    let rt = right[0];
                    let lt = pts_b[0];
                    push_cap(&mut pts_b, poly.pts[0], lt, rt, d, half, cap, -1);
                }
                pts_b.push(pts_b[0]);
                sc.free.push(right);
                sc.outlines.push(Poly { pts: pts_b, closed: true });
            }
            let out = std::rc::Rc::new(core::mem::take(&mut sc.outlines));
            #[cfg(feature = "prof")]
            {
                let mut spts = 0u64;
                for poly in out.iter() {
                    spts += poly.pts.len() as u64;
                }
                let mut sinp = 0u64;
                for poly in polys.iter() {
                    sinp += poly.pts.len() as u64;
                }
                prof::count(prof::SPTS, spts);
                prof::count(prof::SINP, sinp);
            }
            STROKE_CACHE.with(|slot| {
                let mut c = slot.borrow_mut();
                if c.entries.len() >= STROKE_CACHE_CAP {
                    let old = c.entries.remove(0);
                    if let Some(o) = old.out {
                        if let Ok(mut polys) = std::rc::Rc::try_unwrap(o) {
                            for poly in polys.drain(..) {
                                sc.free.push(poly.pts);
                            }
                        }
                    }
                }
                c.entries.push(StrokeCacheEntry {
                    key,
                    out: Some(out.clone()),
                });
            });
            sc.recycle();
            STROKE.with(|c| *c.borrow_mut() = sc);
            out
        }
    };
    if PROBE_ON.with(|c| c.get()) {
        let mut line = format!("stroke w={:.4} half={:.4} join={} cap={} cmds={}", width, half, join, cap, cmds.len());
        for (i, p) in cmds.iter().enumerate() {
            if i < 200 {
                match p {
                    Pc::M(a) => line.push_str(&format!(" M{:.2},{:.2}", a[0], a[1])),
                    Pc::L(a) => line.push_str(&format!(" L{:.2},{:.2}", a[0], a[1])),
                    Pc::C(a) => line.push_str(&format!(" C{:.2},{:.2},{:.2},{:.2},{:.2},{:.2}", a[0], a[1], a[2], a[3], a[4], a[5])),
                    Pc::Z => line.push_str(" Z"),
                }
            }
        }
        let depth = CLIP_STACK.with(|s| s.borrow().len());
        let quads = CLIP_STACK.with(|s| {
            let st = s.borrow();
            st.iter().map(|q| format!("{:?}", q)).collect::<Vec<_>>().join(" ")
        });
        line.push_str(&format!(" clipdepth={} clip={}", depth, quads));
        PROBE.with(|pp| pp.borrow_mut().push(line));
        for poly in outlines.iter() {
            let mut line = format!("outline closed={} n={}", poly.closed, poly.pts.len());
            for p in poly.pts.iter() {
                line.push_str(&format!(" {:.2},{:.2}", p[0], p[1]));
            }
            PROBE.with(|pp| pp.borrow_mut().push(line));
        }
    }
    let outlines = clip_polys_rect(&clip_polys(&outlines), dst.width as f32, dst.height as f32);
    if outlines.is_empty() {
        crate::cov_cache::stow_cov_buf(cov);
        prof::add(prof::SPREP, t0g);
        prof::add(prof::SRAS, t0r);
        return;
    }
    prof::add(prof::SPREP, t0g);
    if crate::cov_cache::skip_raster() {
        crate::cov_cache::stow_cov_buf(cov);
        return;
    }
    raster_cells(dst, &outlines, false, style, blend, 1.0, &mut cov, key, true);
    crate::cov_cache::stow_cov_buf(cov);
    prof::add(prof::SRAS, t0r);
}

#[cfg(test)]
mod dense_paint_paths {
    use super::*;

    fn rnd(state: &mut u64) -> f32 {
        *state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((*state >> 33) as f32) / ((1u64 << 31) as f32)
    }

    fn poly_cmds(state: &mut u64, size: f32) -> Vec<Pc> {
        let cx = rnd(state) * size;
        let cy = rnd(state) * size;
        let r = (0.05 + rnd(state) * 0.6) * size;
        let n = 3 + (rnd(state) * 9.0) as usize;
        let mut cmds = Vec::new();
        for k in 0..=n {
            let ang = (k as f32) / (n as f32) * core::f32::consts::TAU;
            let rr = r * (0.5 + rnd(state));
            let p = [(cx + ang.cos() * rr) as f64, (cy + ang.sin() * rr) as f64];
            if k == 0 {
                cmds.push(Pc::M(p));
            } else {
                cmds.push(Pc::L(p));
            }
        }
        cmds.push(Pc::Z);
        cmds
    }

    fn render_once(cmds: &[Pc], w: u32, h: u32, col: RgbaF, eo: bool) -> PixBuf {
        let mut pix = PixBuf::new(w, h).unwrap();
        fill_pix(&mut pix, cmds, eo, &PaintStyle::Solid(col), Blend::SrcOver, 1.0);
        pix
    }

    
    
    
    
    #[test]
    fn fresh_paint_matches_capture_and_replay() {
        let mut state = 424242u64;
        let (w, h) = (64u32, 64u32);
        for case in 0..60 {
            let col = RgbaF {
                r: rnd(&mut state),
                g: rnd(&mut state),
                b: rnd(&mut state),
                a: if case % 3 == 0 { 1.0 } else { 0.3 + rnd(&mut state) * 0.7 },
            };
            let eo = case % 2 == 0;
            let cmds = poly_cmds(&mut state, 64.0);
            crate::cov_cache::cache_all_off(true);
            crate::cov_cache::probe_reset();
            let cold = render_once(&cmds, w, h, col, eo);
            let cold2 = render_once(&cmds, w, h, col, eo);
            crate::cov_cache::cache_all_off(false);
            crate::cov_cache::probe_reset();
            let fresh = render_once(&cmds, w, h, col, eo);
            assert_eq!(fresh.data(), cold.data(), "fresh vs cache-off case {}", case);
            crate::cov_cache::frame_tick(w as usize, h as usize);
            let cap = render_once(&cmds, w, h, col, eo);
            assert_eq!(cap.data(), cold.data(), "capture run-scan paint vs cold case {}", case);
            crate::cov_cache::frame_tick(w as usize, h as usize);
            let rep = render_once(&cmds, w, h, col, eo);
            assert_eq!(rep.data(), cold.data(), "replay paint vs cold case {}", case);
            assert_eq!(cold2.data(), cold.data(), "determinism case {}", case);
        }
    }
}

#[cfg(test)]
mod stroke_probe {
    use super::*;

    fn probe(cmds: &[Pc], width: f64, cap: u8) {
        let mut dst = PixBuf::new(200, 200).unwrap();
        let style = PaintStyle::Solid(RgbaF { r: 1.0, g: 1.0, b: 1.0, a: 1.0 });
        stroke(&mut dst, cmds, width, cap, 2, 4.0, &style, Blend::SrcOver);
        let mut lo = (i32::MAX, i32::MAX);
        let mut hi = (i32::MIN, i32::MIN);
        let mut cnt = 0usize;
        for y in 0..200usize {
            for x in 0..200usize {
                let i = (y * 200 + x) * 4;
                if dst.data[i + 3] > 0 {
                    cnt += 1;
                    lo = (lo.0.min(x as i32), lo.1.min(y as i32));
                    hi = (hi.0.max(x as i32), hi.1.max(y as i32));
                }
            }
        }
        println!("cap={} width={} bbox={:?}..{:?} px={}", cap, width, lo, hi, cnt);
    }

    #[test]
    fn caps_probe() {
        let cmds = [Pc::M([95.0, 100.0]), Pc::L([105.0, 100.0])];
        probe(&cmds, 54.0, 2);
        probe(&cmds, 54.0, 1);
        probe(&cmds, 10.0, 2);
        let cmds2 = [Pc::M([95.0, 100.0]), Pc::L([105.0, 100.0]), Pc::L([95.0, 130.0])];
        probe(&cmds2, 54.0, 2);
    }
}
