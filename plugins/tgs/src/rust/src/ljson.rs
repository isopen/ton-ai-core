use serde_json::{Map, Number, Value as JsonValue};

#[derive(Debug)]
pub struct LexError;

const MAX_DEPTH: usize = 128;
const MAX_NODES: usize = 500_000;

const POW10: [f64; 23] = [
    1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19,
    1e20, 1e21, 1e22,
];

struct Lexer<'a> {
    s: &'a str,
    b: &'a [u8],
    i: usize,
    nodes: usize,
}

fn is_ws(c: u8) -> bool {
    c == b' ' || c == b'\t' || c == b'\n' || c == b'\r'
}

pub fn parse(json: &str) -> Result<JsonValue, LexError> {
    let mut lexer = Lexer { s: json, b: json.as_bytes(), i: 0, nodes: 0 };
    let v = lexer.value(0)?;
    lexer.skip_ws();
    if lexer.i != lexer.b.len() {
        return Err(LexError);
    }
    Ok(v)
}

impl<'a> Lexer<'a> {
    fn skip_ws(&mut self) {
        while self.i < self.b.len() && is_ws(self.b[self.i]) {
            self.i += 1;
        }
    }

    fn value(&mut self, depth: usize) -> Result<JsonValue, LexError> {
        self.skip_ws();
        match self.b.get(self.i) {
            Some(b'{') => self.object(depth),
            Some(b'[') => self.array(depth),
            Some(b'"') => {
                self.i += 1;
                Ok(JsonValue::String(self.string()?))
            }
            Some(b't') => self.lit(b"true", JsonValue::Bool(true)),
            Some(b'f') => self.lit(b"false", JsonValue::Bool(false)),
            Some(b'n') => self.lit(b"null", JsonValue::Null),
            Some(c) if *c == b'-' || c.is_ascii_digit() => self.json_number(),
            _ => Err(LexError),
        }
    }

    fn lit(&mut self, word: &[u8], v: JsonValue) -> Result<JsonValue, LexError> {
        if self.b.len().saturating_sub(self.i) >= word.len() && &self.b[self.i..self.i + word.len()] == word {
            self.i += word.len();
            Ok(v)
        } else {
            Err(LexError)
        }
    }

    fn object(&mut self, depth: usize) -> Result<JsonValue, LexError> {
        self.enter(depth)?;
        self.i += 1;
        let mut map = Map::new();
        self.skip_ws();
        if self.b.get(self.i) == Some(&b'}') {
            self.i += 1;
            return Ok(JsonValue::Object(map));
        }
        loop {
            self.skip_ws();
            if self.b.get(self.i) != Some(&b'"') {
                return Err(LexError);
            }
            self.i += 1;
            let key = self.string()?;
            self.skip_ws();
            if self.b.get(self.i) != Some(&b':') {
                return Err(LexError);
            }
            self.i += 1;
            let val = self.value(depth + 1)?;
            map.insert(key, val);
            self.skip_ws();
            match self.b.get(self.i) {
                Some(b',') => self.i += 1,
                Some(b'}') => {
                    self.i += 1;
                    return Ok(JsonValue::Object(map));
                }
                _ => return Err(LexError),
            }
        }
    }

    fn array(&mut self, depth: usize) -> Result<JsonValue, LexError> {
        self.enter(depth)?;
        self.i += 1;
        let mut arr = Vec::new();
        self.skip_ws();
        if self.b.get(self.i) == Some(&b']') {
            self.i += 1;
            return Ok(JsonValue::Array(arr));
        }
        loop {
            arr.push(self.value(depth + 1)?);
            self.skip_ws();
            match self.b.get(self.i) {
                Some(b',') => self.i += 1,
                Some(b']') => {
                    self.i += 1;
                    return Ok(JsonValue::Array(arr));
                }
                _ => return Err(LexError),
            }
        }
    }

    fn enter(&mut self, depth: usize) -> Result<(), LexError> {
        if depth >= MAX_DEPTH {
            return Err(LexError);
        }
        self.nodes += 1;
        if self.nodes > MAX_NODES {
            return Err(LexError);
        }
        Ok(())
    }

