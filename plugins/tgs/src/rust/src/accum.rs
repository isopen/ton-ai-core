use std::cell::RefCell;

const ROW_EMPTY: (u32, u32) = (u32::MAX, 0);
const MAX_RETAINED_ACC_BYTES: usize = 4 << 20;

pub(crate) struct AccumRaster {
    w: usize,
    h: usize,
    acc: Vec<f32>,
    rows: Vec<(u32, u32)>,
    min_y: usize,
    max_y: usize,
    cov: Vec<u8>,
    ones: Vec<u8>,
    wcnt: Vec<u32>,
}

thread_local! {
    static ACC_RASTER: RefCell<AccumRaster> = RefCell::new(AccumRaster::new());
    static SPARSE_K: core::cell::Cell<u32> = const { core::cell::Cell::new(2) };
}

pub fn set_sparse_k(v: u32) {
    SPARSE_K.with(|c| c.set(v));
}

impl AccumRaster {
    const fn new() -> Self {
        AccumRaster {
            w: 0,
            h: 0,
            acc: Vec::new(),
            rows: Vec::new(),
            min_y: usize::MAX,
            max_y: 0,
            cov: Vec::new(),
            ones: Vec::new(),
            wcnt: Vec::new(),
        }
    }

    pub(crate) fn with(w: usize, h: usize, f: impl FnOnce(&mut AccumRaster)) {
        ACC_RASTER.with(|slot| {
            let retained = {
                let raster = slot.borrow();
                raster.acc.capacity().saturating_mul(4) + raster.cov.capacity()
            };
            {
                let mut raster = slot.borrow_mut();
                if retained > MAX_RETAINED_ACC_BYTES {
                    raster.drop_pool();
                }
                raster.ensure(w, h);
                f(&mut *raster);
            }
        });
    }

    fn drop_pool(&mut self) {
        self.acc = Vec::new();
        self.rows = Vec::new();
        self.cov = Vec::new();
        self.ones = Vec::new();
        self.wcnt = Vec::new();
        self.w = 0;
        self.h = 0;
        self.min_y = usize::MAX;
        self.max_y = 0;
    }

    fn ensure(&mut self, w: usize, h: usize) {
        let need = (w + 1).saturating_mul(h).saturating_add(1);
        if self.acc.len() < need {
            self.acc.resize(need, 0.0);
        }
        if self.rows.len() < h {
            self.rows.resize(h, ROW_EMPTY);
        }
        if self.cov.len() < w {
            self.cov.resize(w, 0);
        }
        if self.wcnt.len() < h {
            self.wcnt.resize(h, 0);
        }
        self.w = w;
        self.h = h;
        self.min_y = usize::MAX;
        self.max_y = 0;
    }

