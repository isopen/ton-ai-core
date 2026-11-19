use crate::cov_cache::Hasher128;
use crate::json::Value as JsonValue;
use crate::types::{ParsedAnimation, ParsedLayer, ParsedProperty, ParsedShape, ParsedTransform};

const MAX_DEPTH: usize = 32;

fn hash_json(h: &mut Hasher128, v: &JsonValue) {
    match v {
        JsonValue::Null => h.mix(0),
        JsonValue::Bool(b) => {
            h.mix(1);
            h.mix(u32::from(*b));
        }
        JsonValue::Number(n) => {
            h.mix(2);
            h.mix_f64(*n);
        }
        JsonValue::String(s) => {
            h.mix(3);
            for b in s.as_bytes() {
                h.mix(u32::from(*b));
            }
            h.mix(0xffff_ffff);
        }
        JsonValue::Nums(ns) => {
            h.mix(4);
            h.mix(ns.len() as u32);
            for n in ns.iter() {
                h.mix_f64(n);
            }
        }
        JsonValue::Array(a) => {
            h.mix(5);
            h.mix(a.len() as u32);
            for x in a.iter() {
                hash_json(h, x);
            }
        }
        JsonValue::Object(m) => {
            h.mix(6);
            h.mix(m.len() as u32);
            for (k, val) in m {
                for b in k.as_bytes() {
                    h.mix(u32::from(*b));
                }
                h.mix(0xffff_fffe);
                hash_json(h, val);
            }
        }
    }
}

#[inline]
fn prop_variable(p: &ParsedProperty) -> bool {
    p.animated || p.keyframes.is_some() || p.override_value.is_some() || p.x.is_some() || p.y.is_some()
}

#[derive(Clone, Copy)]
struct FrameMap {
    start: f64,
    stretch: Option<f64>,
}

#[derive(Clone, Copy)]
struct SigProp {
    ptr: *const ParsedProperty,
    off: u32,
    len: u16,
}

#[derive(Clone, Copy)]
struct VisEntry {
    ip: f64,
    op: f64,
    off: u32,
    len: u16,
}

pub struct SigPlan {
    props: Vec<SigProp>,
    vis: Vec<VisEntry>,
    maps: Vec<FrameMap>,
    overflow: bool,
}

impl SigPlan {
    pub fn build(anim: &ParsedAnimation, max_props: usize) -> Option<SigPlan> {
        let mut plan = SigPlan {
            props: Vec::new(),
            vis: Vec::new(),
            maps: Vec::new(),
            overflow: false,
        };
        let mut stack = Vec::new();
        plan.collect_layers(anim, &anim.layers, max_props, 0, &mut stack);
        if plan.overflow {
            None
        } else {
            Some(plan)
        }
    }

    fn add_prop(&mut self, p: &ParsedProperty, stack: &[FrameMap], max_props: usize) {
        if !prop_variable(p) {
            return;
        }
        if self.props.len() >= max_props {
            self.overflow = true;
            return;
        }
        let off = self.maps.len() as u32;
        self.maps.extend_from_slice(stack);
        self.props.push(SigProp { ptr: p as *const ParsedProperty, off, len: stack.len() as u16 });
    }

    fn add_opt(&mut self, p: Option<&ParsedProperty>, stack: &[FrameMap], max_props: usize) {
        if let Some(p) = p {
            self.add_prop(p, stack, max_props);
        }
    }

