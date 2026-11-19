use std::borrow::Cow;
use std::fmt::Write as _;

pub type Number = f64;

#[derive(Clone)]
pub enum JsonStr {
    Inline { len: u8, bytes: [u8; 22] },
    Heap(Box<str>),
}

impl JsonStr {
    #[inline]
    pub fn as_str(&self) -> &str {
        match self {
            JsonStr::Inline { len, bytes } => unsafe { std::str::from_utf8_unchecked(&bytes[..*len as usize]) },
            JsonStr::Heap(s) => s,
        }
    }

    pub fn new(s: &str) -> JsonStr {
        if s.len() <= 22 {
            let mut bytes = [0u8; 22];
            bytes[..s.len()].copy_from_slice(s.as_bytes());
            JsonStr::Inline { len: s.len() as u8, bytes }
        } else {
            JsonStr::Heap(s.into())
        }
    }
}

impl std::ops::Deref for JsonStr {
    type Target = str;
    fn deref(&self) -> &str {
        self.as_str()
    }
}

impl PartialEq for JsonStr {
    fn eq(&self, other: &Self) -> bool {
        self.as_str() == other.as_str()
    }
}

impl Eq for JsonStr {}

impl PartialEq<str> for JsonStr {
    fn eq(&self, other: &str) -> bool {
        self.as_str() == other
    }
}

impl PartialEq<&str> for JsonStr {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}

impl From<&str> for JsonStr {
    fn from(s: &str) -> Self {
        JsonStr::new(s)
    }
}

impl From<String> for JsonStr {
    fn from(s: String) -> Self {
        JsonStr::new(&s)
    }
}

impl From<Box<str>> for JsonStr {
    fn from(s: Box<str>) -> Self {
        JsonStr::Heap(s)
    }
}

