use std::sync::Arc;

use crate::easing::{build_easing, CubicBezier};
use crate::jsutil::{
    js_is_object, js_number, js_owned_opt_str, js_str, js_strict_eq, js_truthy, unwrap_value_owned,
};
use crate::json::{JsonStr, LexError, Lexer, Value};
use crate::keyframes::{parse_value_owned, property_from_k};
use crate::parser::{
    layer_type_of, parse_asset, parse_layer, parse_markers, parse_mask, parse_shape, parse_text, shape_type_name,
};
use crate::types::{
    BezierEasingDef, FillRule, GradientType, MatteType, ParsedAnimation, ParsedAsset, ParsedDash,
    ParsedGradient, ParsedKeyframe, ParsedLayer, ParsedMask, ParsedProperty, ParsedPropertyData,
    ParsedShape, ParsedTransform, TrimMode, VertContour, VertFast, VertKf, VertShape,
};

const SLOTS: usize = 17;
const SP_P: usize = 0;
const SP_A: usize = 1;
const SP_S: usize = 2;
const SP_E: usize = 3;
const SP_O: usize = 4;
const SP_C: usize = 5;
const SP_W: usize = 6;
const SP_PT: usize = 7;
const SP_OR: usize = 8;
const SP_IR: usize = 9;
const SP_OS: usize = 10;
const SP_IS: usize = 11;
const SP_KS: usize = 12;
const SP_RD: usize = 13;
const SP_R: usize = 14;
const SP_D: usize = 15;
const SP_H: usize = 16;

pub(crate) fn parse_animation(json: &str) -> Result<(ParsedAnimation, bool), crate::TgsError> {
    let mut p = Direct { lex: Lexer::new(json) };
    if p.lex.peek_byte() != Some(b'{') {
        crate::json::parse(json).map_err(|_| invalid())?;
        return Ok((ParsedAnimation::default(), false));
    }
    let out = p.animation().map_err(|_| invalid())?;
    p.lex.finish().map_err(|_| invalid())?;
    Ok(out)
}

fn invalid() -> crate::TgsError {
    crate::TgsError("Invalid TGS JSON".to_string())
}

fn truthy_or(v: Option<&Value>, default: f64) -> f64 {
    if js_truthy(v) {
        js_number(v.unwrap())
    } else {
        default
    }
}

fn null_prop() -> ParsedProperty {
    ParsedProperty::default()
}

fn default_transform() -> ParsedTransform {
    ParsedTransform {
        opacity: Some(null_prop()),
        rotation: Some(null_prop()),
        position: Some(null_prop()),
        anchor: Some(null_prop()),
        scale: Some(null_prop()),
        skew: None,
        skew_axis: None,
        start_opacity: None,
        end_opacity: None,
    }
}

fn default_layer() -> ParsedLayer {
    ParsedLayer {
        layer_type: layer_type_of(None),
        transform: default_transform(),
        ..Default::default()
    }
}

fn default_asset() -> ParsedAsset {
    ParsedAsset {
        id: None,
        width: None,
        height: None,
        u: None,
        p: None,
        layers: None,
    }
}

fn layers_from_value(v: Value) -> Option<Vec<ParsedLayer>> {
    match v {
        Value::Array(arr) => Some(arr.into_iter().filter_map(|mut l| parse_layer(&mut l)).collect()),
        _ => None,
    }
}

fn assets_from_value(v: Value) -> Option<Vec<ParsedAsset>> {
    match v {
        Value::Array(arr) => Some(arr.into_iter().map(|mut a| parse_asset(&mut a)).collect()),
        _ => None,
    }
}

fn shapes_from_value(v: Value) -> Option<Vec<ParsedShape>> {
    match v {
        Value::Array(arr) => Some(arr.into_iter().filter_map(|mut s| parse_shape(&mut s)).collect()),
        _ => None,
    }
}

fn masks_from_value(v: Value) -> Option<Vec<ParsedMask>> {
    match v {
        Value::Array(arr) => Some(arr.into_iter().map(|mut m| parse_mask(&mut m)).collect()),
        _ => None,
    }
}

fn owned_f64_vec(v: Value) -> Option<Vec<f64>> {
    match v {
        Value::Nums(n) => Some(n.iter().collect()),
        Value::Array(a) => Some(a.iter().map(js_number).collect()),
        _ => None,
    }
}

fn owned_first_f64(v: Value) -> Option<f64> {
    match v {
        Value::Number(n) => Some(n),
        Value::Nums(n) => n.first(),
        Value::Array(a) => a.first().map(js_number),
        Value::String(_) | Value::Bool(_) => Some(js_number(&v)),
        _ => None,
    }
}

fn time_of_value(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => Some(*n),
        _ if v.is_array() => v.arr_first_num(),
        _ => None,
    }
}

fn dashes_from(v: Value) -> Option<Vec<ParsedDash>> {
    match v {
        Value::Array(dashes) => Some(
            dashes
                .into_iter()
                .map(|mut d| ParsedDash {
                    name: js_owned_opt_str(d.get("n")),
                    value: parse_value_owned(d.take("v")),
                })
                .collect(),
        ),
        _ => None,
    }
}

struct PVal {
    prop: ParsedProperty,
    truthy: bool,
    nonnull: bool,
    number: Option<f64>,
    is_array: bool,
}

struct KfRaw {
    t_exact: Option<f64>,
    t_of: f64,
    keyframe: bool,
    s: Option<Value>,
    e: Option<Value>,
    to: Option<Vec<f64>>,
    ti: Option<Vec<f64>>,
    h: Option<Value>,
    n: Option<Value>,
    o: Option<BezierEasingDef>,
    i: Option<BezierEasingDef>,
}

impl Default for KfRaw {
    fn default() -> Self {
        KfRaw {
            t_exact: None,
            t_of: f64::INFINITY,
            keyframe: false,
            s: None,
            e: None,
            to: None,
            ti: None,
            h: None,
            n: None,
            o: None,
            i: None,
        }
    }
}

