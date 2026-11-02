use serde_json::Value as JsonValue;
use crate::types::*;

struct W { v: Vec<u8> }

impl W {
    fn byte(&mut self, x: u8) { self.v.push(x); }
    fn u32(&mut self, x: u32) { self.v.extend_from_slice(&x.to_le_bytes()); }
    fn f64(&mut self, x: f64) { self.v.extend_from_slice(&x.to_le_bytes()); }
    fn str(&mut self, s: &str) {
        self.u32(s.len() as u32);
        self.v.extend_from_slice(s.as_bytes());
    }
    fn many_f64(&mut self, xs: &[f64]) {
        self.u32(xs.len() as u32);
        for &x in xs {
            if x.is_finite() {
                self.byte(1);
                self.f64(x);
            } else {
                self.byte(0);
            }
        }
    }
    fn opt_many_f64(&mut self, xs: &Option<Vec<f64>>) {
        match xs {
            None => self.byte(0),
            Some(v) => { self.byte(1); self.many_f64(v); }
        }
    }
    fn opt_str(&mut self, s: &Option<String>) {
        match s {
            None => self.byte(0),
            Some(v) => { self.byte(1); self.str(v); }
        }
    }
    fn opt_f64(&mut self, x: Option<f64>) {
        match x {
            None => self.byte(0),
            Some(v) if v.is_finite() => { self.byte(1); self.f64(v); }
            Some(_) => self.byte(2),
        }
    }
    fn opt_bool(&mut self, x: Option<bool>) {
        match x {
            None => self.byte(0),
            Some(v) => { self.byte(1); self.byte(if v { 1 } else { 0 }); }
        }
    }
    fn value(&mut self, v: &JsonValue) {
        match v {
            JsonValue::Null => self.byte(0),
            JsonValue::Number(n) => {
                let f = n.as_f64().unwrap_or(f64::NAN);
                if f.is_finite() {
                    self.byte(1);
                    self.f64(f);
                } else {
                    self.byte(0);
                }
            }
            JsonValue::Array(a) => {
                self.byte(2);
                self.u32(a.len() as u32);
                for it in a { self.value(it); }
            }
            JsonValue::String(s) => {
                self.byte(3);
                self.str(s);
            }
            JsonValue::Bool(b) => {
                self.byte(4);
                self.byte(if *b { 1 } else { 0 });
            }
            JsonValue::Object(o) => {
                self.byte(5);
                self.u32(o.len() as u32);
                for (k, x) in o {
                    self.str(k);
                    self.value(x);
                }
            }
        }
    }
    fn opt_value(&mut self, v: &Option<JsonValue>) {
        match v {
            None => self.byte(0),
            Some(x) => { self.byte(1); self.value(x); }
        }
    }
    fn prop(&mut self, p: &ParsedProperty) {
        self.byte(if p.animated { 1 } else { 0 });
        self.value(&p.value);
        self.opt_keyframes(&p.keyframes);
        self.opt_prop_box(&p.x);
        self.opt_prop_box(&p.y);
    }
    fn opt_prop(&mut self, p: &Option<ParsedProperty>) {
        match p {
            None => self.byte(0),
            Some(x) => { self.byte(1); self.prop(x); }
        }
    }
    fn opt_prop_box(&mut self, p: &Option<Box<ParsedProperty>>) {
        match p {
            None => self.byte(0),
            Some(x) => { self.byte(1); self.prop(x.as_ref()); }
        }
    }
    fn opt_keyframes(&mut self, kf: &Option<Vec<ParsedKeyframe>>) {
        match kf {
            None => self.byte(0),
            Some(list) => {
                self.byte(1);
                self.u32(list.len() as u32);
                for k in list {
                    self.f64(k.t);
                    self.value(&k.s);
                    self.opt_f64(k.end_frame);
                    self.byte(if k.hold { 1 } else { 0 });
                    self.opt_easing(&k.easing);
                    self.opt_value(&k.e);
                    self.opt_many_f64(&k.to);
                    self.opt_many_f64(&k.ti);
                    self.opt_value(&k.h);
                    self.opt_value(&k.n);
                }
            }
        }
    }
    fn opt_easing(&mut self, e: &Option<CubicBezierEasing>) {
        match e {
            None => self.byte(0),
            Some(x) => {
                self.byte(1);
                self.f64(x.x1);
                self.f64(x.y1);
                self.f64(x.x2);
                self.f64(x.y2);
            }
        }
    }
    fn transform(&mut self, tr: &ParsedTransform) {
        self.opt_prop(&tr.opacity);
        self.opt_prop(&tr.rotation);
        self.opt_prop(&tr.position);
        self.opt_prop(&tr.anchor);
        self.opt_prop(&tr.scale);
        self.opt_prop(&tr.skew);
        self.opt_prop(&tr.skew_axis);
        self.opt_prop(&tr.start_opacity);
        self.opt_prop(&tr.end_opacity);
    }
    fn opt_transform(&mut self, tr: &Option<ParsedTransform>) {
        match tr {
            None => self.byte(0),
            Some(x) => { self.byte(1); self.transform(x); }
        }
    }
    fn gradient(&mut self, g: &ParsedGradient) {
        self.byte(match g.gradient_type { GradientType::Linear => 1, GradientType::Radial => 2 });
        self.prop(&g.start_point);
        self.prop(&g.end_point);
        self.opt_prop(&g.highlight_length);
        self.opt_prop(&g.highlight_angle);
        self.opt_f64(g.color_points);
        self.prop(&g.stops);
    }
    fn opt_gradient(&mut self, g: &Option<ParsedGradient>) {
        match g {
            None => self.byte(0),
            Some(x) => { self.byte(1); self.gradient(x); }
        }
    }
    fn dashes(&mut self, ds: &[ParsedDash]) {
        self.u32(ds.len() as u32);
        for d in ds {
            self.opt_str(&d.name);
            self.prop(&d.value);
        }
    }
    fn opt_dashes(&mut self, ds: &Option<Vec<ParsedDash>>) {
        match ds {
            None => self.byte(0),
            Some(x) => { self.byte(1); self.dashes(x); }
        }
    }
    fn shape(&mut self, s: &ParsedShape) {
        self.str(&s.shape_type);
        self.opt_str(&s.name);
        self.opt_str(&s.match_name);
        self.opt_f64(s.index);
        self.opt_child_shapes(&s.children);
        self.opt_prop(&s.position);
        self.opt_f64(s.star_type);
        self.opt_prop(&s.points);
        self.opt_prop(&s.anchor);
        self.opt_prop(&s.scale);
        self.opt_prop(&s.rotation);
        self.opt_prop(&s.outer_radius);
        self.opt_prop(&s.inner_radius);
        self.opt_prop(&s.outer_roundness);
        self.opt_prop(&s.inner_roundness);
        self.opt_prop(&s.size);
        self.opt_prop(&s.radius);
        self.opt_f64(s.direction);
        match &s.rd {
            None => self.byte(0),
            Some(x) => { self.byte(1); self.shape(x.as_ref()); }
        }
        self.opt_prop(&s.color);
        self.opt_gradient(&s.gradient);
        self.opt_prop(&s.opacity);
        self.opt_prop(&s.stroke_width);
        self.opt_f64(s.line_cap);
        self.opt_f64(s.line_join);
        self.opt_f64(s.miter_limit);
        match &s.fill_rule {
            None => self.byte(0),
            Some(FillRule::Winding) => { self.byte(1); self.byte(0); }
            Some(FillRule::Evenodd) => { self.byte(1); self.byte(1); }
        }
        self.opt_dashes(&s.dashes);
        self.opt_prop(&s.copies);
        self.opt_prop(&s.copies_offset);
        self.opt_f64(s.composite);
        self.opt_f64(s.merge_mode);
        self.opt_transform(&s.transform);
        self.opt_prop(&s.start);
        self.opt_prop(&s.end);
        self.opt_prop(&s.offset);
        match &s.trim_mode {
            None => self.byte(0),
            Some(TrimMode::Simultaneously) => { self.byte(1); self.byte(0); }
            Some(TrimMode::Individually) => { self.byte(1); self.byte(1); }
        }
        self.opt_prop(&s.vertices);
    }
    fn opt_child_shapes(&mut self, xs: &Option<Vec<ParsedShape>>) {
        match xs {
            None => self.byte(0),
            Some(list) => {
                self.byte(1);
                self.u32(list.len() as u32);
                for x in list { self.shape(x); }
            }
        }
    }
    fn text_keyframe(&mut self, k: &ParsedTextKeyframe) {
        self.f64(k.at);
        self.str(&k.text);
        self.opt_f64(k.font_size);
        self.opt_str(&k.font_family);
        self.opt_many_f64(&k.fill_color);
        self.opt_f64(k.justify);
        self.opt_f64(k.line_height);
        self.opt_f64(k.tracking);
        self.opt_many_f64(&k.stroke_color);
        self.opt_f64(k.stroke_width);
    }
    fn text(&mut self, t: &ParsedText) {
        self.str(&t.text);
        self.opt_f64(t.font_size);
        self.opt_str(&t.font_family);
        self.opt_many_f64(&t.fill_color);
        self.opt_f64(t.justify);
        self.opt_f64(t.line_height);
        self.opt_f64(t.tracking);
        self.opt_many_f64(&t.stroke_color);
        self.opt_f64(t.stroke_width);
        match &t.keyframes {
            None => self.byte(0),
            Some(list) => {
                self.byte(1);
                self.u32(list.len() as u32);
                for k in list { self.text_keyframe(k); }
            }
        }
    }
    fn opt_text(&mut self, t: &Option<ParsedText>) {
        match t {
            None => self.byte(0),
            Some(x) => { self.byte(1); self.text(x); }
        }
    }
    fn mask(&mut self, m: &ParsedMask) {
        self.opt_str(&m.name);
        self.byte(if m.inverted { 1 } else { 0 });
        self.byte(m.mode as u8);
        self.prop(&m.path);
        self.prop(&m.opacity);
        self.prop(&m.expand);
    }
    fn opt_masks(&mut self, ms: &Option<Vec<ParsedMask>>) {
        match ms {
            None => self.byte(0),
            Some(list) => {
                self.byte(1);
                self.u32(list.len() as u32);
                for m in list { self.mask(m); }
            }
        }
    }
    fn shapes(&mut self, list: &[ParsedShape]) {
        self.u32(list.len() as u32);
        for s in list { self.shape(s); }
    }
    fn opt_shapes(&mut self, list: &Option<Vec<ParsedShape>>) {
        match list {
            None => self.byte(0),
            Some(x) => { self.byte(1); self.shapes(x); }
        }
    }
    fn layer(&mut self, l: &ParsedLayer) {
        self.f64(l.index);
        self.byte(l.layer_type as u8);
        self.transform(&l.transform);
        self.opt_str(&l.name);
        self.opt_f64(l.parent_index);
        self.opt_str(&l.ref_id);
        self.opt_f64(l.in_frame);
        self.opt_f64(l.out_frame);
        self.opt_f64(l.start_time);
        self.opt_f64(l.stretch);
        self.opt_f64(l.auto_orient);
        self.opt_bool(l.is3d);
        self.opt_f64(l.blend_mode);
        self.opt_str(&l.solid_color);
        self.opt_f64(l.solid_width);
        self.opt_f64(l.solid_height);
        self.opt_f64(l.layer_width);
        self.opt_f64(l.layer_height);
        self.opt_matte(&l.matte_type);
        self.opt_bool(l.matte_target);
        self.opt_prop(&l.time_remap);
        self.opt_masks(&l.masks);
        self.opt_text(&l.text);
        self.opt_shapes(&l.shapes);
        self.opt_bool(l.hidden);
    }
    fn opt_matte(&mut self, m: &Option<MatteType>) {
        match m {
            None => self.byte(0),
            Some(x) => { self.byte(1); self.byte(*x as u8); }
        }
    }
    fn layers(&mut self, list: &[ParsedLayer]) {
        self.u32(list.len() as u32);
        for l in list { self.layer(l); }
    }
    fn asset(&mut self, a: &ParsedAsset) {
        self.opt_str(&a.id);
        self.opt_f64(a.width);
        self.opt_f64(a.height);
        self.opt_str(&a.u);
        self.opt_str(&a.p);
        match &a.layers {
            None => self.byte(0),
            Some(list) => { self.byte(1); self.layers(list); }
        }
    }
}

pub fn encode_animation(a: &ParsedAnimation) -> Vec<u8> {
    let mut w = W { v: Vec::with_capacity(4096) };
    w.str("TGSB");
    w.byte(1);
    w.byte(0);
    w.f64(a.width);
    w.f64(a.height);
    w.f64(a.fps);
    w.f64(a.in_frame);
    w.f64(a.out_frame);
    w.f64(a.duration);
    w.layers(&a.layers);
    match &a.assets {
        list => {
            w.u32(list.len() as u32);
            for x in list { w.asset(x); }
        }
    }
    w.opt_str(&a.name);
    w.opt_str(&a.version);
    w.byte(if a.tgs { 1 } else { 0 });
    w.byte(if a.is3d { 1 } else { 0 });
    match &a.markers {
        None => w.byte(0),
        Some(list) => {
            w.byte(1);
            w.u32(list.len() as u32);
            for m in list {
                w.opt_str(&m.name);
                w.f64(m.start_frame);
                w.f64(m.end_frame);
            }
        }
    }
    w.v
}