    fn string(&mut self) -> Result<String, LexError> {
        let start = self.i;
        let len = self.b.len();
        let mut j = self.i;
        let mut escaped = false;
        while j < len {
            let c = self.b[j];
            if c == b'"' {
                break;
            }
            if c == b'\\' {
                escaped = true;
                j += 2;
                continue;
            }
            if c < 0x20 {
                return Err(LexError);
            }
            j += 1;
        }
        if j >= len {
            return Err(LexError);
        }
        self.i = j + 1;
        if !escaped {
            return Ok(self.s[start..j].to_string());
        }
        let mut out = String::with_capacity(j - start);
        let mut k = start;
        while k < j {
            if self.b[k] != b'\\' {
                let run_start = k;
                while k < j && self.b[k] != b'\\' {
                    k += 1;
                }
                out.push_str(&self.s[run_start..k]);
                continue;
            }
            k += 1;
            if k >= j {
                return Err(LexError);
            }
            match self.b[k] {
                b'"' => out.push('"'),
                b'\\' => out.push('\\'),
                b'/' => out.push('/'),
                b'b' => out.push('\u{8}'),
                b'f' => out.push('\u{c}'),
                b'n' => out.push('\n'),
                b'r' => out.push('\r'),
                b't' => out.push('\t'),
                b'u' => {
                    let n1 = self.hex4(k + 1)?;
                    let ch;
                    if (0xD800..=0xDBFF).contains(&n1) {
                        if self.b.get(k + 5) != Some(&b'\\') || self.b.get(k + 6) != Some(&b'u') {
                            return Err(LexError);
                        }
                        let n2 = self.hex4(k + 7)?;
                        if !(0xDC00..=0xDFFF).contains(&n2) {
                            return Err(LexError);
                        }
                        let cp = 0x10000 + ((n1 - 0xD800) << 10) + (n2 - 0xDC00);
                        ch = char::from_u32(cp).ok_or(LexError)?;
                        k += 10;
                    } else if (0xDC00..=0xDFFF).contains(&n1) {
                        return Err(LexError);
                    } else {
                        ch = char::from_u32(n1).ok_or(LexError)?;
                        k += 4;
                    }
                    out.push(ch);
                }
                _ => return Err(LexError),
            }
            k += 1;
        }
        Ok(out)
    }

    fn hex4(&self, pos: usize) -> Result<u32, LexError> {
        if pos + 4 > self.b.len() {
            return Err(LexError);
        }
        let mut n = 0u32;
        for j in 0..4 {
            let d = match self.b[pos + j] {
                c @ b'0'..=b'9' => (c - b'0') as u32,
                c @ b'a'..=b'f' => (c - b'a' + 10) as u32,
                c @ b'A'..=b'F' => (c - b'A' + 10) as u32,
                _ => return Err(LexError),
            };
            n = n * 16 + d;
        }
        Ok(n)
    }

