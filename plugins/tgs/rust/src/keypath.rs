use crate::jsutil::js_num_value;
pub use crate::types::PropertyValue;
use crate::types::{ParsedAnimation, ParsedLayer, ParsedProperty, ParsedShape, ParsedTransform};
use serde_json::Value as JsonValue;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Property {
    FillColor,
    FillOpacity,
    StrokeColor,
    StrokeOpacity,
    StrokeWidth,
    TrAnchor,
    TrPosition,
    TrScale,
    TrRotation,
    TrOpacity,
    TrimStart,
    TrimEnd,
}

#[derive(Debug, Clone)]
pub struct FrameInfo {
    pub cur_frame: f64,
}

pub fn match_key_path(pattern: &str, path: &[String]) -> bool {
    let p: Vec<&str> = pattern.split('.').filter(|s| !s.is_empty()).collect();
    let mut pi = 0usize;
    let mut si = 0usize;
    let mut star_si: isize = -1;
    let mut star_pi: isize = -1;

    while si < path.len() {
        if pi < p.len() && p[pi] == "**" {
            star_pi = pi as isize;
            pi += 1;
            star_si = si as isize;
            continue;
        }
        if pi < p.len() && (p[pi] == "*" || p[pi] == path[si]) {
            pi += 1;
            si += 1;
            continue;
        }
        if star_pi != -1 {
            pi = (star_pi + 1) as usize;
            star_si += 1;
            si = star_si as usize;
            continue;
        }
        return false;
    }
    while pi < p.len() && p[pi] == "**" {
        pi += 1;
    }
    pi == p.len()
}

fn shape_name(shape: &ParsedShape) -> String {
    shape
        .name
        .clone()
        .or_else(|| shape.match_name.clone())
        .unwrap_or_default()
}

fn layer_path(layer: &ParsedLayer) -> Vec<String> {
    let mut segments: Vec<String> = Vec::new();
    match &layer.name {
        Some(name) if !name.is_empty() => segments.push(name.clone()),
        _ => segments.push(format!("Layer {}", layer.index)),
    }
    segments
}

fn apply_override(prop: &mut ParsedProperty, value: &PropertyValue) {
    prop.override_value = Some(value.clone());
}

fn apply_to_shape_property(
    shape: &mut ParsedShape,
    prop_type: Property,
    value: &PropertyValue,
) -> bool {
    let target: Option<&mut ParsedProperty> = match prop_type {
        Property::FillColor => shape.color.as_mut(),
        Property::FillOpacity => shape.opacity.as_mut(),
        Property::StrokeColor => shape.color.as_mut(),
        Property::StrokeOpacity => shape.opacity.as_mut(),
        Property::StrokeWidth => shape.stroke_width.as_mut(),
        Property::TrimStart => shape.start.as_mut(),
        Property::TrimEnd => shape.end.as_mut(),
        Property::TrAnchor => shape.anchor.as_mut(),
        Property::TrPosition => shape.position.as_mut(),
        Property::TrScale => shape.scale.as_mut(),
        Property::TrRotation => shape.rotation.as_mut(),
        Property::TrOpacity => shape.opacity.as_mut(),
    };
    match target {
        Some(p) => {
            apply_override(p, value);
            true
        }
        None => false,
    }
}

fn apply_kind(shape: &mut ParsedShape, prop_type: Property, value: &PropertyValue) -> bool {
    match shape.shape_type.as_str() {
        "fill" => match prop_type {
            Property::FillColor | Property::FillOpacity => apply_to_shape_property(shape, prop_type, value),
            _ => false,
        },
        "stroke" => match prop_type {
            Property::StrokeColor | Property::StrokeOpacity | Property::StrokeWidth => {
                apply_to_shape_property(shape, prop_type, value)
            }
            _ => false,
        },
        "trim" => match prop_type {
            Property::TrimStart | Property::TrimEnd => apply_to_shape_property(shape, prop_type, value),
            _ => false,
        },
        "transform" => match prop_type {
            Property::TrAnchor
            | Property::TrPosition
            | Property::TrScale
            | Property::TrRotation
            | Property::TrOpacity => apply_to_shape_property(shape, prop_type, value),
            _ => false,
        },
        _ => false,
    }
}

fn walk_shapes(
    shapes: &mut [ParsedShape],
    path: &[String],
    keypath: &str,
    prop_type: Property,
    value: &PropertyValue,
) -> bool {
    let mut matched = false;
    let count = shapes.len();
    for idx in 0..count {
        let shape = &mut shapes[idx];
        let name = shape_name(shape);
        let mut full: Vec<String> = path.to_vec();
        if !name.is_empty() {
            full.push(name);
        }
        let transform_child_index = shape
            .children
            .as_ref()
            .and_then(|children| {
                children
                    .iter()
                    .position(|child| child.shape_type == "transform")
            });
        if let Some(ti) = transform_child_index {
            let mut with_transform: Vec<String> = full.clone();
            with_transform.push("Transform".to_string());
            if match_key_path(keypath, &with_transform) {
                let child = shape
                    .children
                    .as_mut()
                    .unwrap()
                    .get_mut(ti)
                    .unwrap();
                if apply_to_shape_property(child, prop_type, value) {
                    matched = true;
                }
            }
        }
        if match_key_path(keypath, &full) {
            if apply_kind(shape, prop_type, value) {
                matched = true;
            }
        }
        if let Some(children) = shape.children.take() {
            let mut cloned = children;
            let sub = walk_shapes(&mut cloned, &full, keypath, prop_type, value);
            shape.children = Some(cloned);
            if sub {
                matched = true;
            }
        }
    }
    matched
}

pub fn set_value(
    animation: &mut ParsedAnimation,
    keypath: &str,
    prop_type: Property,
    value: PropertyValue,
) -> Result<(), crate::TgsError> {
    let mut matched = false;
    for layer in animation.layers.iter_mut() {
        let base = layer_path(layer);
        let mut with_transform = base.clone();
        with_transform.push("Transform".to_string());
        if match_key_path(keypath, &with_transform) {
            if apply_to_transform(&mut layer.transform, prop_type, &value) {
                matched = true;
            }
        }
        if let Some(shapes) = layer.shapes.as_mut() {
            if walk_shapes(shapes, &base, keypath, prop_type, &value) {
                matched = true;
            }
        }
    }
    if !matched {
        return Err(crate::TgsError(format!(
            "setValue: no property matched keypath \"{}\"",
            keypath
        )));
    }
    Ok(())
}

fn apply_to_transform(tr: &mut ParsedTransform, prop_type: Property, value: &PropertyValue) -> bool {
    let target: Option<&mut ParsedProperty> = match prop_type {
        Property::TrAnchor => tr.anchor.as_mut(),
        Property::TrPosition => tr.position.as_mut(),
        Property::TrScale => tr.scale.as_mut(),
        Property::TrRotation => tr.rotation.as_mut(),
        Property::TrOpacity => tr.opacity.as_mut(),
        _ => None,
    };
    match target {
        Some(p) => {
            apply_override(p, value);
            true
        }
        None => false,
    }
}

pub fn get_override(property: &ParsedProperty, frame: f64) -> Option<JsonValue> {
    let _ = frame;
    property.override_value.as_ref().map(|value| match value {
        PropertyValue::Number(n) => js_num_value(*n),
        PropertyValue::Numbers(list) => {
            JsonValue::Array(list.iter().map(|x| js_num_value(*x)).collect())
        }
    })
}