fn build_keyframes(items: Vec<KfRaw>) -> Vec<ParsedKeyframe> {
    let mut ordered: Vec<(f64, KfRaw)> = items.into_iter().map(|r| (r.t_of, r)).collect();
    if !ordered.windows(2).all(|w| !(w[0].0 > w[1].0)) {
        ordered.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    }
    let mut keyframes: Vec<ParsedKeyframe> = Vec::with_capacity(ordered.len());
    for (_, raw) in ordered {
        let t = match raw.t_exact {
            Some(t) => t,
            None => continue,
        };
        let s_val = raw.s;
        if let Some(prev) = keyframes.last_mut() {
            prev.end_frame = Some(t);
        }
        let s = match s_val {
            Some(s) => s,
            None => continue,
        };
        let hold = matches!(&raw.h, Some(Value::Number(n)) if *n == 1.0);
        let s_unwrapped = unwrap_value_owned(s);
        let e = raw.e.map(unwrap_value_owned);
        let to = raw.to;
        let ti = raw.ti;
        let h = raw.h.filter(|v| !v.is_null());
        let n = raw.n.filter(|v| !v.is_null());
        let o = raw.o;
        let i = raw.i;
        let easing = build_easing(o.as_ref(), i.as_ref());
        let easing_curve = easing.map(|e| Box::new(CubicBezier::from_easing(e)));
        keyframes.push(ParsedKeyframe {
            t,
            s: s_unwrapped,
            end_frame: Some(t),
            hold,
            o,
            i,
            easing,
            easing_curve,
            e,
            to,
            ti,
            h,
            n,
        });
    }
    keyframes
}

struct Direct<'a> {
    lex: Lexer<'a>,
}

impl<'a> Direct<'a> {
    fn animation(&mut self) -> Result<(ParsedAnimation, bool), LexError> {
        self.lex.expect(b'{')?;
        self.lex.enter_at(0)?;
        let mut layers: Vec<ParsedLayer> = Vec::new();
        let mut assets: Vec<ParsedAsset> = Vec::new();
        let mut layers_ok = false;
        let mut w: Option<Value> = None;
        let mut h: Option<Value> = None;
        let mut fr: Option<Value> = None;
        let mut ip: Option<Value> = None;
        let mut op: Option<Value> = None;
        let mut nm: Option<Value> = None;
        let mut v: Option<Value> = None;
        let mut tgs: Option<Value> = None;
        let mut ddd: Option<Value> = None;
        let mut markers: Option<Value> = None;
        if !self.lex.eat(b'}') {
            loop {
                let key = self.lex.key_cow()?;
                self.lex.expect(b':')?;
                match &*key {
                    "layers" => {
                        if self.lex.peek_byte() == Some(b'[') {
                            layers_ok = true;
                            layers = self.layers_value(1)?.unwrap_or_default();
                        } else {
                            self.lex.skip_value(1)?;
                            layers = Vec::new();
                            layers_ok = false;
                        }
                    }
                    "assets" => {
                        if self.lex.peek_byte() == Some(b'[') {
                            assets = self.assets_value(1)?.unwrap_or_default();
                        } else {
                            self.lex.skip_value(1)?;
                            assets = Vec::new();
                        }
                    }
                    "w" => w = Some(self.lex.value_at(1)?),
                    "h" => h = Some(self.lex.value_at(1)?),
                    "fr" => fr = Some(self.lex.value_at(1)?),
                    "ip" => ip = Some(self.lex.value_at(1)?),
                    "op" => op = Some(self.lex.value_at(1)?),
                    "nm" => nm = Some(self.lex.value_at(1)?),
                    "v" => v = Some(self.lex.value_at(1)?),
                    "tgs" => tgs = Some(self.lex.value_at(1)?),
                    "ddd" => ddd = Some(self.lex.value_at(1)?),
                    "markers" => markers = Some(self.lex.value_at(1)?),
                    _ => self.lex.skip_value(1)?,
                }
                match self.lex.peek_byte() {
                    Some(b',') => {
                        self.lex.eat(b',');
                    }
                    Some(b'}') => {
                        self.lex.eat(b'}');
                        break;
                    }
                    _ => return Err(LexError),
                }
            }
        }
        let fps = truthy_or(fr.as_ref(), 30.0);
        let in_frame = truthy_or(ip.as_ref(), 0.0);
        let out_frame = truthy_or(op.as_ref(), 0.0);
        let animation = ParsedAnimation {
            width: truthy_or(w.as_ref(), 512.0),
            height: truthy_or(h.as_ref(), 512.0),
            fps,
            in_frame,
            out_frame,
            duration: (out_frame - in_frame) / fps,
            layers,
            assets,
            name: js_owned_opt_str(nm.as_ref()),
            version: js_owned_opt_str(v.as_ref()),
            tgs: matches!(tgs.as_ref(), Some(Value::Number(n)) if *n == 1.0),
            is3d: matches!(ddd.as_ref(), Some(Value::Number(n)) if *n == 1.0),
            markers: parse_markers(markers.as_ref()),
        };
        Ok((animation, layers_ok))
    }

    fn layers_value(&mut self, depth: usize) -> Result<Option<Vec<ParsedLayer>>, LexError> {
        let start = self.lex.pos();
        self.lex.expect(b'[')?;
        self.lex.enter_at(depth)?;
        if self.lex.eat(b']') {
            return Ok(Some(Vec::new()));
        }
        if self.lex.peek_byte() != Some(b'{') {
            self.lex.seek(start);
            return Ok(layers_from_value(self.lex.value_at(depth)?));
        }
        let mut out = Vec::new();
        loop {
            if self.lex.peek_byte() == Some(b'{') {
                if let Some(l) = self.layer(depth + 1)? {
                    out.push(l);
                }
            } else {
                self.lex.skip_value(depth + 1)?;
                out.push(default_layer());
            }
            match self.lex.peek_byte() {
                Some(b',') => {
                    self.lex.eat(b',');
                }
                Some(b']') => {
                    self.lex.eat(b']');
                    break;
                }
                _ => return Err(LexError),
            }
        }
        Ok(Some(out))
    }

    fn assets_value(&mut self, depth: usize) -> Result<Option<Vec<ParsedAsset>>, LexError> {
        let start = self.lex.pos();
        self.lex.expect(b'[')?;
        self.lex.enter_at(depth)?;
        if self.lex.eat(b']') {
            return Ok(Some(Vec::new()));
        }
        if self.lex.peek_byte() != Some(b'{') {
            self.lex.seek(start);
            return Ok(assets_from_value(self.lex.value_at(depth)?));
        }
        let mut out = Vec::new();
        loop {
            out.push(self.asset(depth + 1)?);
            match self.lex.peek_byte() {
                Some(b',') => {
                    self.lex.eat(b',');
                }
                Some(b']') => {
                    self.lex.eat(b']');
                    break;
                }
                _ => return Err(LexError),
            }
        }
        Ok(Some(out))
    }

