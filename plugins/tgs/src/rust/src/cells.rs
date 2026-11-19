use crate::prof;
const PIX_B: i32 = 8;
const ONE: i32 = 1 << PIX_B;
pub(crate) const ONE_SCALE: f32 = ONE as f32;

const CELL_FULL: i32 = (ONE * ONE) * 2;
const SPARSE_ROWS: bool = true;

#[derive(Clone, Copy)]
struct Edge {
    y0: i32,
    y1: i32,
    x0: i32,
    x1: i32,
    dx: i32,
    dy: i32,
    dir: i32,
    sx: i32,
    start_row: usize,
    end_row: usize,
    q: i32,
    r: i32,
}

#[derive(Clone, Copy)]
struct Active {
    xa: i32,
    x1: i32,
    rem: i32,
    y1: i32,
    dy: i32,
    q: i32,
    r: i32,
    sx: i32,
    dir: i32,
    end_row: usize,
}

pub(crate) trait RowSink {
    fn row(&mut self, y: usize, x0: usize, row: &[u8]);
    fn span(&mut self, y: usize, x0: usize, len: usize, cv: u8);
}

pub(crate) struct DenseSink<F>(pub F);

impl<F: FnMut(usize, usize, &[u8])> RowSink for DenseSink<F> {
    #[inline(always)]
    fn row(&mut self, y: usize, x0: usize, row: &[u8]) {
        (self.0)(y, x0, row)
    }

    #[inline(always)]
    fn span(&mut self, _y: usize, _x0: usize, _len: usize, _cv: u8) {}
}

pub(crate) struct SpansSink<F>(pub F);

impl<F: FnMut(usize, usize, usize, u8)> RowSink for SpansSink<F> {
    #[inline(always)]
    fn row(&mut self, y: usize, x0: usize, row: &[u8]) {
        let mut i = 0usize;
        let n = row.len();
        while i < n {
            let cv = row[i];
            let s = i;
            i += 1;
            while i < n && row[i] == cv {
                i += 1;
            }
            if cv != 0 {
                (self.0)(y, x0 + s, i - s, cv);
            }
        }
    }

    #[inline(always)]
    fn span(&mut self, y: usize, x0: usize, len: usize, cv: u8) {
        if crate::cov_cache::skip_sink() {
            return;
        }
        (self.0)(y, x0, len, cv)
    }
}

pub(crate) struct CellRaster {
    w: usize,
    h: usize,
    edges: Vec<Edge>,
    active: Vec<Active>,
    row_off: Vec<u32>,
    cursor: Vec<u32>,
    order: Vec<u32>,
    cover: Vec<i32>,
    area: Vec<i32>,
    row: Vec<u8>,
    bits: Vec<u32>,
    dirty: bool,
}

impl CellRaster {
    pub(crate) fn new() -> Self {
        CellRaster {
            w: 0,
            h: 0,
            edges: Vec::new(),
            active: Vec::new(),
            row_off: Vec::new(),
            cursor: Vec::new(),
            order: Vec::new(),
            cover: Vec::new(),
            area: Vec::new(),
            row: Vec::new(),
            bits: Vec::new(),
            dirty: false,
        }
    }

    pub(crate) fn ensure(&mut self, w: usize, h: usize) {
        if self.dirty {
            for v in self.cover.iter_mut() {
                *v = 0;
            }
            for v in self.area.iter_mut() {
                *v = 0;
            }
            for v in self.bits.iter_mut() {
                *v = 0;
            }
            self.dirty = false;
        }
        let n = w + 2;
        if self.cover.len() < n {
            self.cover.resize(n, 0);
            self.area.resize(n, 0);
        }
        if self.row.len() < n {
            self.row.resize(n, 0);
        }
        let nb = (w >> 5) + 2;
        if self.bits.len() < nb {
            self.bits.resize(nb, 0);
        }
        self.w = w;
        self.h = h;
        self.edges.clear();
        self.active.clear();
    }

    #[inline(always)]
    fn coverage<const EVEN_ODD: bool>(area: i32) -> u8 {
        let v = if EVEN_ODD {
            let m = area & (2 * CELL_FULL - 1);
            if m > CELL_FULL {
                2 * CELL_FULL - m
            } else {
                m
            }
        } else {
            area.unsigned_abs().min(CELL_FULL as u32) as i32
        };
        ((v * 255 + CELL_FULL / 2) >> 17) as u8
    }

    #[inline]
    fn snap_coord_inner(v: f32, hi: f32) -> i32 {
        ((v * ONE as f32).clamp(0.0, hi)) as i32
    }

    #[inline]
    pub(crate) fn snap_coord(v: f32, hi: f32) -> i32 {
        Self::snap_coord_inner(v, hi)
    }

    pub(crate) fn draw_line_snapped(&mut self, mut x0: i32, mut y0: i32, mut x1: i32, mut y1: i32) {
        if y0 == y1 {
            return;
        }
        let dir = if y0 < y1 {
            1i32
        } else {
            core::mem::swap(&mut x0, &mut x1);
            core::mem::swap(&mut y0, &mut y1);
            -1i32
        };
        let dx = x1 - x0;
        let dy = y1 - y0;
        let b = ONE * dx.abs();
        let q = b / dy;
        let r = b - q * dy;
        let start_row = (y0 >> PIX_B) as usize;
        let end_row = ((y1 - 1) >> PIX_B) as usize;
        if start_row >= self.h || end_row >= self.h {
            return;
        }
        self.edges.push(Edge {
            y0,
            y1,
            x0,
            x1,
            dx,
            dy,
            dir,
            sx: if dx < 0 { -1 } else { 1 },
            start_row,
            end_row,
            q,
            r,
        });
    }

    
    
    
    pub(crate) fn sweep_rows<F: FnMut(usize, usize, &[u8])>(&mut self, even_odd: bool, f: F) {
        let mut sink = DenseSink(f);
        if even_odd {
            self.sweep_impl::<true, false, false, _>(&mut sink);
        } else {
            self.sweep_impl::<false, false, false, _>(&mut sink);
        }
    }

    
    
    
    pub(crate) fn sweep_rows_sink<S: RowSink>(&mut self, even_odd: bool, sink: &mut S) {
        if even_odd {
            self.sweep_impl::<true, false, false, _>(sink);
        } else {
            self.sweep_impl::<false, false, false, _>(sink);
        }
    }