    fn json_number(&mut self) -> Result<JsonValue, LexError> {
        let start = self.i;
        let b = self.b;
        let len = b.len();
        let mut k = self.i;
        if k < len && b[k] == b'-' {
            k += 1;
        }
        if k >= len {
            return Err(LexError);
        }
        if b[k] == b'0' {
            k += 1;
            if k < len && b[k].is_ascii_digit() {
                return Err(LexError);
            }
        } else if b[k].is_ascii_digit() {
            while k < len && b[k].is_ascii_digit() {
                k += 1;
            }
        } else {
            return Err(LexError);
        }
        let mut is_real = false;
        if k < len && b[k] == b'.' {
            is_real = true;
            k += 1;
            if k >= len || !b[k].is_ascii_digit() {
                return Err(LexError);
            }
            while k < len && b[k].is_ascii_digit() {
                k += 1;
            }
        }
        if k < len && (b[k] | 0x20) == b'e' {
            is_real = true;
            k += 1;
            if k < len && (b[k] == b'+' || b[k] == b'-') {
                k += 1;
            }
            if k >= len || !b[k].is_ascii_digit() {
                return Err(LexError);
            }
            while k < len && b[k].is_ascii_digit() {
                k += 1;
            }
        }
        self.i = k;
        let mut p = start;
        let neg = b[p] == b'-';
        if neg {
            p += 1;
        }
        let mut mant = 0u64;
        let mut exp = 0i32;
        let mut overflow = false;
        while p < k && b[p].is_ascii_digit() {
            let d = (b[p] - b'0') as u64;
            match mant.checked_mul(10).and_then(|x| x.checked_add(d)) {
                Some(m) => mant = m,
                None => overflow = true,
            }
            p += 1;
        }
        if p < k && b[p] == b'.' {
            p += 1;
            while p < k && b[p].is_ascii_digit() {
                let d = (b[p] - b'0') as u64;
                match mant.checked_mul(10).and_then(|x| x.checked_add(d)) {
                    Some(m) => mant = m,
                    None => overflow = true,
                }
                exp -= 1;
                p += 1;
            }
        }
        if p < k && (b[p] | 0x20) == b'e' {
            p += 1;
            let eneg = p < k && (b[p] == b'-');
            if p < k && (b[p] == b'+' || b[p] == b'-') {
                p += 1;
            }
            let mut e = 0i32;
            while p < k && b[p].is_ascii_digit() {
                e = e.saturating_mul(10).saturating_add((b[p] - b'0') as i32);
                p += 1;
            }
            exp += if eneg { -e } else { e };
        }
        const FAST_MANT_MAX: u64 = 1u64 << 53;
        let f = if overflow || mant > FAST_MANT_MAX || exp.unsigned_abs() > 22 {
            let text = &self.s[start..k];
            let raw: f64 = text.parse().map_err(|_| LexError)?;
            if !raw.is_finite() {
                return Err(LexError);
            }
            raw
        } else {
            let mut v = (mant as f64)
                * if exp >= 0 {
                    POW10[exp as usize]
                } else {
                    f64::NAN
                };
            if exp < 0 {
                v = (mant as f64) / POW10[(-exp) as usize];
            }
            if neg {
                v = -v;
            }
            if !v.is_finite() {
                return Err(LexError);
            }
            v
        };
        let f = if !is_real && f == 0.0 { 0.0 } else { f };
        match Number::from_f64(f) {
            Some(n) => Ok(JsonValue::Number(n)),
            None => Err(LexError),
        }
    }
}