    #[inline(always)]
    fn draw_line(&mut self, x0f: f32, y0f: f32, x1f: f32, y1f: f32) {
        if !(x0f.is_finite() && y0f.is_finite() && x1f.is_finite() && y1f.is_finite()) {
            return;
        }
        if (y0f - y1f).abs() <= 1e-9 {
            return;
        }
        let (dir, p0x, p0y, p1x, p1y) = if y0f < y1f {
            (1.0f32, x0f, y0f, x1f, y1f)
        } else {
            (-1.0f32, x1f, y1f, x0f, y0f)
        };
        let dxdy = (p1x - p0x) / (p1y - p0y);
        let mut x = p0x;
        let y_start = p0y.max(0.0) as usize;
        let y_end = p1y.min(self.h as f32).ceil().max(0.0) as usize;
        if p0y < 0.0 {
            x -= p0y * dxdy;
        }
        self.min_y = self.min_y.min(y_start);
        self.max_y = self.max_y.max(y_end.min(self.h.saturating_sub(1)));
        let wmax = self.w as f32;
        let stride = self.w + 1;
        let last_x = self.w;
        for y in y_start..y_end.min(self.h) {
            let linestart = y * stride;
            let yf = y as f32;
            let dy = (yf + 1.0).min(p1y) - yf.max(p0y);
            if dy <= 0.0 {
                continue;
            }
            let xnext = x + dxdy * dy;
            let d = dy * dir;
            let (mut a, mut b) = if x < xnext { (x, xnext) } else { (xnext, x) };
            a = a.clamp(0.0, wmax);
            b = b.clamp(0.0, wmax);
            let x0floor = a.floor();
            let x0i = x0floor as usize;
            let x1ceil = b.ceil();
            let x1i = x1ceil as usize;
            if let Some(slot) = self.rows.get_mut(y) {
                slot.0 = slot.0.min(x0i as u32);
                slot.1 = slot.1.max(x1i as u32);
            }
            if let Some(cnt) = self.wcnt.get_mut(y) {
                *cnt = cnt.saturating_add(x1i.saturating_sub(x0i) as u32);
            }
            
            
            
            
            let Some(row) = self.acc.get_mut(linestart..linestart + stride + 1) else {
                x = xnext;
                continue;
            };
            macro_rules! cell {
                ($i:expr, $v:expr) => {
                    unsafe { *row.get_unchecked_mut($i) += $v };
                };
            }
            if x1i <= x0i + 1 {
                let xmf = (0.5 * (x + xnext) - x0floor).clamp(0.0, 1.0);
                cell!(x0i, d - d * xmf);
                if x0i + 1 <= last_x {
                    cell!(x0i + 1, d * xmf);
                }
            } else {
                let s = 1.0 / (b - a);
                let x0f = a - x0floor;
                let a0 = 0.5 * s * (1.0 - x0f) * (1.0 - x0f);
                let x1f = b - x1ceil + 1.0;
                let am = 0.5 * s * x1f * x1f;
                cell!(x0i, d * a0);
                if x1i == x0i + 2 {
                    cell!(x0i + 1, d * (1.0 - a0 - am));
                } else {
                    let a1 = s * (1.5 - x0f);
                    cell!(x0i + 1, d * (a1 - a0));
                    let ds = d * s;
                    if let Some(mid) = row.get_mut((x0i + 2)..x1i.saturating_sub(1)) {
                        for slot in mid {
                            *slot += ds;
                        }
                    }
                    let a2 = a1 + (x1i.saturating_sub(x0i).saturating_sub(3)) as f32 * s;
                    cell!(x1i - 1, d * (1.0 - a2 - am));
                }
                cell!(x1i, d * am);
            }
            x = xnext;
        }
    }

    pub(crate) fn fill_contours(&mut self, pts: &[[f64; 2]]) {
        let n = pts.len();
        if n < 2 {
            return;
        }
        let mut i = 0usize;
        while i + 1 < n {
            let p = pts[i];
            let q = pts[i + 1];
            self.draw_line(p[0] as f32, p[1] as f32, q[0] as f32, q[1] as f32);
            i += 1;
        }
        let last = pts[n - 1];
        let first = pts[0];
        self.draw_line(last[0] as f32, last[1] as f32, first[0] as f32, first[1] as f32);
    }

    pub(crate) fn sweep(&mut self, even_odd: bool, f: impl FnMut(usize, usize, &[u8])) {
        if even_odd {
            self.sweep_impl::<true>(f);
        } else {
            self.sweep_impl::<false>(f);
        }
    }

