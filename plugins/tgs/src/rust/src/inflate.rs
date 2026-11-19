use crate::{TgsError, TgsResult};

pub const MAX_PAYLOAD: usize = 16 * 1024 * 1024;

const GZIP_MAGIC: [u8; 2] = [0x1f, 0x8b];
const DEFLATE_METHOD: u8 = 8;
const FHCRC: u8 = 2;
const FEXTRA: u8 = 4;
const FNAME: u8 = 8;
const FCOMMENT: u8 = 16;
const FRESERVED: u8 = 0xe0;
const MAX_BITS: u32 = 15;
const FAST_BITS: u32 = 9;
const FAST_SIZE: usize = 1 << FAST_BITS;

fn decompression_failed() -> TgsError {
    TgsError("TGS decompression failed".to_string())
}

pub fn inflate_tgs(data: &[u8]) -> TgsResult<String> {
    if data.len() > MAX_PAYLOAD {
        return Err(TgsError("TGS payload exceeds size limit".to_string()));
    }
    let bytes = if data.len() >= 2 && data[0] == GZIP_MAGIC[0] && data[1] == GZIP_MAGIC[1] {
        gunzip(data)?
    } else {
        data.to_vec()
    };
    if bytes.len() > MAX_PAYLOAD {
        return Err(TgsError("TGS payload exceeds size limit".to_string()));
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

const fn build_crc_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    let mut n = 0;
    while n < 256 {
        let mut c = n as u32;
        let mut k = 0;
        while k < 8 {
            c = if c & 1 != 0 { 0xedb8_8320 ^ (c >> 1) } else { c >> 1 };
            k += 1;
        }
        table[n] = c;
        n += 1;
    }
    table
}

const CRC_TABLE: [u32; 256] = build_crc_table();

pub fn crc32(data: &[u8]) -> u32 {
    let mut c = 0xffff_ffffu32;
    for &b in data {
        c = CRC_TABLE[((c ^ b as u32) & 0xff) as usize] ^ (c >> 8);
    }
    c ^ 0xffff_ffff
}

struct BitReader<'a> {
    data: &'a [u8],
    pos: usize,
    buf: u32,
    cnt: u32,
}