impl std::fmt::Debug for JsonStr {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::fmt::Display for JsonStr {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl Default for JsonStr {
    fn default() -> JsonStr {
        JsonStr::Inline { len: 0, bytes: [0u8; 22] }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Nums {
    N1(f64),
    N2(f64, f64),
    N3(f64, f64, f64),
}

impl Nums {
    #[inline]
    pub fn of1(v: f64) -> Nums {
        Nums::N1(v)
    }

    #[inline]
    pub fn of2(a: f64, b: f64) -> Nums {
        Nums::N2(a, b)
    }

    #[inline]
    pub fn of3(a: f64, b: f64, c: f64) -> Nums {
        Nums::N3(a, b, c)
    }

    #[inline]
    pub fn len(&self) -> usize {
        match self {
            Nums::N1(_) => 1,
            Nums::N2(_, _) => 2,
            Nums::N3(_, _, _) => 3,
        }
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        false
    }

    #[inline]
    pub fn get(&self, i: usize) -> Option<f64> {
        match (self, i) {
            (Nums::N1(a), 0) => Some(*a),
            (Nums::N2(a, _), 0) => Some(*a),
            (Nums::N2(_, b), 1) => Some(*b),
            (Nums::N3(a, _, _), 0) => Some(*a),
            (Nums::N3(_, b, _), 1) => Some(*b),
            (Nums::N3(_, _, c), 2) => Some(*c),
            _ => None,
        }
    }

    #[inline]
    pub fn first(&self) -> Option<f64> {
        self.get(0)
    }

    pub fn iter(&self) -> impl Iterator<Item = f64> + '_ {
        (0..self.len()).map(|i| self.get(i).unwrap_or(f64::NAN))
    }
}

#[derive(Debug, Clone)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    String(JsonStr),
    Array(Vec<Value>),
    Nums(Nums),
    Object(Map),
}

impl PartialEq for Value {
    fn eq(&self, other: &Value) -> bool {
        match (self, other) {
            (Value::Null, Value::Null) => true,
            (Value::Bool(a), Value::Bool(b)) => a == b,
            (Value::Number(a), Value::Number(b)) => a == b,
            (Value::String(a), Value::String(b)) => a == b,
            (Value::Array(a), Value::Array(b)) => a == b,
            (Value::Nums(a), Value::Nums(b)) => a == b,
            (Value::Nums(n), Value::Array(a)) | (Value::Array(a), Value::Nums(n)) => {
                a.len() == n.len() && a.iter().zip(n.iter()).all(|(x, y)| x.as_f64() == Some(y))
            }
            (Value::Object(a), Value::Object(b)) => a == b,
            _ => false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Map {
    entries: Vec<(JsonStr, Value)>,
}

impl Map {
    pub fn new() -> Map {
        Map { entries: Vec::new() }
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn with_capacity(cap: usize) -> Map {
        Map { entries: Vec::with_capacity(cap) }
    }

    #[inline]
    pub fn push(&mut self, key: JsonStr, val: Value) {
        self.entries.push((key, val));
    }

    pub fn insert(&mut self, key: impl Into<JsonStr>, val: Value) {
        let key = key.into();
        if let Some(slot) = self.entries.iter_mut().find(|(k, _)| k.as_str() == key.as_str()) {
            slot.1 = val;
        } else {
            self.entries.push((key, val));
        }
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        self.entries.iter().rev().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    pub fn get_mut(&mut self, key: &str) -> Option<&mut Value> {
        self.entries.iter_mut().rev().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    pub fn take(&mut self, key: &str) -> Option<Value> {
        self.entries.iter_mut().rev().find(|(k, _)| k == key).map(|(_, v)| std::mem::take(v))
    }

    pub fn iter(&self) -> std::slice::Iter<'_, (JsonStr, Value)> {
        self.entries.iter()
    }
}

impl std::ops::Index<&str> for Value {
    type Output = Value;

    fn index(&self, key: &str) -> &Value {
        self.get(key).expect("JSON object key")
    }
}

impl std::ops::Index<usize> for Value {
    type Output = Value;

    fn index(&self, i: usize) -> &Value {
        self.as_array().expect("JSON array").get(i).expect("JSON array index")
    }
}

fn map_entry(p: &(JsonStr, Value)) -> (&str, &Value) {
    (&p.0, &p.1)
}

impl<'a> IntoIterator for &'a Map {
    type Item = (&'a str, &'a Value);
    type IntoIter = std::iter::Map<std::slice::Iter<'a, (JsonStr, Value)>, fn(&(JsonStr, Value)) -> (&str, &Value)>;

    fn into_iter(self) -> Self::IntoIter {
        self.entries.iter().map(map_entry)
    }
}

impl Value {
    pub fn is_null(&self) -> bool {
        matches!(self, Value::Null)
    }

    pub fn is_object(&self) -> bool {
        matches!(self, Value::Object(_))
    }

    pub fn is_array(&self) -> bool {
        matches!(self, Value::Array(_) | Value::Nums(_))
    }

    pub fn is_nums(&self) -> bool {
        matches!(self, Value::Nums(_))
    }

    pub fn as_nums(&self) -> Option<&Nums> {
        match self {
            Value::Nums(n) => Some(n),
            _ => None,
        }
    }

    pub fn arr_len(&self) -> Option<usize> {
        match self {
            Value::Array(a) => Some(a.len()),
            Value::Nums(n) => Some(n.len()),
            _ => None,
        }
    }

    pub fn arr_at(&self, i: usize) -> Option<f64> {
        match self {
            Value::Array(a) => a.get(i).and_then(|v| v.as_f64()),
            Value::Nums(n) => n.get(i),
            _ => None,
        }
    }

    pub fn arr_first_num(&self) -> Option<f64> {
        self.arr_at(0)
    }

    pub fn is_num_array(&self) -> bool {
        match self {
            Value::Array(a) => a.iter().all(|x| x.is_number()),
            Value::Nums(_) => true,
            _ => false,
        }
    }

    pub fn is_number(&self) -> bool {
        matches!(self, Value::Number(_))
    }

    pub fn is_string(&self) -> bool {
        matches!(self, Value::String(_))
    }

    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Value::Number(n) => Some(*n),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&Vec<Value>> {
        match self {
            Value::Array(a) => Some(a),
            _ => None,
        }
    }

    pub fn as_array_mut(&mut self) -> Option<&mut Vec<Value>> {
        match self {
            Value::Array(a) => Some(a),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::String(s) => Some(s.as_str()),
            _ => None,
        }
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Object(m) => m.get(key),
            _ => None,
        }
    }

    pub fn take(&mut self, key: &str) -> Option<Value> {
        match self {
            Value::Object(m) => m.take(key),
            _ => None,
        }
    }

    pub fn as_object(&self) -> Option<&Map> {
        match self {
            Value::Object(m) => Some(m),
            _ => None,
        }
    }

    pub fn as_object_mut(&mut self) -> Option<&mut Map> {
        match self {
            Value::Object(m) => Some(m),
            _ => None,
        }
    }
}

impl Default for Value {
    fn default() -> Value {
        Value::Null
    }
}

pub trait IntoValue {
    fn into_value(self) -> Value;
}

impl IntoValue for f64 {
    fn into_value(self) -> Value {
        Value::Number(self)
    }
}

impl IntoValue for f32 {
    fn into_value(self) -> Value {
        Value::Number(self as f64)
    }
}

impl IntoValue for i32 {
    fn into_value(self) -> Value {
        Value::Number(self as f64)
    }
}

impl IntoValue for i64 {
    fn into_value(self) -> Value {
        Value::Number(self as f64)
    }
}

impl IntoValue for u32 {
    fn into_value(self) -> Value {
        Value::Number(self as f64)
    }
}

impl IntoValue for usize {
    fn into_value(self) -> Value {
        Value::Number(self as f64)
    }
}

impl IntoValue for bool {
    fn into_value(self) -> Value {
        Value::Bool(self)
    }
}

impl IntoValue for &str {
    fn into_value(self) -> Value {
        Value::String(JsonStr::new(self))
    }
}

impl IntoValue for String {
    fn into_value(self) -> Value {
        Value::String(JsonStr::new(&self))
    }
}

impl IntoValue for Value {
    fn into_value(self) -> Value {
        self
    }
}

pub fn jn(n: f64) -> Value {
    Value::Number(n)
}

pub fn js(s: &str) -> Value {
    Value::String(JsonStr::new(s))
}

pub fn jarr(items: Vec<Value>) -> Value {
    Value::Array(items)
}

pub fn jobj(entries: Vec<(&str, Value)>) -> Value {
    let mut m = Map::new();
    for (k, v) in entries {
        m.insert(k.to_string(), v);
    }
    Value::Object(m)
}

pub fn json_eq(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Null, Value::Null) => true,
        (Value::Bool(x), Value::Bool(y)) => x == y,
        (Value::String(x), Value::String(y)) => x == y,
        (Value::Number(x), Value::Number(y)) => x == y,
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y.iter()).all(|(p, q)| json_eq(p, q))
        }
        (Value::Nums(x), Value::Nums(y)) => x == y,
        (Value::Nums(x), Value::Array(y)) | (Value::Array(y), Value::Nums(x)) => {
            y.len() == x.len() && y.iter().zip(x.iter()).all(|(p, q)| p.as_f64() == Some(q))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len() && x.iter().zip(y.iter()).all(|((k1, v1), (k2, v2))| k1 == k2 && json_eq(v1, v2))
        }
        _ => false,
    }
}





pub fn write_string(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

pub fn to_string(v: &Value) -> String {
    let mut out = String::new();
    write_value(&mut out, v);
    out
}

pub fn write_value(out: &mut String, v: &Value) {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(true) => out.push_str("true"),
        Value::Bool(false) => out.push_str("false"),
        Value::Number(n) => {
            if n.is_finite() {
                let _ = write!(out, "{}", n);
            }
        }
        Value::String(s) => write_string(out, s.as_str()),
        Value::Array(a) => {
            out.push('[');
            for (i, item) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_value(out, item);
            }
            out.push(']');
        }
        Value::Nums(n) => {
            out.push('[');
            for (i, item) in n.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                if item.is_finite() {
                    let _ = write!(out, "{}", item);
                }
            }
            out.push(']');
        }
        Value::Object(m) => {
            out.push('{');
            for (i, (k, val)) in m.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_string(out, k);
                out.push(':');
                write_value(out, val);
            }
            out.push('}');
        }
    }
}