    fn asset(&mut self, depth: usize) -> Result<ParsedAsset, LexError> {
        if self.lex.peek_byte() != Some(b'{') {
            self.lex.skip_value(depth)?;
            return Ok(default_asset());
        }
        self.lex.expect(b'{')?;
        self.lex.enter_at(depth)?;
        let mut id: Option<Value> = None;
        let mut width: Option<Value> = None;
        let mut height: Option<Value> = None;
        let mut u: Option<Value> = None;
        let mut p: Option<Value> = None;
        let mut layers: Option<Arc<Vec<ParsedLayer>>> = None;
        if !self.lex.eat(b'}') {
            loop {
                let key = self.lex.key_cow()?;
                self.lex.expect(b':')?;
                match &*key {
                    "id" => id = Some(self.lex.value_at(depth + 1)?),
                    "w" => width = Some(self.lex.value_at(depth + 1)?),
                    "h" => height = Some(self.lex.value_at(depth + 1)?),
                    "u" => u = Some(self.lex.value_at(depth + 1)?),
                    "p" => p = Some(self.lex.value_at(depth + 1)?),
                    "layers" => {
                        if self.lex.peek_byte() == Some(b'[') {
                            layers = self.layers_value(depth + 1)?.map(Arc::new);
                        } else {
                            self.lex.skip_value(depth + 1)?;
                            layers = None;
                        }
                    }
                    _ => self.lex.skip_value(depth + 1)?,
                }
                match self.lex.peek_byte() {
                    Some(b',') => {
                        self.lex.eat(b',');
                    }
                    Some(b'}') => {
                        self.lex.eat(b'}');
                        break;
                    }
                    _ => return Err(LexError),
                }
            }
        }
        Ok(ParsedAsset {
            id: js_owned_opt_str(id.as_ref()),
            width: width.as_ref().filter(|v| !v.is_null()).map(js_number),
            height: height.as_ref().filter(|v| !v.is_null()).map(js_number),
            u: js_owned_opt_str(u.as_ref()),
            p: js_owned_opt_str(p.as_ref()),
            layers,
        })
    }

    fn layer(&mut self, depth: usize) -> Result<Option<ParsedLayer>, LexError> {
        self.lex.expect(b'{')?;
        self.lex.enter_at(depth)?;
        let mut ind: Option<Value> = None;
        let mut parent: Option<Value> = None;
        let mut ks: Option<ParsedTransform> = None;
        let mut nm: Option<Value> = None;
        let mut ref_id: Option<Value> = None;
        let mut ip: Option<Value> = None;
        let mut op: Option<Value> = None;
        let mut st: Option<Value> = None;
        let mut sr: Option<Value> = None;
        let mut ao: Option<Value> = None;
        let mut ddd: Option<Value> = None;
        let mut bm: Option<Value> = None;
        let mut sc: Option<Value> = None;
        let mut sw: Option<Value> = None;
        let mut sh: Option<Value> = None;
        let mut lw: Option<Value> = None;
        let mut lh: Option<Value> = None;
        let mut tt: Option<Value> = None;
        let mut td: Option<Value> = None;
        let mut tm: Option<PVal> = None;
        let mut masks: Option<Vec<ParsedMask>> = None;
        let mut text: Option<Value> = None;
        let mut shapes: Option<Vec<ParsedShape>> = None;
        let mut hd: Option<Value> = None;
        let mut ty: Option<Value> = None;
        if !self.lex.eat(b'}') {
            loop {
                let key = self.lex.key_cow()?;
                self.lex.expect(b':')?;
                match &*key {
                    "ind" => ind = Some(self.lex.value_at(depth + 1)?),
                    "parent" => parent = Some(self.lex.value_at(depth + 1)?),
                    "ks" => {
                        if self.lex.peek_byte() == Some(b'{') {
                            ks = Some(self.transform_here(depth + 1)?);
                        } else {
                            self.lex.skip_value(depth + 1)?;
                            ks = None;
                        }
                    }
                    "nm" => nm = Some(self.lex.value_at(depth + 1)?),
                    "refId" => ref_id = Some(self.lex.value_at(depth + 1)?),
                    "ip" => ip = Some(self.lex.value_at(depth + 1)?),
                    "op" => op = Some(self.lex.value_at(depth + 1)?),
                    "st" => st = Some(self.lex.value_at(depth + 1)?),
                    "sr" => sr = Some(self.lex.value_at(depth + 1)?),
                    "ao" => ao = Some(self.lex.value_at(depth + 1)?),
                    "ddd" => ddd = Some(self.lex.value_at(depth + 1)?),
                    "bm" => bm = Some(self.lex.value_at(depth + 1)?),
                    "sc" => sc = Some(self.lex.value_at(depth + 1)?),
                    "sw" => sw = Some(self.lex.value_at(depth + 1)?),
                    "sh" => sh = Some(self.lex.value_at(depth + 1)?),
                    "w" => lw = Some(self.lex.value_at(depth + 1)?),
                    "h" => lh = Some(self.lex.value_at(depth + 1)?),
                    "tt" => tt = Some(self.lex.value_at(depth + 1)?),
                    "td" => td = Some(self.lex.value_at(depth + 1)?),
                    "tm" => tm = Some(self.property_here(depth + 1)?),
                    "masksProperties" => masks = self.masks_value(depth + 1)?,
                    "t" => text = Some(self.lex.value_at(depth + 1)?),
                    "shapes" => shapes = self.shapes_value(depth + 1)?,
                    "hd" => hd = Some(self.lex.value_at(depth + 1)?),
                    "ty" => ty = Some(self.lex.value_at(depth + 1)?),
                    _ => self.lex.skip_value(depth + 1)?,
                }
                match self.lex.peek_byte() {
                    Some(b',') => {
                        self.lex.eat(b',');
                    }
                    Some(b'}') => {
                        self.lex.eat(b'}');
                        break;
                    }
                    _ => return Err(LexError),
                }
            }
        }
        if parent.as_ref().map_or(false, |p| !p.is_null()) && js_strict_eq(parent.as_ref(), ind.as_ref()) {
            return Ok(None);
        }
        let parent_index = parent.as_ref().filter(|p| !p.is_null()).map(js_number);
        let mut result = ParsedLayer {
            index: ind.as_ref().map(js_number),
            layer_type: layer_type_of(ty.as_ref()),
            transform: ks.unwrap_or_else(default_transform),
            ..Default::default()
        };
        if js_truthy(nm.as_ref()) {
            result.name = js_owned_opt_str(nm.as_ref());
        }
        result.parent_index = parent_index;
        if js_truthy(ref_id.as_ref()) {
            result.ref_id = js_owned_opt_str(ref_id.as_ref());
        }
        if let Some(v) = ip.as_ref().filter(|v| !v.is_null()) {
            result.in_frame = Some(js_number(v));
        }
        if let Some(v) = op.as_ref().filter(|v| !v.is_null()) {
            result.out_frame = Some(js_number(v));
        }
        if let Some(v) = st.as_ref().filter(|v| !v.is_null()) {
            result.start_time = Some(js_number(v));
        }
        if let Some(v) = sr.as_ref().filter(|v| !v.is_null()) {
            result.stretch = Some(js_number(v));
        }
        if let Some(v) = ao.as_ref().filter(|v| !v.is_null()) {
            result.auto_orient = Some(js_number(v));
        }
        if js_truthy(ddd.as_ref()) {
            result.is3d = Some(true);
        }
        if let Some(v) = bm.as_ref().filter(|v| !v.is_null()) {
            result.blend_mode = Some(js_number(v));
        }
        if js_truthy(sc.as_ref()) {
            result.solid_color = js_owned_opt_str(sc.as_ref());
        }
        if let Some(v) = sw.as_ref().filter(|v| !v.is_null()) {
            result.solid_width = Some(js_number(v));
        }
        if let Some(v) = sh.as_ref().filter(|v| !v.is_null()) {
            result.solid_height = Some(js_number(v));
        }
        if let Some(v) = lw.as_ref().filter(|v| !v.is_null()) {
            result.layer_width = Some(js_number(v));
        }
        if let Some(v) = lh.as_ref().filter(|v| !v.is_null()) {
            result.layer_height = Some(js_number(v));
        }
            if let Some(v) = tt.as_ref().filter(|v| !v.is_null()) {
            result.matte_type = Some(match js_str(v).as_str() {
                "1" => MatteType::Alpha,
                "2" => MatteType::AlphaInv,
                "3" => MatteType::Luma,
                "4" => MatteType::LumaInv,
                _ => MatteType::None,
            });
        }
        if td.as_ref().map_or(false, |v| !v.is_null()) {
            result.matte_target = Some(true);
        }
        if let Some(pv) = tm {
            if pv.truthy {
                result.time_remap = Some(pv.prop);
            }
        }
        result.masks = masks;
        if js_truthy(text.as_ref()) {
            result.text = parse_text(text.as_ref());
        }
        result.shapes = shapes;
        if js_truthy(hd.as_ref()) {
            result.layer_type = crate::types::LayerType::Null;
            result.hidden = Some(true);
            result.shapes = None;
            result.masks = None;
            result.text = None;
            result.ref_id = None;
            result.matte_type = None;
            result.matte_target = None;
        }
        Ok(Some(result))
    }