impl<'a> BitReader<'a> {
    fn new(data: &'a [u8]) -> BitReader<'a> {
        BitReader { data, pos: 0, buf: 0, cnt: 0 }
    }

    fn need(&mut self, n: u32) -> Result<(), ()> {
        while self.cnt < n {
            let b = match self.data.get(self.pos) {
                Some(b) => *b as u32,
                None => return Err(()),
            };
            self.pos += 1;
            self.buf |= b << self.cnt;
            self.cnt += 8;
        }
        Ok(())
    }

    fn bits(&mut self, n: u32) -> Result<u32, ()> {
        if n == 0 {
            return Ok(0);
        }
        self.need(n)?;
        let v = self.buf & ((1u32 << n) - 1);
        self.buf >>= n;
        self.cnt -= n;
        Ok(v)
    }

    fn bit(&mut self) -> Result<u32, ()> {
        if self.cnt == 0 {
            let b = match self.data.get(self.pos) {
                Some(b) => *b as u32,
                None => return Err(()),
            };
            self.pos += 1;
            self.buf = b;
            self.cnt = 8;
        }
        let v = self.buf & 1;
        self.buf >>= 1;
        self.cnt -= 1;
        Ok(v)
    }

    fn align(&mut self) {
        let drop = self.cnt & 7;
        self.buf >>= drop;
        self.cnt -= drop;
    }

    fn byte(&mut self) -> Result<u32, ()> {
        if self.cnt >= 8 {
            let v = self.buf & 0xff;
            self.buf >>= 8;
            self.cnt -= 8;
            return Ok(v);
        }
        let b = match self.data.get(self.pos) {
            Some(b) => *b as u32,
            None => return Err(()),
        };
        self.pos += 1;
        Ok(b)
    }

    fn bit_pos(&self) -> usize {
        self.pos * 8 - self.cnt as usize
    }
}

#[derive(Clone)]
struct Entry {
    len: u8,
    sym: u16,
}

struct Huffman {
    counts: [u16; MAX_BITS as usize + 1],
    symbols: Vec<u16>,
    fast: Vec<Entry>,
}

impl Huffman {
    fn build(lengths: &[u8]) -> Result<Huffman, ()> {
        let mut counts = [0u16; MAX_BITS as usize + 1];
        for &l in lengths {
            if l as u32 > MAX_BITS {
                return Err(());
            }
            counts[l as usize] += 1;
        }
        counts[0] = 0;
        let mut total = 0usize;
        for len in 1..=(MAX_BITS as usize) {
            total += (counts[len] as usize) << (MAX_BITS as usize - len);
        }
        if total > 1 << (MAX_BITS as usize) {
            return Err(());
        }
        let mut next_code = [0u32; MAX_BITS as usize + 1];
        let mut code = 0u32;
        for len in 1..=(MAX_BITS as usize) {
            code = (code + counts[len - 1] as u32) << 1;
            next_code[len] = code;
        }
        let mut symbols = Vec::with_capacity(lengths.len());
        let mut pairs: Vec<(usize, u16)> = lengths
            .iter()
            .enumerate()
            .filter(|(_, &l)| l != 0)
            .map(|(i, &l)| (l as usize, i as u16))
            .collect();
        pairs.sort_by(|a, b| (a.0, a.1).cmp(&(b.0, b.1)));
        let mut fast = vec![Entry { len: 0, sym: 0 }; FAST_SIZE];
        for &(len, sym) in &pairs {
            let c = next_code[len];
            next_code[len] += 1;
            symbols.push(sym);
            if len <= FAST_BITS as usize {
                let t = reverse_bits(c, len as u32) as usize;
                let mut i = t;
                while i < FAST_SIZE {
                    fast[i] = Entry { len: len as u8, sym };
                    i += 1 << len;
                }
            }
        }
        Ok(Huffman { counts, symbols, fast })
    }

    fn decode(&self, r: &mut BitReader) -> Result<u16, ()> {
        let _ = r.need(FAST_BITS);
        if r.cnt >= FAST_BITS {
            let val = (r.buf as usize) & (FAST_SIZE - 1);
            let e = &self.fast[val];
            if e.len != 0 {
                r.buf >>= e.len as u32;
                r.cnt -= e.len as u32;
                return Ok(e.sym);
            }
            let mut code = 0u32;
            let mut first = 0u32;
            let mut index = 0usize;
            for len in 1..=(MAX_BITS as usize) {
                code = (code << 1) | r.bit()?;
                let count = self.counts[len] as u32;
                if code >= first && code < first + count {
                    return Ok(self.symbols[index + (code - first) as usize]);
                }
                index += count as usize;
                first += count;
                first <<= 1;
            }
            return Err(());
        }
        let mut code = 0u32;
        let mut first = 0u32;
        let mut index = 0usize;
        for len in 1..=(MAX_BITS as usize) {
            code = (code << 1) | r.bit()?;
            let count = self.counts[len] as u32;
            if code >= first && code < first + count {
                return Ok(self.symbols[index + (code - first) as usize]);
            }
            index += count as usize;
            first += count;
            first <<= 1;
        }
        Err(())
    }
}

fn reverse_bits(v: u32, len: u32) -> u32 {
    let mut out = 0u32;
    for i in 0..len {
        out |= ((v >> (len - 1 - i)) & 1) << i;
    }
    out
}

const LEN_BASE: [u16; 29] = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
];
const LEN_EXTRA: [u8; 29] = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE: [u16; 30] = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
    8193, 12289, 16385, 24577,
];
const DIST_EXTRA: [u8; 30] = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
const CODE_LENGTH_ORDER: [u8; 19] = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

