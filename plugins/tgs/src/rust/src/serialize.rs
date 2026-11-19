use crate::json::{write_string, write_value};
use crate::types::*;

type Res = Result<(), ()>;


struct Fw {
    first: bool,
}

impl Fw {
    fn new() -> Fw {
        Fw { first: true }
    }
    fn sep(&mut self, out: &mut String) {
        if self.first {
            self.first = false;
        } else {
            out.push(',');
        }
    }
    fn f64(&mut self, out: &mut String, key: &str, v: Option<f64>) -> Res {
        let Some(v) = v else { return Ok(()) };
        self.sep(out);
        write_string(out, key);
        out.push(':');
        self.wr_f64(out, v)
    }
    fn wr_f64(&self, out: &mut String, v: f64) -> Res {
        if !v.is_finite() {
            return Err(());
        }
        out.push_str(&v.to_string());
        Ok(())
    }
    fn f64_arr(&mut self, out: &mut String, key: &str, vs: &Option<Vec<f64>>) -> Res {
        let Some(vs) = vs else { return Ok(()) };
        self.sep(out);
        write_string(out, key);
        out.push(':');
        out.push('[');
        for (i, v) in vs.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            self.wr_f64(out, *v)?;
        }
        out.push(']');
        Ok(())
    }
    fn raw(&mut self, out: &mut String, key: &str, lit: &str) {
        self.sep(out);
        write_string(out, key);
        out.push(':');
        out.push_str(lit);
    }
    fn str(&mut self, out: &mut String, key: &str, v: Option<&str>) {
        let Some(s) = v else { return };
        self.sep(out);
        write_string(out, key);
        out.push(':');
        write_string(out, s);
    }
    fn json(&mut self, out: &mut String, key: &str, v: &crate::json::Value) {
        self.sep(out);
        write_string(out, key);
        out.push(':');
        write_value(out, v);
    }
    fn prop(&mut self, out: &mut String, key: &str, p: &ParsedProperty) -> Res {
        self.sep(out);
        write_string(out, key);
        out.push(':');
        write_prop(out, p)
    }
    fn opt_prop(&mut self, out: &mut String, key: &str, p: &Option<ParsedProperty>) -> Res {
        let Some(p) = p else { return Ok(()) };
        self.prop(out, key, p)
    }
    fn opt_prop_box(&mut self, out: &mut String, key: &str, p: &Option<Box<ParsedProperty>>) -> Res {
        let Some(p) = p else { return Ok(()) };
        self.prop(out, key, p.as_ref())
    }
}

fn write_prop(out: &mut String, p: &ParsedProperty) -> Res {
    let mut w = Fw::new();
    out.push('{');
    w.raw(out, "animated", if p.animated { "true" } else { "false" });
    if !p.value.is_null() {
        w.json(out, "value", &p.value);
    }
    if let Some(kf) = &p.keyframes {
        w.sep(out);
        out.push_str("\"keyframes\":[");
        for (i, _k) in kf.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            write_keyframe(out, kf, i)?;
        }
        out.push(']');
    }
    w.opt_prop_box(out, "x", &p.x)?;
    w.opt_prop_box(out, "y", &p.y)?;
    out.push('}');
    Ok(())
}

fn write_keyframe(out: &mut String, kfs: &[ParsedKeyframe], i: usize) -> Res {
    let k = &kfs[i];
    let mut w = Fw::new();
    out.push('{');
    w.sep(out);
    out.push_str("\"t\":");
    w.wr_f64(out, k.t)?;
    w.json(out, "s", &k.s);
    w.f64(out, "endFrame", k.end_frame)?;
    w.raw(out, "hold", if k.hold { "true" } else { "false" });
    if let Some(bg) = &k.easing {
        w.sep(out);
        out.push_str("\"easing\":{\"x1\":");
        w.wr_f64(out, bg.x1)?;
        out.push_str(",\"y1\":");
        w.wr_f64(out, bg.y1)?;
        out.push_str(",\"x2\":");
        w.wr_f64(out, bg.x2)?;
        out.push_str(",\"y2\":");
        w.wr_f64(out, bg.y2)?;
        out.push('}');
    }
    if let Some(e) = crate::keyframes::keyframe_end(kfs, i) {
        w.json(out, "e", e);
    }
    w.f64_arr(out, "to", &k.to)?;
    w.f64_arr(out, "ti", &k.ti)?;
    if let Some(h) = &k.h {
        w.json(out, "h", h);
    }
    if let Some(n) = &k.n {
        w.json(out, "n", n);
    }
    out.push('}');
    Ok(())
}