    fn shapes_value(&mut self, depth: usize) -> Result<Option<Vec<ParsedShape>>, LexError> {
        let start = self.lex.pos();
        self.lex.expect(b'[')?;
        self.lex.enter_at(depth)?;
        if self.lex.eat(b']') {
            return Ok(Some(Vec::new()));
        }
        if self.lex.peek_byte() != Some(b'{') {
            self.lex.seek(start);
            return Ok(shapes_from_value(self.lex.value_at(depth)?));
        }
        let mut out = Vec::with_capacity(4);
        loop {
            if self.lex.peek_byte() == Some(b'{') {
                if let Some(s) = self.shape(depth + 1)? {
                    out.push(s);
                }
            } else {
                self.lex.skip_value(depth + 1)?;
            }
            match self.lex.peek_byte() {
                Some(b',') => {
                    self.lex.eat(b',');
                }
                Some(b']') => {
                    self.lex.eat(b']');
                    break;
                }
                _ => return Err(LexError),
            }
        }
        Ok(Some(out))
    }

    fn masks_value(&mut self, depth: usize) -> Result<Option<Vec<ParsedMask>>, LexError> {
        if self.lex.peek_byte() != Some(b'[') {
            self.lex.skip_value(depth)?;
            return Ok(None);
        }
        Ok(masks_from_value(self.lex.value_at(depth)?))
    }