    fn sweep_impl<const EVEN_ODD: bool>(&mut self, mut f: impl FnMut(usize, usize, &[u8])) {
        if self.min_y > self.max_y {
            return;
        }
        let stride = self.w + 1;
        let sparse_k = SPARSE_K.with(|c| c.get());
        let mut cov = std::mem::take(&mut self.cov);
        let mut ones = std::mem::take(&mut self.ones);
        for y in self.min_y..=self.max_y.min(self.h.saturating_sub(1)) {
            let Some(&(rx0, rx1)) = self.rows.get(y) else {
                continue;
            };
            if rx0 == ROW_EMPTY.0 {
                continue;
            }
            let x0 = (rx0 as usize).min(self.w.saturating_sub(1));
            let x1 = (rx1 as usize + 1).min(self.w);
            if x1 <= x0 {
                continue;
            }
            let clear_x1 = (rx1 as usize + 2).min(stride);
            let lo = y * stride + x0;
            let hi = (y * stride + clear_x1).min(self.acc.len());
            let Some(acc_range) = self.acc.get_mut(lo..hi) else {
                continue;
            };
            let (row, spill) = acc_range.split_at_mut((x1 - x0).min(acc_range.len()));
            let row_len = row.len();
            let Some(cov_slice) = cov.get_mut(..row_len) else {
                for slot in acc_range.iter_mut() {
                    *slot = 0.0;
                }
                if let Some(slot) = self.rows.get_mut(y) {
                    *slot = ROW_EMPTY;
                }
                continue;
            };
            let written = self.wcnt.get(y).copied().unwrap_or(0) as usize;
            let sparse_row = sparse_k > 0 && written.saturating_mul(sparse_k as usize) < row_len;
            if let Some(slot) = self.wcnt.get_mut(y) {
                *slot = 0;
            }
            if !sparse_row {
                let mut sum = 0.0f32;
                for (dst, src) in cov_slice.iter_mut().zip(row.iter_mut()) {
                    let delta = *src;
                    *src = 0.0;
                    sum += delta;
                    *dst = coverage_of::<EVEN_ODD>(sum);
                }
                for slot in spill.iter_mut() {
                    *slot = 0.0;
                }
                f(y, x0, cov_slice.get(..row_len).unwrap_or(&[]));
                if let Some(slot) = self.rows.get_mut(y) {
                    *slot = ROW_EMPTY;
                }
                continue;
            }
            if ones.len() < row_len {
                ones.resize(row_len, 255);
            }
            let mut sum = 0.0f32;
            let mut i = 0usize;
            let mut run_start = 0usize;
            while i < row_len {
                if i + 4 <= row_len
                    && unsafe { core::ptr::read_unaligned(row.as_ptr().add(i) as *const u128) } == 0
                {
                    if i > run_start {
                        f(y, x0 + run_start, cov_slice.get(..i - run_start).unwrap_or(&[]));
                    }
                    let g0 = i;
                    while i + 4 <= row_len {
                        if unsafe { core::ptr::read_unaligned(row.as_ptr().add(i) as *const u128) } != 0 {
                            break;
                        }
                        i += 4;
                    }
                    while i < row_len && row[i] == 0.0 {
                        i += 1;
                    }
                    let glen = i - g0;
                    let c = coverage_of::<EVEN_ODD>(sum);
                    if c == 255 {
                        f(y, x0 + g0, ones.get(..glen).unwrap_or(&[]));
                    } else if c != 0 {
                        if let Some(dst) = cov_slice.get_mut(..glen) {
                            dst.fill(c);
                        }
                        f(y, x0 + g0, cov_slice.get(..glen).unwrap_or(&[]));
                    }
                    run_start = i;
                    continue;
                }
                let end = (i + 4).min(row_len);
                while i < end {
                    let delta = row[i];
                    row[i] = 0.0;
                    sum += delta;
                    cov_slice[i - run_start] = coverage_of::<EVEN_ODD>(sum);
                    i += 1;
                }
            }
            if i > run_start {
                f(y, x0 + run_start, cov_slice.get(..i - run_start).unwrap_or(&[]));
            }
            for slot in spill.iter_mut() {
                *slot = 0.0;
            }
            if let Some(slot) = self.rows.get_mut(y) {
                *slot = ROW_EMPTY;
            }
        }
        self.cov = cov;
        self.ones = ones;
        self.min_y = usize::MAX;
        self.max_y = 0;
    }
}

#[inline(always)]
fn coverage_of<const EVEN_ODD: bool>(sum: f32) -> u8 {
    let c = if EVEN_ODD {
        let m = sum.rem_euclid(2.0);
        if m > 1.0 {
            2.0 - m
        } else {
            m
        }
    } else {
        sum.abs().min(1.0)
    };
    (c * 255.0 + 0.5) as u8
}

pub(crate) fn with(w: usize, h: usize, f: impl FnOnce(&mut AccumRaster)) {
    AccumRaster::with(w, h, f);
}