pub fn json_eq(a: &JsonValue, b: &JsonValue) -> bool {
    match (a, b) {
        (JsonValue::Null, JsonValue::Null) => true,
        (JsonValue::Bool(x), JsonValue::Bool(y)) => x == y,
        (JsonValue::String(x), JsonValue::String(y)) => x == y,
        (JsonValue::Number(x), JsonValue::Number(y)) => x.as_f64() == y.as_f64(),
        (JsonValue::Array(x), JsonValue::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y.iter()).all(|(p, q)| json_eq(p, q))
        }
        (JsonValue::Object(x), JsonValue::Object(y)) => {
            x.len() == y.len() && x.iter().zip(y.iter()).all(|((k1, v1), (k2, v2))| k1 == k2 && json_eq(v1, v2))
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::{json_eq, parse};
    use serde_json::Value as JsonValue;

    fn assert_same(json: &str) {
        let ours = parse(json);
        let serde = serde_json::from_str::<JsonValue>(json);
        match (ours, serde) {
            (Ok(a), Ok(b)) => {
                assert!(json_eq(&a, &b), "mismatch for {json}")
            }
            (Ok(_), Err(_)) => panic!("ours ok but serde rejected: {json}"),
            (Err(_), Ok(_)) => panic!("ours rejected but serde ok: {json}"),
            (Err(_), Err(_)) => {}
        }
    }

    #[test]
    fn matches_serde_on_basic_values() {
        for json in [
            "{}", "[]", "0", "-0", "1", "-1", "1.5", "-2.25", "0.1", "1e2", "1E2", "-1.5e-3",
            "\"\"", "\"abc\"", "\"\\u0041\"", "\"\\ud83d\\ude00\"", "true", "false", "null",
            "{\"a\":1,\"b\":[2,3],\"c\":{\"d\":\"e\"}}", "[1,[2,[3]]]",
            "9007199254740992", "9007199254740993", "-9007199254740993", "123456789012345678901",
            "1e23", "1e308", "5e-324", "1e309", "-1e309", "0.000", "2.0", "1_0", "\"\\uDEAD\"",
            "0.3", "0.6", "0.7", "1.1", "2.7", "9.58", "0.001", "1e-10", "1e21", "1e22", "5e-22",
            "0.30000000000000004", "123.456", "-0.15", "33.3333", "0.1e-7", "9007199254740993.0",
            "18446744073709551615", "18446744073709551616", "-9223372036854775808",
            "0.5", "2.2250738585072014e-308", "1.7976931348623157e308",
        ] {
            assert_same(json);
        }
    }

    #[test]
    fn matches_serde_on_rejections() {
        for json in [
            "", "{", "[", "}", "]", "x", "\"", "\"\\x41\"", "\"\\\"", "\"unterminated\\",
            "01", "1.", ".5", "+1", "-", "1e", "1e+", "--1", "0x10", "1 2", "{}x", "[] ", "nullx",
            "{\"a\":}", "{\"a\" 1}", "{,}", "[1,]", "[,1]", "{\"a\":1,}", "nul", "TRue",
            "\"\\ud800\"", "\"\\udc00\\udc00\"", "\"a\nb\"", "1e309",
        ] {
            assert_same(json);
        }
    }

    #[test]
    fn matches_serde_on_duplicate_keys() {
        assert_same("{\"a\":1,\"a\":2}");
        let a = parse("{\"a\":1,\"a\":2}").unwrap();
        assert_eq!(a.get("a").and_then(|x| x.as_f64()), Some(2.0));
    }

    #[test]
    fn matches_serde_on_unicode_escapes() {
        assert_same("\"\\uFEffname\"");
        assert_same("\"héllo wörld\"");
        let s = parse("\"\\ud834\\udd1e\"").unwrap();
        assert_eq!(s.as_str().map(|x| x.chars().count()), Some(1));
    }

    #[test]
    fn depth_limit_matches_serde_cap() {
        let mut deep = String::new();
        for _ in 0..131 {
            deep.push('[');
        }
        for _ in 0..131 {
            deep.push(']');
        }
        assert_same(&deep);
        let mut ok_depth = String::new();
        for _ in 0..100 {
            ok_depth.push('[');
        }
        for _ in 0..100 {
            ok_depth.push(']');
        }
        assert_same(&ok_depth);
    }

    #[test]
    fn node_limit_guard_trips() {
        let mut big = String::new();
        big.reserve(1_400_002);
        for _ in 0..700_000 {
            big.push('[');
        }
        for _ in 0..700_000 {
            big.push(']');
        }
        assert!(parse(&big).is_err());
    }

    #[test]
    fn matches_serde_on_tgs_like_fragment() {
        let json = r#"{"tgs":1,"v":"5.5.2","fr":60,"ip":0,"op":180,"w":512,"h":512,"nm":"dog","ddd":0,"markers":[],"layers":[{"ind":1,"ty":4,"nm":"sh","ks":{"o":{"a":0,"k":100,"ix":100},"r":{"a":1,"k":[{"t":0,"s":[10],"e":[360],"i":{"x":[0.667],"y":[1]},"o":{"x":[0.333],"y":[0]},"n":[],"to":[],"ti":[]}]},"p":{"a":0,"k":[100.5,-2.25,0]},"a":{"a":0,"k":[0,0,0]},"s":{"a":0,"k":[100,100,100]}},"shapes":[{"ty":"gr","it":[{"ty":"el","p":{"a":0,"k":[0,0]},"s":{"a":0,"k":[80,80]}},{"ty":"fl","c":{"a":0,"k":[1,0.5,0,1]},"o":{"a":0,"k":100}}]}],"ip":0,"op":180,"st":0,"sr":1}]}"#;
        assert_same(json);
        let v = parse(json).unwrap();
        assert_eq!(
            v.get("layers").and_then(|l| l.get(0)).and_then(|l| l.get("ty")).and_then(|x| x.as_f64()),
            Some(4.0)
        );
    }
}