    fn shape(&mut self, depth: usize) -> Result<Option<ParsedShape>, LexError> {
        self.lex.expect(b'{')?;
        self.lex.enter_at(depth)?;
        let mut ty: Option<Value> = None;
        let mut nm: Option<Value> = None;
        let mut mn: Option<Value> = None;
        let mut ix: Option<Value> = None;
        let mut hd: Option<Value> = None;
        let mut children: Option<Vec<ParsedShape>> = None;
        let mut slots: [Option<PVal>; SLOTS] = std::array::from_fn(|_| None);
        let mut t: Option<Value> = None;
        let mut m: Option<Value> = None;
        let mut sy: Option<Value> = None;
        let mut lc: Option<Value> = None;
        let mut lj: Option<Value> = None;
        let mut ml: Option<Value> = None;
        let mut mm: Option<Value> = None;
        let mut tr: Option<ParsedTransform> = None;
        let mut tr_truthy = false;
        let mut grad: Option<(Option<f64>, ParsedProperty)> = None;
        if !self.lex.eat(b'}') {
            loop {
                let key = self.lex.key_cow()?;
                self.lex.expect(b':')?;
                match &*key {
                    "ty" => ty = Some(self.lex.value_at(depth + 1)?),
                    "nm" => nm = Some(self.lex.value_at(depth + 1)?),
                    "mn" => mn = Some(self.lex.value_at(depth + 1)?),
                    "ix" => ix = Some(self.lex.value_at(depth + 1)?),
                    "hd" => hd = Some(self.lex.value_at(depth + 1)?),
                    "it" => children = self.shapes_value(depth + 1)?,
                    "tr" => {
                        if self.lex.peek_byte() == Some(b'{') {
                            tr = Some(self.transform_here(depth + 1)?);
                            tr_truthy = true;
                        } else {
                            let v = self.lex.value_at(depth + 1)?;
                            tr_truthy = js_truthy(Some(&v));
                            tr = if tr_truthy { Some(default_transform()) } else { None };
                        }
                    }
                    "g" => grad = Some(self.gradient_here(depth + 1)?),
                    "p" => slots[SP_P] = Some(self.property_here(depth + 1)?),
                    "a" => slots[SP_A] = Some(self.property_here(depth + 1)?),
                    "s" => slots[SP_S] = Some(self.property_here(depth + 1)?),
                    "e" => slots[SP_E] = Some(self.property_here(depth + 1)?),
                    "o" => slots[SP_O] = Some(self.property_here(depth + 1)?),
                    "c" => slots[SP_C] = Some(self.property_here(depth + 1)?),
                    "w" => slots[SP_W] = Some(self.property_here(depth + 1)?),
                    "pt" => slots[SP_PT] = Some(self.property_here(depth + 1)?),
                    "or" => slots[SP_OR] = Some(self.property_here(depth + 1)?),
                    "ir" => slots[SP_IR] = Some(self.property_here(depth + 1)?),
                    "os" => slots[SP_OS] = Some(self.property_here(depth + 1)?),
                    "is" => slots[SP_IS] = Some(self.property_here(depth + 1)?),
                    "ks" => slots[SP_KS] = Some(self.property_here(depth + 1)?),
                    "rd" => slots[SP_RD] = Some(self.property_here(depth + 1)?),
                    "r" => slots[SP_R] = Some(self.property_here(depth + 1)?),
                    "d" => slots[SP_D] = Some(self.property_here(depth + 1)?),
                    "h" => slots[SP_H] = Some(self.property_here(depth + 1)?),
                    "t" => t = Some(self.lex.value_at(depth + 1)?),
                    "m" => m = Some(self.lex.value_at(depth + 1)?),
                    "sy" => sy = Some(self.lex.value_at(depth + 1)?),
                    "lc" => lc = Some(self.lex.value_at(depth + 1)?),
                    "lj" => lj = Some(self.lex.value_at(depth + 1)?),
                    "ml" => ml = Some(self.lex.value_at(depth + 1)?),
                    "mm" => mm = Some(self.lex.value_at(depth + 1)?),
                    _ => self.lex.skip_value(depth + 1)?,
                }
                match self.lex.peek_byte() {
                    Some(b',') => {
                        self.lex.eat(b',');
                    }
                    Some(b'}') => {
                        self.lex.eat(b'}');
                        break;
                    }
                    _ => return Err(LexError),
                }
            }
        }
        if js_truthy(hd.as_ref()) {
            return Ok(None);
        }
        let shape_type = shape_type_name(ty.as_ref());
        let mut result = ParsedShape {
            shape_type: shape_type.clone(),
            ..Default::default()
        };
        if js_truthy(nm.as_ref()) {
            result.name = js_owned_opt_str(nm.as_ref());
        }
        if js_truthy(mn.as_ref()) {
            result.match_name = js_owned_opt_str(mn.as_ref());
        }
        if let Some(v) = ix.as_ref().filter(|v| !v.is_null()) {
            result.index = Some(js_number(v));
        }
        result.children = children;
        if shape_type == "trim" {
            if let Some(pv) = slots[SP_S].take() {
                if pv.truthy {
                    result.start = Some(pv.prop);
                }
            }
            if let Some(pv) = slots[SP_E].take() {
                if pv.truthy {
                    result.end = Some(pv.prop);
                }
            }
            if let Some(pv) = slots[SP_O].take() {
                if pv.truthy {
                    result.offset = Some(pv.prop);
                }
            }
            if let Some(v) = m.as_ref().filter(|v| !v.is_null()) {
                result.trim_mode = Some(if js_number(v) == 2.0 {
                    TrimMode::Individually
                } else {
                    TrimMode::Simultaneously
                });
            }
            return Ok(Some(result));
        }
        if shape_type == "fill" {
            if let Some(pv) = slots[SP_C].take() {
                if pv.truthy {
                    result.color = Some(pv.prop);
                }
            }
            if let Some(pv) = slots[SP_O].take() {
                if pv.truthy {
                    result.opacity = Some(pv.prop);
                }
            }
            if let Some(pv) = slots[SP_R].take() {
                if pv.number == Some(2.0) {
                    result.fill_rule = Some(FillRule::Evenodd);
                } else if pv.number == Some(1.0) {
                    result.fill_rule = Some(FillRule::Winding);
                }
            }
            return Ok(Some(result));
        }
        if shape_type == "stroke" {
            if let Some(pv) = slots[SP_C].take() {
                if pv.truthy {
                    result.color = Some(pv.prop);
                }
            }
            if let Some(pv) = slots[SP_O].take() {
                if pv.truthy {
                    result.opacity = Some(pv.prop);
                }
            }
            if let Some(pv) = slots[SP_W].take() {
                if pv.truthy {
                    result.stroke_width = Some(pv.prop);
                }
            }
            if let Some(v) = lc.as_ref().filter(|v| !v.is_null()) {
                result.line_cap = Some(js_number(v));
            }
            if let Some(v) = lj.as_ref().filter(|v| !v.is_null()) {
                result.line_join = Some(js_number(v));
            }
            if let Some(v) = ml.as_ref().filter(|v| !v.is_null()) {
                result.miter_limit = Some(js_number(v));
            }
            if let Some(mut pv) = slots[SP_D].take() {
                if pv.is_array {
                    result.dashes = dashes_from(core::mem::take(&mut pv.prop.value));
                }
            }
            return Ok(Some(result));
        }
        if shape_type == "gradientFill" || shape_type == "gradientStroke" {
            let (color_points, stops) = grad.unwrap_or_else(|| (None, null_prop()));
            let gradient_type = if t.as_ref().and_then(|v| v.as_f64()) == Some(2.0) {
                GradientType::Radial
            } else {
                GradientType::Linear
            };
            let start_point = slots[SP_S].take().map(|p| p.prop).unwrap_or_else(null_prop);
            let end_point = slots[SP_E].take().map(|p| p.prop).unwrap_or_else(null_prop);
            let highlight_length = slots[SP_H].take().and_then(|p| if p.truthy { Some(p.prop) } else { None });
            let highlight_angle = slots[SP_A].take().and_then(|p| if p.truthy { Some(p.prop) } else { None });
            result.gradient = Some(ParsedGradient {
                gradient_type,
                start_point,
                end_point,
                highlight_length,
                highlight_angle,
                color_points,
                stops,
                stops_cache: Default::default(),
            });
            if let Some(pv) = slots[SP_O].take() {
                if pv.truthy {
                    result.opacity = Some(pv.prop);
                }
            }
            if shape_type == "gradientStroke" {
                if let Some(pv) = slots[SP_W].take() {
                    if pv.truthy {
                        result.stroke_width = Some(pv.prop);
                    }
                }
                if let Some(v) = lc.as_ref().filter(|v| !v.is_null()) {
                    result.line_cap = Some(js_number(v));
                }
                if let Some(v) = lj.as_ref().filter(|v| !v.is_null()) {
                    result.line_join = Some(js_number(v));
                }
                if let Some(v) = ml.as_ref().filter(|v| !v.is_null()) {
                    result.miter_limit = Some(js_number(v));
                }
                if let Some(mut pv) = slots[SP_D].take() {
                    if pv.is_array {
                        result.dashes = dashes_from(core::mem::take(&mut pv.prop.value));
                    }
                }
            }
            return Ok(Some(result));
        }
        if shape_type == "ellipse" {
            if let Some(pv) = slots[SP_P].take() {
                if pv.truthy {
                    result.position = Some(pv.prop);
                }
            }
            if let Some(pv) = slots[SP_S].take() {
                if pv.truthy {
                    result.size = Some(pv.prop);
                }
            }
            if let Some(pv) = slots[SP_D].take() {
                if let Some(n) = pv.number {
                    result.direction = Some(n);
                }
            }
            return Ok(Some(result));
        }
        if shape_type == "rect" {
            if let Some(pv) = slots[SP_P].take() {
                if pv.truthy {
                    result.position = Some(pv.prop);
                }
            }
            if let Some(pv) = slots[SP_S].take() {
                if pv.truthy {
                    result.size = Some(pv.prop);
                }
            }
            if let Some(pv) = slots[SP_R].take() {
                if pv.truthy {
                    result.radius = Some(pv.prop);
                }
            }
            if let Some(pv) = slots[SP_D].take() {
                if let Some(n) = pv.number {
                    result.direction = Some(n);
                }
            }
            if let Some(pv) = slots[SP_RD].take() {
                if pv.truthy {
                    result.rd = Some(Box::new(ParsedShape {
                        shape_type: JsonStr::new("roundedCorner"),
                        radius: Some(pv.prop),
                        ..Default::default()
                    }));
                }
            }
            return Ok(Some(result));
        }
        if shape_type == "roundedCorner" {
            if let Some(pv) = slots[SP_R].take() {
                if pv.truthy {
                    result.radius = Some(pv.prop);
                }
            }
            return Ok(Some(result));
        }
        if shape_type == "path" {
            if let Some(pv) = slots[SP_KS].take() {
                if pv.truthy {
                    result.verts_fast = compile_verts_fast(&pv.prop);
                    result.vertices = Some(pv.prop);
                }
            }
            return Ok(Some(result));
        }
        if shape_type == "star" {
            if let Some(pv) = slots[SP_P].take() {
                if pv.truthy {
                    result.position = Some(pv.prop);
                }
            }
            if let Some(n) = sy.as_ref().and_then(|v| v.as_f64()) {
                result.star_type = Some(n);
            }
            if let Some(pv) = slots[SP_PT].take() {
                if pv.truthy {
                    result.points = Some(pv.prop);
                }
            }
            if let Some(pv) = slots[SP_R].take() {
                if pv.truthy {
                    result.rotation = Some(pv.prop);
                }
            }
            if let Some(pv) = slots[SP_OR].take() {
                if pv.truthy {
                    result.outer_radius = Some(pv.prop);
                }
            }
            if let Some(pv) = slots[SP_IR].take() {
                if pv.truthy {
                    result.inner_radius = Some(pv.prop);
                }
            }
            if let Some(pv) = slots[SP_OS].take() {
                if pv.nonnull {
                    result.outer_roundness = Some(pv.prop);
                }
            }
            if let Some(pv) = slots[SP_IS].take() {
                if pv.nonnull {
                    result.inner_roundness = Some(pv.prop);
                }
            }
            return Ok(Some(result));
        }
        if shape_type == "repeater" {
            if let Some(pv) = slots[SP_C].take() {
                if pv.truthy {
                    result.copies = Some(pv.prop);
                }
            }
            if let Some(pv) = slots[SP_O].take() {
                if pv.truthy {
                    result.copies_offset = Some(pv.prop);
                }
            }
            if let Some(n) = m.as_ref().and_then(|v| v.as_f64()) {
                result.composite = Some(n);
            }
            if tr_truthy {
                result.transform = tr;
            }
            return Ok(Some(result));
        }
        if shape_type == "merge" {
            if let Some(n) = mm.as_ref().and_then(|v| v.as_f64()) {
                result.merge_mode = Some(n);
            }
            return Ok(Some(result));
        }
        if shape_type == "transform" {
            if let Some(pv) = slots[SP_P].take() {
                if pv.truthy {
                    result.position = Some(pv.prop);
                }
            }
            if let Some(pv) = slots[SP_A].take() {
                if pv.truthy {
                    result.anchor = Some(pv.prop);
                }
            }
            if let Some(pv) = slots[SP_S].take() {
                if pv.truthy {
                    result.scale = Some(pv.prop);
                }
            }
            if let Some(pv) = slots[SP_R].take() {
                if pv.truthy {
                    result.rotation = Some(pv.prop);
                }
            }
            if let Some(pv) = slots[SP_O].take() {
                if pv.truthy {
                    result.opacity = Some(pv.prop);
                }
            }
            return Ok(Some(result));
        }
        Ok(Some(result))
    }