    pub(crate) fn sweep_rows_bits<F: FnMut(usize, usize, &[u8])>(&mut self, even_odd: bool, f: F) {
        let mut sink = DenseSink(f);
        if even_odd {
            self.sweep_impl::<true, false, true, _>(&mut sink);
        } else {
            self.sweep_impl::<false, false, true, _>(&mut sink);
        }
    }

    pub(crate) fn sweep_rows_bits_sink<S: RowSink>(&mut self, even_odd: bool, sink: &mut S) {
        if even_odd {
            self.sweep_impl::<true, false, true, _>(sink);
        } else {
            self.sweep_impl::<false, false, true, _>(sink);
        }
    }

    
    
    
    pub(crate) fn sweep_spans<F: FnMut(usize, usize, usize, u8)>(&mut self, even_odd: bool, f: F) {
        let mut sink = SpansSink(f);
        if even_odd {
            self.sweep_impl::<true, true, true, _>(&mut sink);
        } else {
            self.sweep_impl::<false, true, true, _>(&mut sink);
        }
    }

    fn sweep_impl<const EVEN_ODD: bool, const SPANS: bool, const BITS: bool, S: RowSink>(
        &mut self,
        sink: &mut S,
    ) {
        let n = self.edges.len();
        if n == 0 || self.h == 0 || self.w == 0 {
            self.edges.clear();
            return;
        }
        let mut min_row = usize::MAX;
        let mut max_row = 0usize;
        for e in &self.edges {
            if e.start_row < min_row {
                min_row = e.start_row;
            }
            if e.end_row > max_row {
                max_row = e.end_row;
            }
        }
        let span = max_row - min_row + 1;
        let Self {
            w,
            h: _,
            edges,
            active,
            row_off,
            cursor,
            order,
            cover,
            area,
            row: rowbuf,
            bits: bits_slot,
            dirty,
        } = self;
        let w = *w;
        let mut bits = core::mem::take(bits_slot);
        if row_off.len() < span + 1 {
            row_off.resize(span + 1, 0);
        }
        for v in row_off[..span + 1].iter_mut() {
            *v = 0;
        }
        for e in edges.iter() {
            let r = e.start_row - min_row;
            row_off[r + 1] += 1;
        }
        for i in 1..=span {
            row_off[i] += row_off[i - 1];
        }
        if cursor.len() < span {
            cursor.resize(span, 0);
        }
        cursor[..span].copy_from_slice(&row_off[..span]);
        if order.len() < n {
            order.resize(n, 0);
        }
        for (i, e) in edges.iter().enumerate() {
            let r = e.start_row - min_row;
            let pos = cursor[r] as usize;
            order[pos] = i as u32;
            cursor[r] += 1;
        }
        active.clear();
        *dirty = true;
        for y in min_row..=max_row {
            let t_dep = prof::now();
            let rel = y - min_row;
            let s = row_off[rel] as usize;
            let e = row_off[rel + 1] as usize;
            let ybase = (y as i32) << PIX_B;
            let mut lo = usize::MAX;
            let mut hi = 0usize;
            let mut n_ended = 0usize;
            for a in active.iter_mut() {
                #[cfg(feature = "prof")]
                prof::count(prof::FS255, 1);
                let (xb, yb) = if y == a.end_row {
                    n_ended += 1;
                    (a.x1, a.y1 - ybase)
                } else {
                    let sum = a.rem + a.r;
                    let carry = if sum >= a.dy { 1 } else { 0 };
                    a.rem = sum - carry * a.dy;
                    (a.xa + a.sx * (a.q + carry), ONE)
                };
                deposit::<BITS>(cover, area, &mut lo, &mut hi, &mut bits, a.xa, 0, xb, yb, a.dir);
                a.xa = xb;
            }
            if n_ended != 0 {
                active.retain(|a| a.end_row > y);
            }
            for k in s..e {
                let ei = order[k];
                let ed = &edges[ei as usize];
                let ya = ed.y0 - ybase;
                if ed.start_row == ed.end_row {
                    deposit::<BITS>(
                        cover,
                        area,
                        &mut lo,
                        &mut hi,
                        &mut bits,
                        ed.x0,
                        ya,
                        ed.x1,
                        ed.y1 - ybase,
                        ed.dir,
                    );
                    continue;
                }
                let nb = (((ed.start_row + 1) << PIX_B) as i32) - ed.y0;
                let num = nb * ed.dx.abs();
                let den = ed.dy;
                let qt = num / den;
                let rem = num - qt * den;
                let q = if ed.dx < 0 {
                    -(qt + (rem != 0) as i32)
                } else {
                    qt
                };
                let xb = ed.x0.wrapping_add(q);
                deposit::<BITS>(cover, area, &mut lo, &mut hi, &mut bits, ed.x0, ya, xb, ONE, ed.dir);
                active.push(Active {
                    xa: xb,
                    x1: ed.x1,
                    rem,
                    y1: ed.y1,
                    dy: ed.dy,
                    q: ed.q,
                    r: ed.r,
                    sx: ed.sx,
                    dir: ed.dir,
                    end_row: ed.end_row,
                });
            }
            prof::add(prof::SWE1, t_dep);
            if lo > hi {
                continue;
            }
            let t_cov = prof::now();

            if crate::cov_cache::skip_walk() {
                let mut wi = lo >> 5;
                let wend = (hi >> 5).min(bits.len().saturating_sub(1));
                while wi <= wend {
                    let mut word = unsafe { *bits.get_unchecked(wi) };
                    unsafe {
                        *bits.get_unchecked_mut(wi) = 0;
                    }
                    while word != 0 {
                        let x = (wi << 5) | word.trailing_zeros() as usize;
                        word &= word - 1;
                        unsafe {
                            *cover.get_unchecked_mut(x) = 0;
                            *area.get_unchecked_mut(x) = 0;
                        }
                    }
                    wi += 1;
                }
                continue;
            }

            if !BITS {
                let hi = hi.min(w);
                let x_end = (hi + 1).min(w);
                let cnt = x_end.saturating_sub(lo);
                let csl = &mut cover[lo..=hi];
                let asl = &mut area[lo..=hi];
                prof::count(prof::RSRC, cnt as u64);
                prof::count(prof::PROW, 1);
                let (first, last) = dense_row::<EVEN_ODD>(csl, asl, &mut rowbuf[lo..x_end], cnt);
                if first != usize::MAX {
                    sink.row(y, lo + first, &rowbuf[lo + first..lo + last + 1]);
                }
                prof::add(prof::SWE2, t_cov);
                continue;
            }
            let x_end = (hi.min(w) + 1).min(w);
            prof::count(prof::RSRC, x_end.saturating_sub(lo) as u64);
            prof::count(prof::PROW, 1);
            let mut acc = 0i32;
            let mut prev = lo;
            if !SPANS {
                let mut first = usize::MAX;
                let mut last = 0usize;
                let mut wi = lo >> 5;
                let wend = (hi >> 5).min(bits.len().saturating_sub(1));
                while wi <= wend {
                    let mut word = unsafe { *bits.get_unchecked(wi) };
                    unsafe {
                        *bits.get_unchecked_mut(wi) = 0;
                    }
                    while word != 0 {
                        let x = (wi << 5) | word.trailing_zeros() as usize;
                        word &= word - 1;
                        let c = unsafe { *cover.get_unchecked(x) };
                        let a = unsafe { *area.get_unchecked(x) };
                        unsafe {
                            *cover.get_unchecked_mut(x) = 0;
                            *area.get_unchecked_mut(x) = 0;
                        }
                        if x >= x_end {
                            continue;
                        }
                        if x > prev {
                            let cv = Self::coverage::<EVEN_ODD>(acc);
                            rowbuf[prev..x].fill(cv);
                            if cv != 0 {
                                if first == usize::MAX {
                                    first = prev;
                                }
                                if x > last {
                                    last = x;
                                }
                            }
                        }
                        acc = acc.wrapping_add(c.wrapping_mul(ONE * 2));
                        let cv = Self::coverage::<EVEN_ODD>(acc.wrapping_sub(a));
                        rowbuf[x] = cv;
                        if cv != 0 {
                            if x < first {
                                first = x;
                            }
                            if x + 1 > last {
                                last = x + 1;
                            }
                        }
                        prev = x + 1;
                    }
                    wi += 1;
                }
                if prev < x_end {
                    let cv = Self::coverage::<EVEN_ODD>(acc);
                    rowbuf[prev..x_end].fill(cv);
                    if cv != 0 {
                        if first == usize::MAX {
                            first = prev;
                        }
                        if x_end > last {
                            last = x_end;
                        }
                    }
                }
                if first != usize::MAX {
                    sink.row(y, first, &rowbuf[first..last]);
                }
                prof::add(prof::SWE2, t_cov);
                continue;
            }
            macro_rules! emit_span {
                ($x0:expr, $len:expr, $cv:expr) => {{
                    let x0v: usize = $x0;
                    let lenv: usize = $len;
                    let cvv: u8 = $cv;
                    sink.span(y, x0v, lenv, cvv);
                }};
            }
            let mut cur_x = 0usize;
            let mut cur_len = 0usize;
            let mut cur_cv = 0u8;
            let mut wi = lo >> 5;
            let wend = (hi >> 5).min(bits.len().saturating_sub(1));
            while wi <= wend {
                let mut word = unsafe { *bits.get_unchecked(wi) };
                unsafe {
                    *bits.get_unchecked_mut(wi) = 0;
                }
                while word != 0 {
                    let x = (wi << 5) | word.trailing_zeros() as usize;
                    word &= word - 1;
                    let c = unsafe { *cover.get_unchecked(x) };
                    let a = unsafe { *area.get_unchecked(x) };
                    unsafe {
                        *cover.get_unchecked_mut(x) = 0;
                        *area.get_unchecked_mut(x) = 0;
                    }
                    if x >= x_end {
                        continue;
                    }
                    if x > prev {
                        let cv = Self::coverage::<EVEN_ODD>(acc);
                        if cv != 0 {
                            if cur_len != 0 && cv == cur_cv && cur_x + cur_len == prev {
                                cur_len += x - prev;
                            } else {
                                if cur_len != 0 {
                                    emit_span!(cur_x, cur_len, cur_cv);
                                }
                                cur_x = prev;
                                cur_len = x - prev;
                                cur_cv = cv;
                            }
                        }
                    }
                    acc = acc.wrapping_add(c.wrapping_mul(ONE * 2));
                    let cv = Self::coverage::<EVEN_ODD>(acc.wrapping_sub(a));
                    if cv != 0 {
                        if cur_len != 0 && cv == cur_cv && cur_x + cur_len == x {
                            cur_len += 1;
                        } else {
                            if cur_len != 0 {
                                emit_span!(cur_x, cur_len, cur_cv);
                            }
                            cur_x = x;
                            cur_len = 1;
                            cur_cv = cv;
                        }
                    } else if cur_len != 0 {
                        emit_span!(cur_x, cur_len, cur_cv);
                        cur_len = 0;
                    }
                    prev = x + 1;
                }
                wi += 1;
            }
            if prev < x_end {
                let cv = Self::coverage::<EVEN_ODD>(acc);
                if cv != 0 {
                    if cur_len != 0 && cv == cur_cv && cur_x + cur_len == prev {
                        cur_len += x_end - prev;
                    } else {
                        if cur_len != 0 {
                            emit_span!(cur_x, cur_len, cur_cv);
                        }
                        cur_x = prev;
                        cur_len = x_end - prev;
                        cur_cv = cv;
                    }
                }
            }
            if cur_len != 0 {
                emit_span!(cur_x, cur_len, cur_cv);
            }

            prof::add(prof::SWE2, t_cov);
        }
        active.clear();
        edges.clear();
        *dirty = false;
        *bits_slot = bits;
    }
}

