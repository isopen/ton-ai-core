use crate::types::{ParsedAnimation, ParsedLayer, ParsedProperty, ParsedShape, ParsedTransform};

fn prop_animated(p: &ParsedProperty) -> bool {
    if p.animated {
        return true;
    }
    if let Some(x) = &p.x {
        if prop_animated(x) {
            return true;
        }
    }
    if let Some(y) = &p.y {
        if prop_animated(y) {
            return true;
        }
    }
    false
}

fn transform_animated(tr: &ParsedTransform) -> bool {
    for p in [
        &tr.opacity,
        &tr.rotation,
        &tr.position,
        &tr.anchor,
        &tr.scale,
        &tr.skew,
        &tr.skew_axis,
        &tr.start_opacity,
        &tr.end_opacity,
    ] {
        if let Some(p) = p {
            if prop_animated(p) {
                return true;
            }
        }
    }
    false
}

fn shape_animated(shape: &ParsedShape) -> bool {
    for p in [
        &shape.position,
        &shape.anchor,
        &shape.scale,
        &shape.rotation,
        &shape.opacity,
        &shape.size,
        &shape.radius,
        &shape.color,
        &shape.stroke_width,
        &shape.start,
        &shape.end,
        &shape.offset,
        &shape.vertices,
        &shape.outer_radius,
        &shape.inner_radius,
        &shape.outer_roundness,
        &shape.inner_roundness,
        &shape.points,
        &shape.copies,
        &shape.copies_offset,
    ] {
        if let Some(p) = p {
            if prop_animated(p) {
                return true;
            }
        }
    }
    if let Some(rd) = &shape.rd {
        if shape_animated(rd) {
            return true;
        }
    }
    if let Some(g) = &shape.gradient {
        if prop_animated(&g.stops) || prop_animated(&g.start_point) || prop_animated(&g.end_point) {
            return true;
        }
        for p in [&g.highlight_length, &g.highlight_angle] {
            if let Some(p) = p {
                if prop_animated(p) {
                    return true;
                }
            }
        }
    }
    if let Some(dashes) = &shape.dashes {
        for d in dashes {
            if prop_animated(&d.value) {
                return true;
            }
        }
    }
    if let Some(tr) = &shape.transform {
        if transform_animated(tr) {
            return true;
        }
    }
    if let Some(children) = &shape.children {
        for c in children {
            if shape_animated(c) {
                return true;
            }
        }
    }
    false
}

fn layer_content_animated(layer: &ParsedLayer) -> bool {
    if transform_animated(&layer.transform) {
        return true;
    }
    if let Some(tm) = &layer.time_remap {
        if prop_animated(tm) {
            return true;
        }
    }
    if let Some(shapes) = &layer.shapes {
        for s in shapes {
            if shape_animated(s) {
                return true;
            }
        }
    }
    if let Some(masks) = &layer.masks {
        for m in masks {
            if prop_animated(&m.path) || prop_animated(&m.opacity) || prop_animated(&m.expand) {
                return true;
            }
        }
    }
    false
}

fn layer_animated(layer: &ParsedLayer) -> bool {
    if let Some(text) = &layer.text {
        if let Some(kfs) = &text.keyframes {
            if !kfs.is_empty() {
                return true;
            }
        }
    }
    layer_content_animated(layer)
}

fn properties_animated(anim: &ParsedAnimation) -> bool {
    for layer in &anim.layers {
        if layer_animated(layer) {
            return true;
        }
    }
    for asset in &anim.assets {
        if let Some(layers) = &asset.layers {
            for layer in layers.iter() {
                if layer_animated(layer) {
                    return true;
                }
            }
        }
    }
    false
}

pub fn has_animated_properties(anim: &ParsedAnimation) -> bool {
    properties_animated(anim) || has_timed_layers(anim)
}

const MAX_PRECOMP_DEPTH: usize = 32;

fn layer_visibility(layer: &ParsedLayer, lo: f64, hi: f64) -> (bool, bool) {
    let ip = layer.in_frame.unwrap_or(f64::NEG_INFINITY);
    let op = layer.out_frame.unwrap_or(f64::INFINITY);
    let any = hi >= ip && lo <= op;
    let all = lo >= ip && hi <= op;
    (any, all)
}

fn layers_frame_invariant(
    anim: &ParsedAnimation,
    layers: &[ParsedLayer],
    lo: f64,
    hi: f64,
    depth: usize,
) -> bool {
    if depth > MAX_PRECOMP_DEPTH {
        return false;
    }
    for layer in layers {
        let (any, all) = layer_visibility(layer, lo, hi);
        if !any {
            continue;
        }
        if !all {
            return false;
        }
        let Some(ref_id) = layer.ref_id.as_deref() else {
            continue;
        };
        let Some(asset) = anim.assets.iter().find(|a| a.id.as_deref() == Some(ref_id)) else {
            continue;
        };
        let Some(children) = asset.layers.as_deref() else {
            continue;
        };
        let start = layer.start_time.unwrap_or(0.0);
        let (clo, chi) = match layer.stretch {
            Some(stretch) => {
                if !(stretch > 0.0) {
                    return false;
                }
                (((lo - start) / stretch).trunc(), ((hi - start) / stretch).trunc())
            }
            None => (lo - start, hi - start),
        };
        if !layers_frame_invariant(anim, children, clo, chi, depth + 1) {
            return false;
        }
    }
    true
}

pub fn is_frame_invariant(anim: &ParsedAnimation) -> bool {
    if anim.layers.is_empty() || properties_animated(anim) {
        return false;
    }
    layers_frame_invariant(anim, &anim.layers, anim.in_frame, anim.out_frame, 0)
}

fn has_timed_layers(anim: &ParsedAnimation) -> bool {
    for layer in &anim.layers {
        let ip = layer.in_frame.unwrap_or(anim.in_frame);
        let op = layer.out_frame.unwrap_or(anim.out_frame);
        if ip > anim.in_frame || op < anim.out_frame {
            return true;
        }
    }
    for asset in &anim.assets {
        if let Some(ls) = &asset.layers {
            if ls.len() <= 1 {
                continue;
            }
            let s0 = ls[0].in_frame;
            let e0 = ls[0].out_frame;
            for layer in ls.iter() {
                if layer.in_frame != s0 || layer.out_frame != e0 {
                    return true;
                }
            }
        }
    }
    false
}