    fn transform_here(&mut self, depth: usize) -> Result<ParsedTransform, LexError> {
        self.lex.expect(b'{')?;
        self.lex.enter_at(depth)?;
        let mut t = default_transform();
        if !self.lex.eat(b'}') {
            loop {
                let key = self.lex.key_cow()?;
                self.lex.expect(b':')?;
                match &*key {
                    "o" => t.opacity = Some(self.property_here(depth + 1)?.prop),
                    "r" => t.rotation = Some(self.property_here(depth + 1)?.prop),
                    "p" => t.position = Some(self.property_here(depth + 1)?.prop),
                    "a" => t.anchor = Some(self.property_here(depth + 1)?.prop),
                    "s" => t.scale = Some(self.property_here(depth + 1)?.prop),
                    "sk" => {
                        let pv = self.property_here(depth + 1)?;
                        t.skew = if pv.truthy { Some(pv.prop) } else { None };
                    }
                    "sa" => {
                        let pv = self.property_here(depth + 1)?;
                        t.skew_axis = if pv.truthy { Some(pv.prop) } else { None };
                    }
                    "so" => {
                        let pv = self.property_here(depth + 1)?;
                        t.start_opacity = if pv.truthy { Some(pv.prop) } else { None };
                    }
                    "eo" => {
                        let pv = self.property_here(depth + 1)?;
                        t.end_opacity = if pv.truthy { Some(pv.prop) } else { None };
                    }
                    _ => self.lex.skip_value(depth + 1)?,
                }
                match self.lex.peek_byte() {
                    Some(b',') => {
                        self.lex.eat(b',');
                    }
                    Some(b'}') => {
                        self.lex.eat(b'}');
                        break;
                    }
                    _ => return Err(LexError),
                }
            }
        }
        Ok(t)
    }