struct FixedTables {
    lit: Huffman,
    dist: Huffman,
}

fn fixed_tables() -> &'static FixedTables {
    static FIXED: std::sync::OnceLock<FixedTables> = std::sync::OnceLock::new();
    FIXED.get_or_init(|| {
        let mut lit_lens = [0u8; 288];
        for s in 0..144 {
            lit_lens[s] = 8;
        }
        for s in 144..256 {
            lit_lens[s] = 9;
        }
        for s in 256..280 {
            lit_lens[s] = 7;
        }
        for s in 280..288 {
            lit_lens[s] = 8;
        }
        let dist_lens = [5u8; 32];
        FixedTables { lit: Huffman::build(&lit_lens).unwrap(), dist: Huffman::build(&dist_lens).unwrap() }
    })
}

fn inflate_stored(r: &mut BitReader, out: &mut Vec<u8>) -> Result<(), ()> {
    r.align();
    let len0 = r.byte()?;
    let len1 = r.byte()?;
    let n0 = r.byte()?;
    let n1 = r.byte()?;
    let len = len0 | (len1 << 8);
    let nlen = n0 | (n1 << 8);
    if nlen != (!len & 0xffff) {
        return Err(());
    }
    if out.len() + len as usize > MAX_PAYLOAD {
        return Err(());
    }
    for _ in 0..len {
        out.push(r.byte()? as u8);
    }
    Ok(())
}

fn copy_match(out: &mut Vec<u8>, sym: u16, r: &mut BitReader, dist: &Huffman) -> Result<(), ()> {
    if sym > 285 {
        return Err(());
    }
    let li = (sym - 257) as usize;
    let len = LEN_BASE[li] as usize + r.bits(LEN_EXTRA[li] as u32)? as usize;
    let dsym = dist.decode(r)? as usize;
    if dsym > 29 {
        return Err(());
    }
    let distance = DIST_BASE[dsym] as usize + r.bits(DIST_EXTRA[dsym] as u32)? as usize;
    if distance == 0 || distance > out.len() {
        return Err(());
    }
    if out.len() + len > MAX_PAYLOAD {
        return Err(());
    }
    if distance >= len {
        let start = out.len() - distance;
        let tail: Vec<u8> = out[start..start + len].to_vec();
        out.extend_from_slice(&tail);
    } else {
        for _ in 0..len {
            let b = out[out.len() - distance];
            out.push(b);
        }
    }
    Ok(())
}

fn inflate_block(r: &mut BitReader, out: &mut Vec<u8>, lit: &Huffman, dist: &Huffman) -> Result<(), ()> {
    loop {
        let sym = lit.decode(r)?;
        if sym < 256 {
            if out.len() >= MAX_PAYLOAD {
                return Err(());
            }
            out.push(sym as u8);
            continue;
        }
        if sym == 256 {
            return Ok(());
        }
        if sym > 285 {
        }
        copy_match(out, sym, r, dist)?;
    }
}

fn inflate_dynamic_header(r: &mut BitReader) -> Result<(Huffman, Huffman), ()> {
    let hlit = r.bits(5)? as usize + 257;
    let hdist = r.bits(5)? as usize + 1;
    let hclen = r.bits(4)? as usize + 4;
    if hlit > 286 || hdist > 30 {
        return Err(());
    }
    let mut clen = [0u8; 19];
    for i in 0..hclen {
        clen[CODE_LENGTH_ORDER[i] as usize] = r.bits(3)? as u8;
    }
    let cl = Huffman::build(&clen)?;
    let mut lens = vec![0u8; hlit + hdist];
    let mut i = 0;
    while i < lens.len() {
        let sym = cl.decode(r)?;
        match sym {
            0..=15 => {
                lens[i] = sym as u8;
                i += 1;
            }
            16 => {
                if i == 0 {
                    return Err(());
                }
                let rep = 3 + r.bits(2)? as usize;
                if i + rep > lens.len() {
                    return Err(());
                }
                let prev = lens[i - 1];
                for _ in 0..rep {
                    lens[i] = prev;
                    i += 1;
                }
            }
            17 => {
                let rep = 3 + r.bits(3)? as usize;
                if i + rep > lens.len() {
                    return Err(());
                }
                i += rep;
            }
            18 => {
                let rep = 11 + r.bits(7)? as usize;
                if i + rep > lens.len() {
                    return Err(());
                }
                i += rep;
            }
            _ => return Err(()),
        }
    }
    let lit = Huffman::build(&lens[..hlit])?;
    let dist = Huffman::build(&lens[hlit..])?;
    Ok((lit, dist))
}