fn write_transform(out: &mut String, tr: &ParsedTransform) -> Res {
    let mut w = Fw::new();
    out.push('{');
    w.opt_prop(out, "opacity", &tr.opacity)?;
    w.opt_prop(out, "rotation", &tr.rotation)?;
    w.opt_prop(out, "position", &tr.position)?;
    w.opt_prop(out, "anchor", &tr.anchor)?;
    w.opt_prop(out, "scale", &tr.scale)?;
    w.opt_prop(out, "skew", &tr.skew)?;
    w.opt_prop(out, "skewAxis", &tr.skew_axis)?;
    w.opt_prop(out, "startOpacity", &tr.start_opacity)?;
    w.opt_prop(out, "endOpacity", &tr.end_opacity)?;
    out.push('}');
    Ok(())
}

fn write_gradient(out: &mut String, g: &ParsedGradient) -> Res {
    let mut w = Fw::new();
    out.push('{');
    w.raw(out, "type", &(g.gradient_type as u8).to_string());
    w.prop(out, "startPoint", &g.start_point)?;
    w.prop(out, "endPoint", &g.end_point)?;
    w.opt_prop(out, "highlightLength", &g.highlight_length)?;
    w.opt_prop(out, "highlightAngle", &g.highlight_angle)?;
    w.f64(out, "colorPoints", g.color_points)?;
    w.prop(out, "stops", &g.stops)?;
    out.push('}');
    Ok(())
}

fn write_dash(out: &mut String, d: &ParsedDash) -> Res {
    let mut w = Fw::new();
    out.push('{');
    w.str(out, "name", d.name.as_deref());
    w.prop(out, "value", &d.value)?;
    out.push('}');
    Ok(())
}

fn write_text_keyframe(out: &mut String, k: &ParsedTextKeyframe) -> Res {
    let mut w = Fw::new();
    out.push('{');
    w.sep(out);
    out.push_str("\"at\":");
    w.wr_f64(out, k.at)?;
    w.str(out, "text", Some(k.text.as_str()));
    w.f64(out, "fontSize", k.font_size)?;
    w.str(out, "fontFamily", k.font_family.as_deref());
    w.f64_arr(out, "fillColor", &k.fill_color)?;
    w.f64(out, "justify", k.justify)?;
    w.f64(out, "lineHeight", k.line_height)?;
    w.f64(out, "tracking", k.tracking)?;
    w.f64_arr(out, "strokeColor", &k.stroke_color)?;
    w.f64(out, "strokeWidth", k.stroke_width)?;
    out.push('}');
    Ok(())
}

fn write_text(out: &mut String, t: &ParsedText) -> Res {
    let mut w = Fw::new();
    out.push('{');
    w.str(out, "text", Some(t.text.as_str()));
    w.f64(out, "fontSize", t.font_size)?;
    w.str(out, "fontFamily", t.font_family.as_deref());
    w.f64_arr(out, "fillColor", &t.fill_color)?;
    w.f64(out, "justify", t.justify)?;
    w.f64(out, "lineHeight", t.line_height)?;
    w.f64(out, "tracking", t.tracking)?;
    w.f64_arr(out, "strokeColor", &t.stroke_color)?;
    w.f64(out, "strokeWidth", t.stroke_width)?;
    if let Some(kf) = &t.keyframes {
        w.sep(out);
        out.push_str("\"keyframes\":[");
        for (i, k) in kf.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            write_text_keyframe(out, k)?;
        }
        out.push(']');
    }
    out.push('}');
    Ok(())
}

fn write_mask(out: &mut String, m: &ParsedMask) -> Res {
    let mut w = Fw::new();
    out.push('{');
    w.str(out, "name", m.name.as_deref());
    w.raw(out, "inverted", if m.inverted { "true" } else { "false" });
    w.raw(out, "mode", &(m.mode as u8).to_string());
    w.prop(out, "path", &m.path)?;
    w.prop(out, "opacity", &m.opacity)?;
    w.prop(out, "expand", &m.expand)?;
    out.push('}');
    Ok(())
}