    fn gradient_here(&mut self, depth: usize) -> Result<(Option<f64>, ParsedProperty), LexError> {
        if self.lex.peek_byte() != Some(b'{') {
            self.lex.skip_value(depth)?;
            return Ok((None, null_prop()));
        }
        self.lex.expect(b'{')?;
        self.lex.enter_at(depth)?;
        let mut color_points = None;
        let mut stops = null_prop();
        if !self.lex.eat(b'}') {
            loop {
                let key = self.lex.key_cow()?;
                self.lex.expect(b':')?;
                match &*key {
                    "p" => {
                        let v = self.lex.value_at(depth + 1)?;
                        color_points = v.as_f64();
                    }
                    "k" => stops = self.property_here(depth + 1)?.prop,
                    _ => self.lex.skip_value(depth + 1)?,
                }
                match self.lex.peek_byte() {
                    Some(b',') => {
                        self.lex.eat(b',');
                    }
                    Some(b'}') => {
                        self.lex.eat(b'}');
                        break;
                    }
                    _ => return Err(LexError),
                }
            }
        }
        Ok((color_points, stops))
    }

    fn property_here(&mut self, depth: usize) -> Result<PVal, LexError> {
        if self.lex.peek_byte() != Some(b'{') {
            let v = self.lex.value_at(depth)?;
            let truthy = js_truthy(Some(&v));
            let nonnull = !v.is_null();
            let number = v.as_f64();
            let is_array = matches!(v, Value::Array(_));
            return Ok(PVal {
                prop: ParsedProperty::new(ParsedPropertyData {
                    animated: false,
                    value: v,
                    ..Default::default()
                }),
                truthy,
                nonnull,
                number,
                is_array,
            });
        }
        self.lex.expect(b'{')?;
        self.lex.enter_at(depth)?;
        let mut k: Option<ParsedProperty> = None;
        let mut x: Option<Value> = None;
        let mut y: Option<Value> = None;
        if !self.lex.eat(b'}') {
            loop {
                let key = self.lex.key_cow()?;
                self.lex.expect(b':')?;
                match &*key {
                    "k" => k = Some(self.k_property(depth + 1)?),
                    "x" => x = Some(self.lex.value_at(depth + 1)?),
                    "y" => y = Some(self.lex.value_at(depth + 1)?),
                    _ => self.lex.skip_value(depth + 1)?,
                }
                match self.lex.peek_byte() {
                    Some(b',') => {
                        self.lex.eat(b',');
                    }
                    Some(b'}') => {
                        self.lex.eat(b'}');
                        break;
                    }
                    _ => return Err(LexError),
                }
            }
        }
        let mut prop = match k {
            Some(p) => p,
            None => null_prop(),
        };
        if let Some(xv) = x {
            if js_truthy(Some(&xv)) && js_is_object(&xv) {
                prop.x = Some(Box::new(parse_value_owned(Some(xv))));
            }
        }
        if let Some(yv) = y {
            if js_truthy(Some(&yv)) && js_is_object(&yv) {
                prop.y = Some(Box::new(parse_value_owned(Some(yv))));
            }
        }
        Ok(PVal {
            prop,
            truthy: true,
            nonnull: true,
            number: None,
            is_array: false,
        })
    }

    fn k_property(&mut self, depth: usize) -> Result<ParsedProperty, LexError> {
        if self.lex.peek_byte() != Some(b'[') {
            let v = self.lex.value_at(depth)?;
            return Ok(property_from_k(Some(v)));
        }
        let start = self.lex.pos();
        self.lex.expect(b'[')?;
        if self.lex.peek_byte() == Some(b'{') {
            self.lex.enter_at(depth)?;
            let first = self.kf_object(depth + 1)?;
            if first.keyframe {
                let mut items = Vec::new();
                items.push(first);
                loop {
                    match self.lex.peek_byte() {
                        Some(b',') => {
                            self.lex.eat(b',');
                            match self.lex.peek_byte() {
                                Some(b'{') => {
                                    let it = self.kf_object(depth + 1)?;
                                    items.push(it);
                                }
                                Some(b']') => return Err(LexError),
                                Some(_) => self.lex.skip_value(depth + 1)?,
                                None => return Err(LexError),
                            }
                        }
                        Some(b']') => {
                            self.lex.eat(b']');
                            break;
                        }
                        _ => return Err(LexError),
                    }
                }
                let keyframes = build_keyframes(items);
                let value = keyframes[0].s.clone();
                return Ok(ParsedProperty::new(ParsedPropertyData {
                    animated: true,
                    value,
                    keyframes: Some(keyframes),
                    ..Default::default()
                }));
            }
        }
        self.lex.seek(start);
        let v = self.lex.value_at(depth)?;
        Ok(property_from_k(Some(v)))
    }

    fn kf_object(&mut self, depth: usize) -> Result<KfRaw, LexError> {
        self.lex.expect(b'{')?;
        self.lex.enter_at(depth)?;
        let mut r = KfRaw::default();
        let mut has_t = false;
        let mut has_s = false;
        if !self.lex.eat(b'}') {
            loop {
                let key = self.lex.key_cow()?;
                self.lex.expect(b':')?;
                match &*key {
                    "t" => {
                        let v = self.lex.value_at(depth + 1)?;
                        r.t_exact = time_of_value(&v);
                        r.t_of = r.t_exact.unwrap_or(f64::INFINITY);
                        has_t = r.t_exact.is_some();
                    }
                    "s" => {
                        r.s = Some(self.lex.value_at(depth + 1)?);
                        has_s = true;
                    }
                    "e" => r.e = Some(self.lex.value_at(depth + 1)?),
                    "h" => r.h = Some(self.lex.value_at(depth + 1)?),
                    "n" => r.n = Some(self.lex.value_at(depth + 1)?),
                    "to" => {
                        let v = self.lex.value_at(depth + 1)?;
                        r.to = owned_f64_vec(v);
                    }
                    "ti" => {
                        let v = self.lex.value_at(depth + 1)?;
                        r.ti = owned_f64_vec(v);
                    }
                    "o" => r.o = self.easing_object(depth + 1)?,
                    "i" => r.i = self.easing_object(depth + 1)?,
                    _ => self.lex.skip_value(depth + 1)?,
                }
                match self.lex.peek_byte() {
                    Some(b',') => {
                        self.lex.eat(b',');
                    }
                    Some(b'}') => {
                        self.lex.eat(b'}');
                        break;
                    }
                    _ => return Err(LexError),
                }
            }
        }
        r.keyframe = has_t && has_s;
        Ok(r)
    }