#[inline(always)]
fn bump<const BITS: bool>(
    cover: &mut [i32],
    area: &mut [i32],
    lo: &mut usize,
    hi: &mut usize,
    bits: &mut [u32],
    x: i32,
    c: i32,
    a: i32,
) {
    if c == 0 && a == 0 {
        return;
    }
    #[cfg(feature = "prof")]
    prof::count(prof::RS255, 1);
    let xi = x as usize;
    unsafe {
        let cv = cover.get_unchecked_mut(xi);
        *cv = cv.wrapping_add(c);
        let ar = area.get_unchecked_mut(xi);
        *ar = ar.wrapping_add(a);
        if BITS {
            let bw = bits.get_unchecked_mut(xi >> 5);
            *bw |= 1u32 << (xi & 31);
        }
    }
    if xi < *lo {
        *lo = xi;
    }
    if xi > *hi {
        *hi = xi;
    }
}

#[inline(always)]
fn deposit<const BITS: bool>(
    cover: &mut [i32],
    area: &mut [i32],
    lo: &mut usize,
    hi: &mut usize,
    bits: &mut [u32],
    x1: i32,
    fy1: i32,
    x2: i32,
    fy2: i32,
    dir: i32,
) {
    let dy = fy2 - fy1;
    if dy == 0 {
        return;
    }
    #[cfg(feature = "prof")]
    prof::count(prof::RPX255, 1);
    let ex1 = x1 >> PIX_B;
    let ex2 = x2 >> PIX_B;
    if ex1 == ex2 {
        let fx1 = x1 - (ex1 << PIX_B);
        let fx2 = x2 - (ex1 << PIX_B);
        bump::<BITS>(
            cover,
            area,
            lo,
            hi,
            bits,
            ex1,
            dir * dy,
            dir * dy * (fx1 + fx2),
        );
        return;
    }
    let (lx, ly, rx, ry, dirw) = if x1 <= x2 {
        (x1, fy1, x2, fy2, dir)
    } else {
        (x2, fy2, x1, fy1, -dir)
    };
    let exl = lx >> PIX_B;
    let exr = rx >> PIX_B;
    let dx_t = rx - lx;
    let dy_t = ry - ly;
    let bx0 = (exl + 1) << PIX_B;
    let num0 = (bx0 - lx) * dy_t;
    let mut tq = num0 / dx_t;
    let mut tr = num0 - tq * dx_t;
    if tr < 0 {
        tq -= 1;
        tr += dx_t;
    }
    let mut ycur = ly + tq;
    let mut rem = tr;
    let stepnum = ONE * dy_t;
    let mut q = stepnum / dx_t;
    let mut r = stepnum - q * dx_t;
    if r < 0 {
        q -= 1;
        r += dx_t;
    }
    let fx_a = lx - (exl << PIX_B);
    let d0 = ycur - ly;
    bump::<BITS>(
        cover,
        area,
        lo,
        hi,
        bits,
        exl,
        dirw * d0,
        dirw * d0 * (fx_a + ONE),
    );
    let mut yprev = ycur;
    let mut ex = exl + 1;
    while ex < exr {
        ycur += q;
        rem += r;
        if rem >= dx_t {
            rem -= dx_t;
            ycur += 1;
        }
        let d = ycur - yprev;
        bump::<BITS>(cover, area, lo, hi, bits, ex, dirw * d, dirw * d * ONE);
        yprev = ycur;
        ex += 1;
    }
    let fx_b = rx - (exr << PIX_B);
    let dl = ry - yprev;
    bump::<BITS>(cover, area, lo, hi, bits, exr, dirw * dl, dirw * dl * fx_b);
}