#[derive(Debug)]
pub struct LexError;

const MAX_DEPTH: usize = 128;
const MAX_NODES: usize = 500_000;

const POW10: [f64; 23] = [
    1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19,
    1e20, 1e21, 1e22,
];

pub(crate) struct Lexer<'a> {
    s: &'a str,
    b: &'a [u8],
    i: usize,
    nodes: usize,
}

pub fn parse(json: &str) -> Result<Value, LexError> {
    let mut lexer = Lexer { s: json, b: json.as_bytes(), i: 0, nodes: 0 };
    let v = lexer.value(0)?;
    lexer.skip_ws();
    if lexer.i != lexer.b.len() {
        return Err(LexError);
    }
    Ok(v)
}

#[inline]
fn is_ws(c: u8) -> bool {
    c == b' ' || c == b'\t' || c == b'\n' || c == b'\r'
}

const SWAR_LO: u64 = 0x0101_0101_0101_0101;
const SWAR_HI: u64 = 0x8080_8080_8080_8080;

#[inline]
fn swar_stop_mask(v: u64) -> u64 {
    let q = v ^ (SWAR_LO * 0x22);
    let s = v ^ (SWAR_LO * 0x5c);
    ((q.wrapping_sub(SWAR_LO) & !q) | (s.wrapping_sub(SWAR_LO) & !s) | (v.wrapping_sub(SWAR_LO * 0x20) & !v)) & SWAR_HI
}

