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

pub fn has_animated_properties(anim: &ParsedAnimation) -> bool {
    for layer in &anim.layers {
        if layer_animated(layer) {
            return true;
        }
    }
    for asset in &anim.assets {
        if let Some(layers) = &asset.layers {
            for layer in layers {
                if layer_animated(layer) {
                    return true;
                }
            }
        }
    }
    has_timed_layers(anim)
}

fn has_timed_layers(anim: &ParsedAnimation) -> bool {
    if anim.layers.len() > 1 {
        for layer in &anim.layers {
            if let Some(in_frame) = layer.in_frame {
                if in_frame > anim.in_frame {
                    return true;
                }
                if let Some(out_frame) = layer.out_frame {
                    if out_frame < anim.out_frame {
                        return true;
                    }
                }
            }
        }
    }
    for asset in &anim.assets {
        if let Some(ls) = &asset.layers {
            if ls.len() <= 1 {
                continue;
            }
            let s0 = ls[0].in_frame;
            let e0 = ls[0].out_frame;
            for layer in ls {
                if layer.in_frame != s0 || layer.out_frame != e0 {
                    return true;
                }
            }
        }
    }
    false
}