    fn add_transform(&mut self, tr: &ParsedTransform, stack: &[FrameMap], max_props: usize) {
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
            self.add_opt(p.as_ref(), stack, max_props);
        }
    }

    fn add_shape(&mut self, shape: &ParsedShape, stack: &[FrameMap], max_props: usize) {
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
            self.add_opt(p.as_ref(), stack, max_props);
        }
        if let Some(rd) = shape.rd.as_deref() {
            self.add_shape(rd, stack, max_props);
        }
        if let Some(g) = shape.gradient.as_ref() {
            self.add_prop(&g.stops, stack, max_props);
            self.add_prop(&g.start_point, stack, max_props);
            self.add_prop(&g.end_point, stack, max_props);
            self.add_opt(g.highlight_length.as_ref(), stack, max_props);
            self.add_opt(g.highlight_angle.as_ref(), stack, max_props);
        }
        if let Some(dashes) = shape.dashes.as_ref() {
            for d in dashes.iter() {
                self.add_prop(&d.value, stack, max_props);
            }
        }
        if let Some(tr) = shape.transform.as_ref() {
            self.add_transform(tr, stack, max_props);
        }
        if let Some(children) = shape.children.as_ref() {
            for c in children.iter() {
                self.add_shape(c, stack, max_props);
            }
        }
    }

    fn collect_layer(&mut self, layer: &ParsedLayer, stack: &[FrameMap], max_props: usize) {
        let off = self.maps.len() as u32;
        self.maps.extend_from_slice(stack);
        self.vis.push(VisEntry {
            ip: layer.in_frame.unwrap_or(f64::NEG_INFINITY),
            op: layer.out_frame.unwrap_or(f64::INFINITY),
            off,
            len: stack.len() as u16,
        });
        self.add_transform(&layer.transform, stack, max_props);
        if let Some(tm) = layer.time_remap.as_ref() {
            self.add_prop(tm, stack, max_props);
        }
        if let Some(masks) = layer.masks.as_ref() {
            for m in masks.iter() {
                self.add_prop(&m.path, stack, max_props);
                self.add_prop(&m.opacity, stack, max_props);
                self.add_prop(&m.expand, stack, max_props);
            }
        }
        if let Some(shapes) = layer.shapes.as_ref() {
            for s in shapes.iter() {
                self.add_shape(s, stack, max_props);
            }
        }
    }

    fn collect_layers(
        &mut self,
        anim: &ParsedAnimation,
        layers: &[ParsedLayer],
        max_props: usize,
        depth: usize,
        stack: &mut Vec<FrameMap>,
    ) {
        if depth > MAX_DEPTH || self.overflow {
            return;
        }
        for layer in layers.iter() {
            self.collect_layer(layer, stack, max_props);
            let Some(ref_id) = layer.ref_id.as_deref() else {
                continue;
            };
            let Some(asset) = anim.assets.iter().find(|a| a.id.as_deref() == Some(ref_id)) else {
                continue;
            };
            let Some(children) = asset.layers.as_deref() else {
                continue;
            };
            stack.push(FrameMap {
                start: layer.start_time.unwrap_or(0.0),
                stretch: layer.stretch,
            });
            self.collect_layers(anim, children, max_props, depth + 1, stack);
            stack.pop();
            if self.overflow {
                return;
            }
        }
    }

    #[inline]
    fn map_frame(&self, frame: f64, off: u32, len: u16) -> f64 {
        let mut f = frame;
        let start = off as usize;
        for m in self.maps[start..start + len as usize].iter() {
            f -= m.start;
            if let Some(stretch) = m.stretch {
                f = (f / stretch).trunc();
            }
        }
        f
    }

    pub fn signature(&self, frame: f64) -> u128 {
        let _g = crate::prof::aprobe::enter(crate::prof::aprobe::RESERVE);
        let mut h = Hasher128::new();
        for p in self.props.iter() {
            let f = self.map_frame(frame, p.off, p.len);
            let prop = unsafe { &*p.ptr };
            let v = crate::keyframes::interpolate_keyframes_cow(prop, f);
            hash_json(&mut h, v.as_ref());
        }
        for v in self.vis.iter() {
            let f = self.map_frame(frame, v.off, v.len);
            h.mix(if f >= v.ip && f <= v.op { 0x1001 } else { 0x1000 });
        }
        h.finish()
    }
}