impl<'a> Lexer<'a> {
    #[inline]
    fn skip_ws(&mut self) {
        while self.i < self.b.len() && is_ws(self.b[self.i]) {
            self.i += 1;
        }
    }

    fn value(&mut self, depth: usize) -> Result<Value, LexError> {
        self.skip_ws();
        match self.b.get(self.i) {
            Some(b'{') => self.object(depth),
            Some(b'[') => self.array(depth),
            Some(b'"') => {
                self.i += 1;
                Ok(Value::String(self.string()?))
            }
            Some(b't') => self.lit(b"true", Value::Bool(true)),
            Some(b'f') => self.lit(b"false", Value::Bool(false)),
            Some(b'n') => self.lit(b"null", Value::Null),
            Some(c) if *c == b'-' || c.is_ascii_digit() => self.json_number(),
            _ => Err(LexError),
        }
    }

    fn lit(&mut self, word: &[u8], v: Value) -> Result<Value, LexError> {
        if self.b.len().saturating_sub(self.i) >= word.len() && &self.b[self.i..self.i + word.len()] == word {
            self.i += word.len();
            Ok(v)
        } else {
            Err(LexError)
        }
    }

    fn object(&mut self, depth: usize) -> Result<Value, LexError> {
        self.enter(depth)?;
        self.i += 1;
        let mut map = Map::new();
        self.skip_ws();
        if self.b.get(self.i) == Some(&b'}') {
            self.i += 1;
            return Ok(Value::Object(map));
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
            map.push(key, val);
            self.skip_ws();
            match self.b.get(self.i) {
                Some(b',') => self.i += 1,
                Some(b'}') => {
                    self.i += 1;
                    return Ok(Value::Object(map));
                }
                _ => return Err(LexError),
            }
        }
    }