#[cfg(target_arch = "wasm32")]
#[inline(always)]
fn dense_row_scalar<const EVEN_ODD: bool>(
    cover: &mut [i32],
    area: &mut [i32],
    out: &mut [u8],
    n: usize,
) -> (usize, usize) {
    let mut acc = 0i32;
    let mut first = usize::MAX;
    let mut last = 0usize;
    let mut i = 0usize;
    while i < n {
        let c = unsafe { *cover.get_unchecked(i) };
        let a = unsafe { *area.get_unchecked(i) };
        unsafe {
            *cover.get_unchecked_mut(i) = 0;
            *area.get_unchecked_mut(i) = 0;
            acc = acc.wrapping_add(c.wrapping_mul(ONE * 2));
            let cv = CellRaster::coverage::<EVEN_ODD>(acc.wrapping_sub(a));
            *out.get_unchecked_mut(i) = cv;
            if cv != 0 {
                if first == usize::MAX {
                    first = i;
                }
                last = i;
            }
        }
        i += 1;
    }
    (first, last)
}

#[cfg(target_arch = "wasm32")]
#[inline(always)]
fn dense_row<const EVEN_ODD: bool>(
    cover: &mut [i32],
    area: &mut [i32],
    out: &mut [u8],
    n: usize,
) -> (usize, usize) {
    if n >= 12 {
        unsafe { dense_simd::dense_row::<EVEN_ODD>(cover, area, out, n) }
    } else {
        dense_row_scalar::<EVEN_ODD>(cover, area, out, n)
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[inline(always)]
fn dense_row<const EVEN_ODD: bool>(
    cover: &mut [i32],
    area: &mut [i32],
    out: &mut [u8],
    n: usize,
) -> (usize, usize) {
    let mut acc = 0i32;
    let mut first = usize::MAX;
    let mut last = 0usize;
    let mut i = 0usize;
    while i < n {
        let c = unsafe { *cover.get_unchecked(i) };
        let a = unsafe { *area.get_unchecked(i) };
        unsafe {
            *cover.get_unchecked_mut(i) = 0;
            *area.get_unchecked_mut(i) = 0;
            acc = acc.wrapping_add(c.wrapping_mul(ONE * 2));
            let cv = CellRaster::coverage::<EVEN_ODD>(acc.wrapping_sub(a));
            *out.get_unchecked_mut(i) = cv;
            if cv != 0 {
                if first == usize::MAX {
                    first = i;
                }
                last = i;
            }
        }
        i += 1;
    }
    (first, last)
}

#[cfg(target_arch = "wasm32")]
mod dense_simd {
    use super::{CellRaster, CELL_FULL, ONE};
    use core::arch::wasm32 as wa;

    #[target_feature(enable = "simd128")]
    pub(crate) unsafe fn dense_row<const EVEN_ODD: bool>(
        cover: &mut [i32],
        area: &mut [i32],
        out: &mut [u8],
        n: usize,
    ) -> (usize, usize) {
        let cvp = cover.as_mut_ptr();
        let arp = area.as_mut_ptr();
        let op = out.as_mut_ptr();
        let zero = wa::i32x4_splat(0);
        let scale = wa::i32x4_splat(ONE * 2);
        let full = wa::i32x4_splat(CELL_FULL);
        let eomask = wa::i32x4_splat(2 * CELL_FULL - 1);
        let eofull = wa::i32x4_splat(2 * CELL_FULL);
        let round = wa::i32x4_splat(CELL_FULL / 2);
        let mut acc = 0i32;
        let mut first = usize::MAX;
        let mut last = 0usize;
        let nv = n & !3;
        let nv8 = n & !7;
        let nv16 = n & !15;
        let mut i = 0usize;
        
        
        macro_rules! cov4 {
            ($pv:expr, $av:expr) => {{
                let v = wa::i32x4_sub(wa::i32x4_mul($pv, scale), $av);
                let u = if EVEN_ODD {
                    let m = wa::v128_and(v, eomask);
                    let r = wa::i32x4_sub(eofull, m);
                    let gt = wa::i32x4_gt(m, full);
                    wa::v128_bitselect(r, m, gt)
                } else {
                    wa::u32x4_min(wa::i32x4_abs(v), full)
                };
                wa::u32x4_shr(
                    wa::i32x4_add(wa::i32x4_sub(wa::i32x4_shl(u, 8), u), round),
                    17,
                )
            }};
        }
        
        
        
        
        while i < nv16 {
            let c0 = wa::v128_load(cvp.add(i) as *const wa::v128);
            let c1 = wa::v128_load(cvp.add(i + 4) as *const wa::v128);
            let c2 = wa::v128_load(cvp.add(i + 8) as *const wa::v128);
            let c3 = wa::v128_load(cvp.add(i + 12) as *const wa::v128);
            let a0 = wa::v128_load(arp.add(i) as *const wa::v128);
            let a1 = wa::v128_load(arp.add(i + 4) as *const wa::v128);
            let a2 = wa::v128_load(arp.add(i + 8) as *const wa::v128);
            let a3 = wa::v128_load(arp.add(i + 12) as *const wa::v128);
            wa::v128_store(cvp.add(i) as *mut wa::v128, zero);
            wa::v128_store(cvp.add(i + 4) as *mut wa::v128, zero);
            wa::v128_store(cvp.add(i + 8) as *mut wa::v128, zero);
            wa::v128_store(cvp.add(i + 12) as *mut wa::v128, zero);
            wa::v128_store(arp.add(i) as *mut wa::v128, zero);
            wa::v128_store(arp.add(i + 4) as *mut wa::v128, zero);
            wa::v128_store(arp.add(i + 8) as *mut wa::v128, zero);
            wa::v128_store(arp.add(i + 12) as *mut wa::v128, zero);
            let mut p0 = c0;
            p0 = wa::i32x4_add(p0, wa::i32x4_shuffle::<4, 0, 1, 2>(p0, zero));
            p0 = wa::i32x4_add(p0, wa::i32x4_shuffle::<4, 4, 0, 1>(p0, zero));
            let mut p1 = c1;
            p1 = wa::i32x4_add(p1, wa::i32x4_shuffle::<4, 0, 1, 2>(p1, zero));
            p1 = wa::i32x4_add(p1, wa::i32x4_shuffle::<4, 4, 0, 1>(p1, zero));
            let mut p2 = c2;
            p2 = wa::i32x4_add(p2, wa::i32x4_shuffle::<4, 0, 1, 2>(p2, zero));
            p2 = wa::i32x4_add(p2, wa::i32x4_shuffle::<4, 4, 0, 1>(p2, zero));
            let mut p3 = c3;
            p3 = wa::i32x4_add(p3, wa::i32x4_shuffle::<4, 0, 1, 2>(p3, zero));
            p3 = wa::i32x4_add(p3, wa::i32x4_shuffle::<4, 4, 0, 1>(p3, zero));
            let s0 = wa::i32x4_extract_lane::<3>(p0);
            let s1 = wa::i32x4_extract_lane::<3>(p1);
            let s2 = wa::i32x4_extract_lane::<3>(p2);
            let s01 = s0.wrapping_add(s1);
            let s012 = s01.wrapping_add(s2);
            p1 = wa::i32x4_add(p1, wa::i32x4_splat(s0));
            p2 = wa::i32x4_add(p2, wa::i32x4_splat(s01));
            p3 = wa::i32x4_add(p3, wa::i32x4_splat(s012));
            let av = wa::i32x4_splat(acc);
            p0 = wa::i32x4_add(p0, av);
            p1 = wa::i32x4_add(p1, av);
            p2 = wa::i32x4_add(p2, av);
            p3 = wa::i32x4_add(p3, av);
            acc = wa::i32x4_extract_lane::<3>(p3);
            let t0 = cov4!(p0, a0);
            let t1 = cov4!(p1, a1);
            let t2 = cov4!(p2, a2);
            let t3 = cov4!(p3, a3);
            let w16a = wa::u16x8_narrow_i32x4(t0, t1);
            let w16b = wa::u16x8_narrow_i32x4(t2, t3);
            let w8 = wa::u8x16_narrow_i16x8(w16a, w16b);
            wa::v128_store(op.add(i) as *mut wa::v128, w8);
            let m = wa::u8x16_bitmask(wa::u8x16_ne(w8, zero)) as u32;
            if m != 0 {
                if first == usize::MAX {
                    first = i + m.trailing_zeros() as usize;
                }
                last = i + (31 - m.leading_zeros()) as usize;
            }
            i += 16;
        }
        
        
        
        while i < nv8 {
            let c0 = wa::v128_load(cvp.add(i) as *const wa::v128);
            let c1 = wa::v128_load(cvp.add(i + 4) as *const wa::v128);
            let a0 = wa::v128_load(arp.add(i) as *const wa::v128);
            let a1 = wa::v128_load(arp.add(i + 4) as *const wa::v128);
            wa::v128_store(cvp.add(i) as *mut wa::v128, zero);
            wa::v128_store(cvp.add(i + 4) as *mut wa::v128, zero);
            wa::v128_store(arp.add(i) as *mut wa::v128, zero);
            wa::v128_store(arp.add(i + 4) as *mut wa::v128, zero);
            let mut p0 = c0;
            p0 = wa::i32x4_add(p0, wa::i32x4_shuffle::<4, 0, 1, 2>(p0, zero));
            p0 = wa::i32x4_add(p0, wa::i32x4_shuffle::<4, 4, 0, 1>(p0, zero));
            let mut p1 = c1;
            p1 = wa::i32x4_add(p1, wa::i32x4_shuffle::<4, 0, 1, 2>(p1, zero));
            p1 = wa::i32x4_add(p1, wa::i32x4_shuffle::<4, 4, 0, 1>(p1, zero));
            p1 = wa::i32x4_add(p1, wa::i32x4_splat(wa::i32x4_extract_lane::<3>(p0)));
            p0 = wa::i32x4_add(p0, wa::i32x4_splat(acc));
            p1 = wa::i32x4_add(p1, wa::i32x4_splat(acc));
            acc = wa::i32x4_extract_lane::<3>(p1);
            let v0 = wa::i32x4_sub(wa::i32x4_mul(p0, scale), a0);
            let v1 = wa::i32x4_sub(wa::i32x4_mul(p1, scale), a1);
            let u0 = if EVEN_ODD {
                let m = wa::v128_and(v0, eomask);
                let r = wa::i32x4_sub(eofull, m);
                let gt = wa::i32x4_gt(m, full);
                wa::v128_bitselect(r, m, gt)
            } else {
                wa::u32x4_min(wa::i32x4_abs(v0), full)
            };
            let u1 = if EVEN_ODD {
                let m = wa::v128_and(v1, eomask);
                let r = wa::i32x4_sub(eofull, m);
                let gt = wa::i32x4_gt(m, full);
                wa::v128_bitselect(r, m, gt)
            } else {
                wa::u32x4_min(wa::i32x4_abs(v1), full)
            };
            let t0 = wa::u32x4_shr(
                wa::i32x4_add(wa::i32x4_sub(wa::i32x4_shl(u0, 8), u0), round),
                17,
            );
            let t1 = wa::u32x4_shr(
                wa::i32x4_add(wa::i32x4_sub(wa::i32x4_shl(u1, 8), u1), round),
                17,
            );
            let w16 = wa::u16x8_narrow_i32x4(t0, t1);
            let w8 = wa::u8x16_narrow_i16x8(w16, w16);
            let q = wa::i64x2_extract_lane::<0>(w8) as u64;
            core::ptr::write_unaligned(op.add(i) as *mut u64, q);
            
            
            let m = (wa::u8x16_bitmask(wa::u8x16_ne(w8, zero)) & 0xFF) as u32;
            if m != 0 {
                if first == usize::MAX {
                    first = i + m.trailing_zeros() as usize;
                }
                last = i + (31 - m.leading_zeros()) as usize;
            }
            i += 8;
        }
        while i < nv {
            let c = wa::v128_load(cvp.add(i) as *const wa::v128);
            let a = wa::v128_load(arp.add(i) as *const wa::v128);
            wa::v128_store(cvp.add(i) as *mut wa::v128, zero);
            wa::v128_store(arp.add(i) as *mut wa::v128, zero);
            let mut p = c;
            p = wa::i32x4_add(p, wa::i32x4_shuffle::<4, 0, 1, 2>(p, zero));
            p = wa::i32x4_add(p, wa::i32x4_shuffle::<4, 4, 0, 1>(p, zero));
            p = wa::i32x4_add(p, wa::i32x4_splat(acc));
            acc = wa::i32x4_extract_lane::<3>(p);
            let v = wa::i32x4_sub(wa::i32x4_mul(p, scale), a);
            let u = if EVEN_ODD {
                let m = wa::v128_and(v, eomask);
                let r = wa::i32x4_sub(eofull, m);
                let gt = wa::i32x4_gt(m, full);
                wa::v128_bitselect(r, m, gt)
            } else {
                wa::u32x4_min(wa::i32x4_abs(v), full)
            };
            let t = wa::u32x4_shr(
                wa::i32x4_add(wa::i32x4_sub(wa::i32x4_shl(u, 8), u), round),
                17,
            );
            let w16 = wa::u16x8_narrow_i32x4(t, t);
            let w8 = wa::u8x16_narrow_i16x8(w16, w16);
            let q = wa::i32x4_extract_lane::<0>(w8) as u32;
            core::ptr::write_unaligned(op.add(i) as *mut u32, q);
            
            
            let m = (wa::u8x16_bitmask(wa::u8x16_ne(w8, zero)) & 0xF) as u32;
            if m != 0 {
                if first == usize::MAX {
                    first = i + m.trailing_zeros() as usize;
                }
                last = i + (31 - m.leading_zeros()) as usize;
            }
            i += 4;
        }
        while i < n {
            let c = *cvp.add(i);
            let a = *arp.add(i);
            *cvp.add(i) = 0;
            *arp.add(i) = 0;
            acc = acc.wrapping_add(c);
            let d = acc.wrapping_mul(ONE * 2).wrapping_sub(a);
            let cv = CellRaster::coverage::<EVEN_ODD>(d);
            *op.add(i) = cv;
            if cv != 0 {
                if first == usize::MAX {
                    first = i;
                }
                last = i;
            }
            i += 1;
        }
        (first, last)
    }
}

#[cfg(test)]
mod span_tests {
    use super::*;

    fn deposit(cells: &mut CellRaster, polys: &[Vec<(f32, f32)>], w: usize, h: usize) {
        let wf = (w as f32) * ONE_SCALE;
        let hf = (h as f32) * ONE_SCALE;
        for poly in polys {
            let mut prev: Option<(i32, i32)> = None;
            let mut first: Option<(i32, i32)> = None;
            for (idx, p) in poly.iter().enumerate() {
                let sp = Some((
                    CellRaster::snap_coord(p.0, wf),
                    CellRaster::snap_coord(p.1, hf),
                ));
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
    }

    fn check(polys: &[Vec<(f32, f32)>], w: usize, h: usize, even_odd: bool) -> bool {
        let mut dense = vec![vec![0u8; w]; h];
        let mut a = CellRaster::new();
        a.ensure(w, h);
        deposit(&mut a, polys, w, h);
        a.sweep_rows(even_odd, |y, x0, row| {
            dense[y][x0..x0 + row.len()].copy_from_slice(row);
        });
        let mut sparse = vec![vec![0u8; w]; h];
        let mut b = CellRaster::new();
        b.ensure(w, h);
        deposit(&mut b, polys, w, h);
        b.sweep_spans(even_odd, |y, x0, len, cv| {
            for i in 0..len {
                sparse[y][x0 + i] = cv;
            }
        });
        dense == sparse
    }

    fn rnd(state: &mut u64) -> f32 {
        *state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((*state >> 33) as f32) / ((1u64 << 31) as f32)
    }

    fn rows_of(a: &mut CellRaster, polys: &[Vec<(f32, f32)>], w: usize, h: usize, even_odd: bool, bits: bool) -> Vec<Vec<u8>> {
        let mut dense = vec![vec![0u8; w]; h];
        a.ensure(w, h);
        deposit(a, polys, w, h);
        if bits {
            a.sweep_rows_bits(even_odd, |y, x0, row| {
                dense[y][x0..x0 + row.len()].copy_from_slice(row);
            });
        } else {
            a.sweep_rows(even_odd, |y, x0, row| {
                dense[y][x0..x0 + row.len()].copy_from_slice(row);
            });
        }
        dense
    }

    #[test]
    fn bits_matches_dense() {
        let mut state = 777u64;
        for size in [8usize, 16, 64, 160, 200, 320] {
            for _case in 0..20 {
                let mut polys = Vec::new();
                for _ in 0..5 {
                    let cx = rnd(&mut state) * size as f32;
                    let cy = rnd(&mut state) * size as f32;
                    let r = (0.05 + rnd(&mut state) * 0.6) * size as f32;
                    let n = 3 + (rnd(&mut state) * 8.0) as usize;
                    let mut poly = Vec::new();
                    for k in 0..n {
                        let ang = (k as f32) / (n as f32) * core::f32::consts::TAU;
                        let rr = r * (0.5 + rnd(&mut state));
                        poly.push((cx + ang.cos() * rr, cy + ang.sin() * rr));
                    }
                    polys.push(poly);
                }
                for eo in [false, true] {
                    let d = rows_of(&mut CellRaster::new(), &polys, size, size, eo, false);
                    let b = rows_of(&mut CellRaster::new(), &polys, size, size, eo, true);
                    assert_eq!(d, b, "size={} eo={}", size, eo);
                }
            }
        }
    }

    #[test]
    fn bits_gap_fill_matches_dense() {
        
        
        
        let mut state = 1u64;
        for case in 0..=30u64 {
            let size = [64usize, 160, 200, 320, 400][(case % 5) as usize];
            let mut polys = Vec::new();
            for _ in 0..6 {
                let cx = rnd(&mut state) * size as f32;
                let cy = rnd(&mut state) * size as f32;
                let r = (0.02 + rnd(&mut state) * 0.9) * size as f32;
                let n = 3 + (rnd(&mut state) * 10.0) as usize;
                let mut poly = Vec::new();
                for k in 0..n {
                    let ang = (k as f32) / (n as f32) * core::f32::consts::TAU;
                    let rr = r * (0.2 + rnd(&mut state) * 1.6);
                    poly.push((cx + ang.cos() * rr, cy + ang.sin() * rr));
                }
                polys.push(poly);
            }
            for eo in [false, true] {
                let d = rows_of(&mut CellRaster::new(), &polys, size, size, eo, false);
                let b = rows_of(&mut CellRaster::new(), &polys, size, size, eo, true);
                assert_eq!(d, b, "case={} size={} eo={}", case, size, eo);
            }
        }
    }

    #[test]
    fn sparse_matches_dense() {
        let mut state = 12345u64;
        for size in [8usize, 16, 64, 160, 320] {
            for _case in 0..20 {
                let mut polys = Vec::new();
                for _ in 0..5 {
                    let cx = rnd(&mut state) * size as f32;
                    let cy = rnd(&mut state) * size as f32;
                    let r = (0.05 + rnd(&mut state) * 0.6) * size as f32;
                    let n = 3 + (rnd(&mut state) * 8.0) as usize;
                    let mut poly = Vec::new();
                    for k in 0..n {
                        let ang = (k as f32) / (n as f32) * core::f32::consts::TAU;
                        let rr = r * (0.5 + rnd(&mut state));
                        poly.push((cx + ang.cos() * rr, cy + ang.sin() * rr));
                    }
                    polys.push(poly);
                }
                for eo in [false, true] {
                    assert!(check(&polys, size, size, eo), "size={} eo={}", size, eo);
                }
            }
        }
    }

    fn ref_row<const EVEN_ODD: bool>(cover: &[i32], area: &[i32], n: usize) -> Vec<u8> {
        let mut acc = 0i32;
        let mut out = vec![0u8; n];
        for i in 0..n {
            acc = acc.wrapping_add(cover[i].wrapping_mul(ONE * 2));
            out[i] = CellRaster::coverage::<EVEN_ODD>(acc.wrapping_sub(area[i]));
        }
        out
    }

    #[test]
    fn dense_row_matches_reference() {
        let mut state = 987654321u64;
        for n in [1usize, 3, 7, 12, 16, 31, 64, 100] {
            for _case in 0..200 {
                let mut cover = vec![0i32; n];
                let mut area = vec![0i32; n];
                let zeros = (rnd(&mut state) * n as f32 * 1.5) as usize;
                for _ in 0..zeros {
                    cover[(rnd(&mut state) * n as f32) as usize % n] =
                        (rnd(&mut state) * 4.0 * ONE as f32) as i32 - 2 * ONE;
                    area[(rnd(&mut state) * n as f32) as usize % n] =
                        (rnd(&mut state) * 3.0 * ONE as f32) as i32;
                }
                for eo in [false, true] {
                    let mut c = cover.clone();
                    let mut a = area.clone();
                    let mut out = vec![0u8; n];
                    let (f, l) = if eo {
                        dense_row::<true>(&mut c, &mut a, &mut out, n)
                    } else {
                        dense_row::<false>(&mut c, &mut a, &mut out, n)
                    };
                    let want = if eo {
                        ref_row::<true>(&cover, &area, n)
                    } else {
                        ref_row::<false>(&cover, &area, n)
                    };
                    assert_eq!(out, want, "pixels n={} eo={}", n, eo);
                    let nz: Vec<usize> = (0..n).filter(|&i| want[i] != 0).collect();
                    if nz.is_empty() {
                        assert!(f > l, "empty row n={} eo={}", n, eo);
                    } else {
                        assert_eq!(f, nz[0], "first n={} eo={}", n, eo);
                        assert_eq!(l, nz[nz.len() - 1], "last n={} eo={}", n, eo);
                    }
                    assert!(c.iter().all(|&v| v == 0), "cover cleared n={}", n);
                    assert!(a.iter().all(|&v| v == 0), "area cleared n={}", n);
                }
            }
        }
    }
}

#[cfg(all(feature = "prof", target_arch = "wasm32"))]
#[no_mangle]
pub unsafe extern "C" fn tgs_dbg_dense_row(
    cov: *mut i32,
    area: *mut i32,
    out: *mut u8,
    n: usize,
    even_odd: i32,
) -> i64 {
    let cover = core::slice::from_raw_parts_mut(cov, n);
    let ar = core::slice::from_raw_parts_mut(area, n);
    let o = core::slice::from_raw_parts_mut(out, n);
    let (f, l) = if even_odd != 0 {
        dense_simd::dense_row::<true>(cover, ar, o, n)
    } else {
        dense_simd::dense_row::<false>(cover, ar, o, n)
    };
    ((l as i64) << 32) | (f as i64)
}

#[cfg(all(feature = "prof", target_arch = "wasm32"))]
#[no_mangle]
pub unsafe extern "C" fn tgs_dbg_dense_scalar(
    cov: *mut i32,
    area: *mut i32,
    out: *mut u8,
    n: usize,
    even_odd: i32,
) -> i64 {
    let cover = core::slice::from_raw_parts_mut(cov, n);
    let ar = core::slice::from_raw_parts_mut(area, n);
    let o = core::slice::from_raw_parts_mut(out, n);
    let (f, l) = if even_odd != 0 {
        dense_row_scalar::<true>(cover, ar, o, n)
    } else {
        dense_row_scalar::<false>(cover, ar, o, n)
    };
    ((l as i64) << 32) | (f as i64)
}