    fn easing_object(&mut self, depth: usize) -> Result<Option<BezierEasingDef>, LexError> {
        if self.lex.peek_byte() != Some(b'{') {
            self.lex.skip_value(depth)?;
            return Ok(None);
        }
        self.lex.expect(b'{')?;
        self.lex.enter_at(depth)?;
        let mut x = None;
        let mut y = None;
        if !self.lex.eat(b'}') {
            loop {
                let key = self.lex.key_cow()?;
                self.lex.expect(b':')?;
                match &*key {
                    "x" => {
                        let v = self.lex.value_at(depth + 1)?;
                        x = owned_first_f64(v);
                    }
                    "y" => {
                        let v = self.lex.value_at(depth + 1)?;
                        y = owned_first_f64(v);
                    }
                    _ => self.lex.skip_value(depth + 1)?,
                }
                match self.lex.peek_byte() {
                    Some(b',') => {
                        self.lex.eat(b',');
                    }
                    Some(b'}') => {
                        self.lex.eat(b'}');
                        break;
                    }
                    _ => return Err(LexError),
                }
            }
        }
        Ok(Some(BezierEasingDef { x, y }))
    }
}

#[cfg(test)]
mod ease_tests {
    use super::*;

    #[test]
    fn easing_arrays_parse() {
        let json = r#"{"layers":[{"ty":4,"ks":{"p":{"a":1,"k":[{"t":0,"s":[0,0],"o":{"x":[0.333,0.333,0.333],"y":[0,0,0]},"i":{"x":[0.667,0.667,0.667],"y":[1,1,1]}},{"t":10,"s":[10,10]}]}}}]}"#;
        let (anim, _) = parse_animation(json).unwrap();
        let kf = &anim.layers[0].transform.position.as_ref().unwrap().keyframes.as_ref().unwrap()[0];
        println!("easing={:?} o={:?} i={:?}", kf.easing, kf.o, kf.i);
        assert_eq!(kf.easing.map(|e| (e.x1, e.y1, e.x2, e.y2)), Some((0.333, 0.0, 0.667, 1.0)));
    }
}

fn vert_pair_ok(el: Option<&crate::json::Value>) -> Option<[f64; 2]> {
    match el {
        None => Some([0.0, 0.0]),
        Some(v) => match v {
            crate::json::Value::Nums(n) => {
                if n.len() != 2 {
                    return None;
                }
                let x = n.get(0)?;
                let y = n.get(1)?;
                if x.is_finite() && y.is_finite() {
                    Some([x, y])
                } else {
                    None
                }
            }
            crate::json::Value::Array(a) => {
                if a.len() != 2 {
                    return None;
                }
                let x = a[0].as_f64()?;
                let y = a[1].as_f64()?;
                if x.is_finite() && y.is_finite() {
                    Some([x, y])
                } else {
                    None
                }
            }
            _ => None,
        },
    }
}

fn vert_contour_from(v: &crate::json::Value) -> Option<VertContour> {
    let varr = v.get("v")?.as_array()?;
    let iarr = v.get("i").and_then(|x| x.as_array());
    let oarr = v.get("o").and_then(|x| x.as_array());
    let closed = match v.get("c") {
        Some(crate::json::Value::Bool(b)) => Some(*b),
        Some(_) => Some(true),
        None => None,
    };
    let nv = varr.len();
    let ni = iarr.map_or(0, |a| a.len());
    let no = oarr.map_or(0, |a| a.len());
    let mut flat: Vec<f64> = Vec::with_capacity((nv + ni + no) * 2);
    for j in 0..nv {
        let p = vert_pair_ok(varr.get(j))?;
        flat.push(p[0]);
        flat.push(p[1]);
    }
    for j in 0..ni {
        let p = vert_pair_ok(iarr.and_then(|a| a.get(j)))?;
        flat.push(p[0]);
        flat.push(p[1]);
    }
    for j in 0..no {
        let p = vert_pair_ok(oarr.and_then(|a| a.get(j)))?;
        flat.push(p[0]);
        flat.push(p[1]);
    }
    Some(VertContour {
        closed,
        nv,
        ni,
        no,
        flat,
    })
}

fn vert_shape_from(v: &crate::json::Value) -> Option<VertShape> {
    match v {
        crate::json::Value::Object(_) => {
            let c = vert_contour_from(v)?;
            Some(VertShape { contours: vec![c] })
        }
        crate::json::Value::Array(a) => {
            let mut contours = Vec::with_capacity(a.len());
            for it in a.iter() {
                contours.push(vert_contour_from(it)?);
            }
            Some(VertShape { contours })
        }
        _ => None,
    }
}

fn compile_verts_fast(prop: &ParsedProperty) -> Option<Box<VertFast>> {
    let data: &ParsedPropertyData = &**prop;
    if data.override_value.is_some() || data.x.is_some() || data.y.is_some() {
        return None;
    }
    if data.animated {
        let kfs = data.keyframes.as_ref()?;
        if kfs.is_empty() {
            return None;
        }
        let mut out: Vec<VertKf> = Vec::with_capacity(kfs.len());
        for (idx, kf) in kfs.iter().enumerate() {
            if kf.to.is_some() || kf.ti.is_some() {
                return None;
            }
            let s = vert_shape_from(&kf.s)?;
            let next = kfs.get(idx + 1);
            let (e_eff, e_obj) = if kf.e.is_some() && next.map_or(false, |n| n.e.is_some()) {
                let ev = kf.e.as_ref().unwrap();
                (vert_shape_from(ev)?, ev.is_object())
            } else if let Some(n) = next {
                (vert_shape_from(&n.s)?, n.s.is_object())
            } else {
                match kf.e.as_ref() {
                    Some(ev) => (vert_shape_from(ev)?, ev.is_object()),
                    None => (s.clone(), true),
                }
            };
            out.push(VertKf {
                t: kf.t,
                end_frame: kf.end_frame,
                hold: kf.hold,
                snap: !kf.s.is_object() || !e_obj,
                s,
                e: Some(e_eff),
                easing_curve: kf.easing_curve.clone(),
            });
        }
        return Some(Box::new(VertFast {
            animated: true,
            keyframes: out,
            ..Default::default()
        }));
    }
    let value = vert_shape_from(&data.value)?;
    Some(Box::new(VertFast {
        animated: false,
        value,
        ..Default::default()
    }))
}