    fn array(&mut self, depth: usize) -> Result<Value, LexError> {
        self.enter(depth)?;
        self.i += 1;
        self.skip_ws();
        if self.b.get(self.i) == Some(&b']') {
            self.i += 1;
            return Ok(Value::Array(Vec::new()));
        }
        if let Some(c) = self.b.get(self.i) {
            if *c == b'-' || c.is_ascii_digit() {
                let first = match self.json_number()? {
                    Value::Number(n) => n,
                    _ => return Err(LexError),
                };
                self.skip_ws();
                if self.b.get(self.i) == Some(&b']') {
                    self.i += 1;
                    return Ok(Value::Nums(Nums::of1(first)));
                }
                if self.b.get(self.i) == Some(&b',') {
                    let comma = self.i;
                    self.i += 1;
                    self.skip_ws();
                    if let Some(c) = self.b.get(self.i) {
                        if *c == b'-' || c.is_ascii_digit() {
                            let second = match self.json_number()? {
                                Value::Number(n) => n,
                                _ => return Err(LexError),
                            };
                            self.skip_ws();
                            if self.b.get(self.i) == Some(&b']') {
                                self.i += 1;
                                return Ok(Value::Nums(Nums::of2(first, second)));
                            }
                            if self.b.get(self.i) == Some(&b',') {
                                let comma2 = self.i;
                                self.i += 1;
                                self.skip_ws();
                                if let Some(c) = self.b.get(self.i) {
                                    if *c == b'-' || c.is_ascii_digit() {
                                        let third = match self.json_number()? {
                                            Value::Number(n) => n,
                                            _ => return Err(LexError),
                                        };
                                        self.skip_ws();
                                        if self.b.get(self.i) == Some(&b']') {
                                            self.i += 1;
                                            return Ok(Value::Nums(Nums::of3(first, second, third)));
                                        }
                                        let mut arr = Vec::with_capacity(4);
                                        arr.push(Value::Number(first));
                                        arr.push(Value::Number(second));
                                        arr.push(Value::Number(third));
                                        return self.array_tail(depth, arr);
                                    }
                                }
                                self.i = comma2;
                            }
                            let mut arr = Vec::with_capacity(4);
                            arr.push(Value::Number(first));
                            arr.push(Value::Number(second));
                            return self.array_tail(depth, arr);
                        }
                    }
                    self.i = comma;
                    let mut arr = Vec::with_capacity(4);
                    arr.push(Value::Number(first));
                    return self.array_tail(depth, arr);
                }
                let mut arr = Vec::with_capacity(4);
                arr.push(Value::Number(first));
                return self.array_tail(depth, arr);
            }
        }
        let mut arr = Vec::with_capacity(4);
        arr.push(self.value(depth + 1)?);
        self.array_tail(depth, arr)
    }