fn fill_rule_str(r: FillRule) -> &'static str {
    match r {
        FillRule::Winding => "\"winding\"",
        FillRule::Evenodd => "\"evenodd\"",
    }
}

fn trim_mode_str(m: TrimMode) -> &'static str {
    match m {
        TrimMode::Simultaneously => "\"simultaneously\"",
        TrimMode::Individually => "\"individually\"",
    }
}

fn write_shape(out: &mut String, s: &ParsedShape) -> Res {
    let mut w = Fw::new();
    out.push('{');
    w.sep(out);
    out.push_str("\"type\":");
    write_string(out, &s.shape_type);
    w.str(out, "name", s.name.as_deref());
    w.str(out, "matchName", s.match_name.as_deref());
    w.f64(out, "index", s.index)?;
    if let Some(ch) = &s.children {
        w.sep(out);
        out.push_str("\"children\":[");
        for (i, c) in ch.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            write_shape(out, c)?;
        }
        out.push(']');
    }
    w.opt_prop(out, "position", &s.position)?;
    w.f64(out, "starType", s.star_type)?;
    w.opt_prop(out, "points", &s.points)?;
    w.opt_prop(out, "anchor", &s.anchor)?;
    w.opt_prop(out, "scale", &s.scale)?;
    w.opt_prop(out, "rotation", &s.rotation)?;
    w.opt_prop(out, "outerRadius", &s.outer_radius)?;
    w.opt_prop(out, "innerRadius", &s.inner_radius)?;
    w.opt_prop(out, "outerRoundness", &s.outer_roundness)?;
    w.opt_prop(out, "innerRoundness", &s.inner_roundness)?;
    w.opt_prop(out, "size", &s.size)?;
    w.opt_prop(out, "radius", &s.radius)?;
    w.f64(out, "direction", s.direction)?;
    if let Some(rd) = &s.rd {
        w.sep(out);
        out.push_str("\"rd\":");
        write_shape(out, rd)?;
    }
    w.opt_prop(out, "color", &s.color)?;
    if let Some(g) = &s.gradient {
        w.sep(out);
        out.push_str("\"gradient\":");
        write_gradient(out, g)?;
    }
    w.opt_prop(out, "opacity", &s.opacity)?;
    w.opt_prop(out, "strokeWidth", &s.stroke_width)?;
    w.f64(out, "lineCap", s.line_cap)?;
    w.f64(out, "lineJoin", s.line_join)?;
    w.f64(out, "miterLimit", s.miter_limit)?;
    if let Some(fr) = s.fill_rule {
        w.raw(out, "fillRule", fill_rule_str(fr));
    }
    if let Some(dashes) = &s.dashes {
        w.sep(out);
        out.push_str("\"dashes\":[");
        for (i, d) in dashes.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            write_dash(out, d)?;
        }
        out.push(']');
    }
    w.opt_prop(out, "copies", &s.copies)?;
    w.opt_prop(out, "copiesOffset", &s.copies_offset)?;
    w.f64(out, "composite", s.composite)?;
    w.f64(out, "mergeMode", s.merge_mode)?;
    if let Some(tr) = &s.transform {
        w.sep(out);
        out.push_str("\"transform\":");
        write_transform(out, tr)?;
    }
    w.opt_prop(out, "start", &s.start)?;
    w.opt_prop(out, "end", &s.end)?;
    w.opt_prop(out, "offset", &s.offset)?;
    if let Some(tm) = s.trim_mode {
        w.raw(out, "trimMode", trim_mode_str(tm));
    }
    w.opt_prop(out, "vertices", &s.vertices)?;
    out.push('}');
    Ok(())
}