pub fn inflate_deflate(data: &[u8]) -> Result<(Vec<u8>, usize), ()> {
    let mut r = BitReader::new(data);
    let mut out: Vec<u8> = Vec::new();
    let fixed = fixed_tables();
    loop {
        let last = r.bits(1)?;
        let btype = r.bits(2)?;
        match btype {
            0 => inflate_stored(&mut r, &mut out)?,
            1 => inflate_block(&mut r, &mut out, &fixed.lit, &fixed.dist)?,
            2 => {
                let (lit, dist) = inflate_dynamic_header(&mut r)?;
                inflate_block(&mut r, &mut out, &lit, &dist)?;
            }
            _ => return Err(()),
        }
        if out.len() > MAX_PAYLOAD {
            return Err(());
        }
        if last == 1 {
            return Ok((out, r.bit_pos()));
        }
    }
}

fn le32(data: &[u8], at: usize) -> u32 {
    data[at] as u32 | ((data[at + 1] as u32) << 8) | ((data[at + 2] as u32) << 16) | ((data[at + 3] as u32) << 24)
}

fn skip_zero_terminated(data: &[u8], mut p: usize) -> Result<usize, ()> {
    while p < data.len() {
        if data[p] == 0 {
            return Ok(p + 1);
        }
        p += 1;
    }
    Err(())
}

fn gunzip(data: &[u8]) -> TgsResult<Vec<u8>> {
    if data.len() < 18 || data[0] != GZIP_MAGIC[0] || data[1] != GZIP_MAGIC[1] || data[2] != DEFLATE_METHOD {
        return Err(decompression_failed());
    }
    let flg = data[3];
    if flg & FRESERVED != 0 {
        return Err(decompression_failed());
    }
    let mut p = 10usize;
    if flg & FEXTRA != 0 {
        if data.len() < p + 2 {
            return Err(decompression_failed());
        }
        let xlen = data[p] as usize | ((data[p + 1] as usize) << 8);
        p += 2 + xlen;
    }
    if flg & FNAME != 0 {
        p = skip_zero_terminated(data, p).map_err(|_| decompression_failed())?;
    }
    if flg & FCOMMENT != 0 {
        p = skip_zero_terminated(data, p).map_err(|_| decompression_failed())?;
    }
    if flg & FHCRC != 0 {
        if p + 2 > data.len() {
            return Err(decompression_failed());
        }
        let want = data[p] as u32 | ((data[p + 1] as u32) << 8);
        let have = crc32(&data[..p]) & 0xffff;
        if want != have {
            return Err(decompression_failed());
        }
        p += 2;
    }
    if p >= data.len() {
        return Err(decompression_failed());
    }
    let (out, rel_end_bits) = inflate_deflate(&data[p..]).map_err(|_| decompression_failed())?;
    if out.len() > MAX_PAYLOAD {
        return Err(decompression_failed());
    }
    let end_bits = p * 8 + rel_end_bits;
    let at = (end_bits + 7) / 8;
    if at + 8 > data.len() {
        return Err(decompression_failed());
    }
    let crc = le32(data, at);
    if crc32(&out) != crc || le32(data, at + 4) != out.len() as u32 {
        return Err(decompression_failed());
    }
    Ok(out)
}