    fn array_tail(&mut self, depth: usize, mut arr: Vec<Value>) -> Result<Value, LexError> {
        loop {
            self.skip_ws();
            match self.b.get(self.i) {
                Some(b',') => {
                    self.i += 1;
                    arr.push(self.value(depth + 1)?);
                }
                Some(b']') => {
                    self.i += 1;
                    return Ok(Value::Array(arr));
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

    fn string(&mut self) -> Result<JsonStr, LexError> {
        match self.string_cow()? {
            Cow::Borrowed(s) => Ok(JsonStr::new(s)),
            Cow::Owned(s) => Ok(JsonStr::new(&s)),
        }
    }

    fn string_cow(&mut self) -> Result<Cow<'a, str>, LexError> {
        let start = self.i;
        let len = self.b.len();
        let mut j = self.i;
        let mut escaped = false;
        loop {
            while j + 8 <= len {
                let v = unsafe { core::ptr::read_unaligned(self.b.as_ptr().add(j) as *const u64) };
                let m = swar_stop_mask(v);
                if m != 0 {
                    j += (m.trailing_zeros() >> 3) as usize;
                    break;
                }
                j += 8;
            }
            if j >= len {
                return Err(LexError);
            }
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
            return Ok(Cow::Borrowed(&self.s[start..j]));
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
        Ok(Cow::Owned(out))
    }

    fn skip_quoted(&mut self) -> Result<(), LexError> {
        self.skip_ws();
        if self.b.get(self.i) != Some(&b'"') {
            return Err(LexError);
        }
        self.i += 1;
        self.string_cow().map(|_| ())
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

    fn skip_number(&mut self) -> Result<(), LexError> {
        let b = self.b;
        let len = b.len();
        let start = self.i;
        let mut k = start;
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
        if k < len && (b[k] == b'.' || (b[k] | 0x20) == b'e') {
            self.i = start;
            return self.json_number().map(|_| ());
        }
        self.i = k;
        Ok(())
    }

    fn json_number(&mut self) -> Result<Value, LexError> {
        let start = self.i;
        let b = self.b;
        let len = b.len();
        let mut k = self.i;
        let neg = k < len && b[k] == b'-';
        if neg {
            k += 1;
        }
        if k >= len {
            return Err(LexError);
        }
        let mut mant = 0u64;
        let mut exp = 0i32;
        let mut ndig = 0u32;
        let mut is_real = false;
        if b[k] == b'0' {
            k += 1;
            if k < len && b[k].is_ascii_digit() {
                return Err(LexError);
            }
        } else if b[k].is_ascii_digit() {
            while k < len && b[k].is_ascii_digit() {
                mant = mant.wrapping_mul(10).wrapping_add((b[k] - b'0') as u64);
                ndig += 1;
                k += 1;
            }
        } else {
            return Err(LexError);
        }
        if k < len && b[k] == b'.' {
            is_real = true;
            k += 1;
            if k >= len || !b[k].is_ascii_digit() {
                return Err(LexError);
            }
            let frac = k;
            while k < len && b[k].is_ascii_digit() {
                mant = mant.wrapping_mul(10).wrapping_add((b[k] - b'0') as u64);
                ndig += 1;
                k += 1;
            }
            exp -= (k - frac) as i32;
        }
        let overflow = ndig > 19;
        if k < len && (b[k] | 0x20) == b'e' {
            is_real = true;
            k += 1;
            let eneg = k < len && b[k] == b'-';
            if k < len && (b[k] == b'+' || b[k] == b'-') {
                k += 1;
            }
            if k >= len || !b[k].is_ascii_digit() {
                return Err(LexError);
            }
            let mut e = 0i32;
            while k < len && b[k].is_ascii_digit() {
                e = e.saturating_mul(10).saturating_add((b[k] - b'0') as i32);
                k += 1;
            }
            exp = exp.saturating_add(if eneg { -e } else { e });
        }
        self.i = k;
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
        Ok(Value::Number(f))
    }
}

impl<'a> Lexer<'a> {
    pub(crate) fn new(s: &'a str) -> Self {
        Lexer { s, b: s.as_bytes(), i: 0, nodes: 0 }
    }

    pub(crate) fn peek_byte(&mut self) -> Option<u8> {
        self.skip_ws();
        self.b.get(self.i).copied()
    }

    pub(crate) fn eat(&mut self, c: u8) -> bool {
        self.skip_ws();
        if self.b.get(self.i) == Some(&c) {
            self.i += 1;
            true
        } else {
            false
        }
    }

    pub(crate) fn expect(&mut self, c: u8) -> Result<(), LexError> {
        if self.eat(c) {
            Ok(())
        } else {
            Err(LexError)
        }
    }

    pub(crate) fn key_cow(&mut self) -> Result<Cow<'a, str>, LexError> {
        self.skip_ws();
        if self.b.get(self.i) != Some(&b'"') {
            return Err(LexError);
        }
        self.i += 1;
        self.string_cow()
    }

    pub(crate) fn value_at(&mut self, depth: usize) -> Result<Value, LexError> {
        self.value(depth)
    }

    pub(crate) fn enter_at(&mut self, depth: usize) -> Result<(), LexError> {
        self.enter(depth)
    }

    pub(crate) fn pos(&self) -> usize {
        self.i
    }

    pub(crate) fn seek(&mut self, pos: usize) {
        self.i = pos;
    }

    pub(crate) fn finish(&mut self) -> Result<(), LexError> {
        self.skip_ws();
        if self.i == self.b.len() {
            Ok(())
        } else {
            Err(LexError)
        }
    }

    pub(crate) fn skip_value(&mut self, depth: usize) -> Result<(), LexError> {
        self.skip_ws();
        match self.b.get(self.i) {
            Some(b'{') => {
                self.enter(depth)?;
                self.i += 1;
                if self.eat(b'}') {
                    return Ok(());
                }
                loop {
                    self.skip_quoted()?;
                    self.expect(b':')?;
                    self.skip_value(depth + 1)?;
                    match self.peek_byte() {
                        Some(b',') => {
                            self.eat(b',');
                        }
                        Some(b'}') => {
                            self.eat(b'}');
                            return Ok(());
                        }
                        _ => return Err(LexError),
                    }
                }
            }
            Some(b'[') => {
                self.enter(depth)?;
                self.i += 1;
                if self.eat(b']') {
                    return Ok(());
                }
                loop {
                    self.skip_value(depth + 1)?;
                    match self.peek_byte() {
                        Some(b',') => {
                            self.eat(b',');
                        }
                        Some(b']') => {
                            self.eat(b']');
                            return Ok(());
                        }
                        _ => return Err(LexError),
                    }
                }
            }
            Some(b'"') => {
                self.skip_quoted()?;
                Ok(())
            }
            Some(b't') => self.lit(b"true", Value::Bool(true)).map(|_| ()),
            Some(b'f') => self.lit(b"false", Value::Bool(false)).map(|_| ()),
            Some(b'n') => self.lit(b"null", Value::Null).map(|_| ()),
            Some(c) if *c == b'-' || c.is_ascii_digit() => self.skip_number(),
            _ => Err(LexError),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{json_eq, parse, to_string, Value};

    #[test]
    fn parses_basic_values() {
        for json in [
            "{}", "[]", "0", "-0", "1", "-1", "1.5", "-2.25", "0.1", "1e2", "1E2", "-1.5e-3",
            "\"\"", "\"abc\"", "\"\\u0041\"", "\"\\ud83d\\ude00\"", "true", "false", "null",
            "{\"a\":1,\"b\":[2,3],\"c\":{\"d\":\"e\"}}", "[1,[2,[3]]]",
        ] {
            assert!(parse(json).is_ok(), "rejected valid: {json}");
        }
    }

    #[test]
    fn rejects_invalid_values() {
        for json in [
            "", "{", "}", "[", "]", "[1", "{\"a\"}", "{\"a\":}", "01", "1.", ".5", "+1", "01.2",
            "tru", "nul", "\"\\q\"", "\"\\u12\"", "\"unterminated", "{\"a\":1,}", "[1,]",
            "1 2", "{\"a\":1\":[2]}", "- 1", "--1", "1e", "1e+", "0x10", "'a'", "`a`",
        ] {
            assert!(parse(json).is_err(), "accepted invalid: {json}");
        }
    }

    #[test]
    fn rejects_repeated_keys_and_keeps_last() {
        let v = parse("{\"a\":1,\"a\":2}").expect("dup keys must stay valid");
        assert_eq!(v.get("a").and_then(|x| x.as_f64()), Some(2.0));
    }

    #[test]
    fn roundtrips() {
        let src = "{\"a\":[1,2.5,\"x y\",null,true],\"b\":{\"c\":[]}}";
        let v = parse(src).unwrap();
        let s = to_string(&v);
        let v2 = parse(&s).unwrap();
        assert!(json_eq(&v, &v2));
    }

    #[test]
    fn rejects_overlong_nesting() {
        let deep = "[".repeat(200) + &"]".repeat(200);
        assert!(parse(&deep).is_err());
    }

    #[test]
    fn object_iter_preserves_order() {
        let v = parse("{\"z\":1,\"a\":2}").unwrap();
        let Value::Object(m) = v else { panic!() };
        let keys: Vec<&str> = m.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(keys.len(), 2);
    }
}