fn write_layer(out: &mut String, l: &ParsedLayer) -> Res {
    let mut w = Fw::new();
    out.push('{');
    w.f64(out, "index", l.index)?;
    w.raw(out, "type", &(l.layer_type as u8).to_string());
    w.sep(out);
    out.push_str("\"transform\":");
    write_transform(out, &l.transform)?;
    w.str(out, "name", l.name.as_deref());
    w.f64(out, "parentIndex", l.parent_index)?;
    w.str(out, "refId", l.ref_id.as_deref());
    w.f64(out, "inFrame", l.in_frame)?;
    w.f64(out, "outFrame", l.out_frame)?;
    w.f64(out, "startTime", l.start_time)?;
    w.f64(out, "stretch", l.stretch)?;
    w.f64(out, "autoOrient", l.auto_orient)?;
    if let Some(v) = l.is3d {
        w.raw(out, "is3d", if v { "true" } else { "false" });
    }
    w.f64(out, "blendMode", l.blend_mode)?;
    w.str(out, "solidColor", l.solid_color.as_deref());
    w.f64(out, "solidWidth", l.solid_width)?;
    w.f64(out, "solidHeight", l.solid_height)?;
    w.f64(out, "layerWidth", l.layer_width)?;
    w.f64(out, "layerHeight", l.layer_height)?;
    if let Some(mt) = l.matte_type {
        w.raw(out, "matteType", &(mt as u8).to_string());
    }
    if let Some(v) = l.matte_target {
        w.raw(out, "matteTarget", if v { "true" } else { "false" });
    }
    w.opt_prop(out, "timeRemap", &l.time_remap)?;
    if let Some(mks) = &l.masks {
        w.sep(out);
        out.push_str("\"masks\":[");
        for (i, m) in mks.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            write_mask(out, m)?;
        }
        out.push(']');
    }
    if let Some(t) = &l.text {
        w.sep(out);
        out.push_str("\"text\":");
        write_text(out, t)?;
    }
    if let Some(shs) = &l.shapes {
        w.sep(out);
        out.push_str("\"shapes\":[");
        for (i, s) in shs.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            write_shape(out, s)?;
        }
        out.push(']');
    }
    if let Some(v) = l.hidden {
        w.raw(out, "hidden", if v { "true" } else { "false" });
    }
    out.push('}');
    Ok(())
}

fn write_asset(out: &mut String, x: &ParsedAsset) -> Res {
    let mut w = Fw::new();
    out.push('{');
    w.str(out, "id", x.id.as_deref());
    w.f64(out, "w", x.width)?;
    w.f64(out, "h", x.height)?;
    w.str(out, "u", x.u.as_deref());
    w.str(out, "p", x.p.as_deref());
    if let Some(ls) = &x.layers {
        w.sep(out);
        out.push_str("\"layers\":[");
        for (i, l) in ls.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            write_layer(out, l)?;
        }
        out.push(']');
    }
    out.push('}');
    Ok(())
}

fn write_marker(out: &mut String, m: &ParsedMarker) -> Res {
    let mut w = Fw::new();
    out.push('{');
    w.str(out, "name", m.name.as_deref());
    w.sep(out);
    out.push_str("\"startFrame\":");
    w.wr_f64(out, m.start_frame)?;
    out.push_str(",\"endFrame\":");
    w.wr_f64(out, m.end_frame)?;
    out.push('}');
    Ok(())
}

fn write_animation(out: &mut String, a: &ParsedAnimation) -> Res {
    let mut w = Fw::new();
    out.push('{');
    w.sep(out);
    out.push_str("\"width\":");
    w.wr_f64(out, a.width)?;
    out.push_str(",\"height\":");
    w.wr_f64(out, a.height)?;
    out.push_str(",\"fps\":");
    w.wr_f64(out, a.fps)?;
    out.push_str(",\"inFrame\":");
    w.wr_f64(out, a.in_frame)?;
    out.push_str(",\"outFrame\":");
    w.wr_f64(out, a.out_frame)?;
    out.push_str(",\"duration\":");
    w.wr_f64(out, a.duration)?;
    out.push_str(",\"layers\":[");
    for (i, l) in a.layers.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        write_layer(out, l)?;
    }
    out.push_str("],\"assets\":[");
    for (i, x) in a.assets.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        write_asset(out, x)?;
    }
    out.push(']');
    w.str(out, "name", a.name.as_deref());
    w.str(out, "version", a.version.as_deref());
    w.raw(out, "tgs", if a.tgs { "true" } else { "false" });
    w.raw(out, "is3d", if a.is3d { "true" } else { "false" });
    if let Some(mk) = &a.markers {
        w.sep(out);
        out.push_str("\"markers\":[");
        for (i, m) in mk.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            write_marker(out, m)?;
        }
        out.push(']');
    }
    out.push('}');
    Ok(())
}

pub fn serialize_animation(a: &ParsedAnimation) -> Result<String, ()> {
    let mut out = String::new();
    write_animation(&mut out, a)?;
    Ok(out)
}
