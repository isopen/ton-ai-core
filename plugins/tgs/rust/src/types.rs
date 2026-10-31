use serde::{Serialize, Serializer};
use serde_json::Value as JsonValue;

macro_rules! num_serialize {
    ($t:ty) => {
        impl Serialize for $t {
            fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                serializer.serialize_u8(*self as u8)
            }
        }
    };
}

num_serialize!(LayerType);
num_serialize!(MatteType);
num_serialize!(MaskMode);
num_serialize!(GradientType);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LayerType {
    Precomp,
    Solid,
    Image,
    Null,
    Shape,
    Text,
}

impl Default for LayerType {
    fn default() -> Self {
        LayerType::Shape
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MatteType {
    None,
    Alpha,
    AlphaInv,
    Luma,
    LumaInv,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MaskMode {
    None,
    Add,
    Subtract,
    Intersect,
    Difference,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GradientType {
    #[allow(dead_code)]
    Linear = 1,
    #[allow(dead_code)]
    Radial = 2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FillRule {
    Winding,
    Evenodd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TrimMode {
    Simultaneously,
    Individually,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct CubicBezierEasing {
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct BezierEasingDef {
    pub x: Option<Vec<f64>>,
    pub y: Option<Vec<f64>>,
}

#[derive(Debug, Clone)]
pub struct FrameInfo {
    pub cur_frame: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PropertyValue {
    Number(f64),
    Numbers(Vec<f64>),
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedKeyframe {
    pub t: f64,
    pub s: JsonValue,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_frame: Option<f64>,
    pub hold: bool,
    #[serde(skip)]
    pub o: Option<BezierEasingDef>,
    #[serde(skip)]
    pub i: Option<BezierEasingDef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub easing: Option<CubicBezierEasing>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub e: Option<JsonValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<Vec<f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ti: Option<Vec<f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub h: Option<JsonValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub n: Option<JsonValue>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedProperty {
    pub animated: bool,
    #[serde(skip_serializing_if = "serde_json::Value::is_null")]
    pub value: JsonValue,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keyframes: Option<Vec<ParsedKeyframe>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<Box<ParsedProperty>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<Box<ParsedProperty>>,
    #[serde(skip)]
    pub override_value: Option<PropertyValue>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedTransform {
    pub opacity: Option<ParsedProperty>,
    pub rotation: Option<ParsedProperty>,
    pub position: Option<ParsedProperty>,
    pub anchor: Option<ParsedProperty>,
    pub scale: Option<ParsedProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skew: Option<ParsedProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skew_axis: Option<ParsedProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_opacity: Option<ParsedProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_opacity: Option<ParsedProperty>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedGradient {
    #[serde(rename = "type")]
    pub gradient_type: GradientType,
    pub start_point: ParsedProperty,
    pub end_point: ParsedProperty,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub highlight_length: Option<ParsedProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub highlight_angle: Option<ParsedProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_points: Option<f64>,
    pub stops: ParsedProperty,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ParsedDash {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub value: ParsedProperty,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedTextKeyframe {
    pub at: f64,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill_color: Option<Vec<f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub justify: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracking: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_color: Option<Vec<f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_width: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedText {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill_color: Option<Vec<f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub justify: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracking: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_color: Option<Vec<f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keyframes: Option<Vec<ParsedTextKeyframe>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedMask {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub inverted: bool,
    pub mode: MaskMode,
    pub path: ParsedProperty,
    pub opacity: ParsedProperty,
    pub expand: ParsedProperty,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedShape {
    #[serde(rename = "type")]
    pub shape_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub match_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<ParsedShape>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<ParsedProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub star_type: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub points: Option<ParsedProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchor: Option<ParsedProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale: Option<ParsedProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotation: Option<ParsedProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outer_radius: Option<ParsedProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inner_radius: Option<ParsedProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outer_roundness: Option<ParsedProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inner_roundness: Option<ParsedProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<ParsedProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub radius: Option<ParsedProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direction: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rd: Option<Box<ParsedShape>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<ParsedProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gradient: Option<ParsedGradient>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opacity: Option<ParsedProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_width: Option<ParsedProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_cap: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_join: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub miter_limit: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill_rule: Option<FillRule>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dashes: Option<Vec<ParsedDash>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub copies: Option<ParsedProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub copies_offset: Option<ParsedProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub composite: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merge_mode: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transform: Option<ParsedTransform>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start: Option<ParsedProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end: Option<ParsedProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<ParsedProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trim_mode: Option<TrimMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertices: Option<ParsedProperty>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedLayer {
    pub index: f64,
    #[serde(rename = "type")]
    pub layer_type: LayerType,
    pub transform: ParsedTransform,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_index: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ref_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub in_frame: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub out_frame: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stretch: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_orient: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is3d: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blend_mode: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub solid_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub solid_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub solid_height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layer_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layer_height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matte_type: Option<MatteType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matte_target: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_remap: Option<ParsedProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub masks: Option<Vec<ParsedMask>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<ParsedText>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shapes: Option<Vec<ParsedShape>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ParsedAsset {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "w")]
    pub width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "h")]
    pub height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub u: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub p: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layers: Option<Vec<ParsedLayer>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedMarker {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub start_frame: f64,
    pub end_frame: f64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedAnimation {
    pub width: f64,
    pub height: f64,
    pub fps: f64,
    pub in_frame: f64,
    pub out_frame: f64,
    pub duration: f64,
    pub layers: Vec<ParsedLayer>,
    pub assets: Vec<ParsedAsset>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub tgs: bool,
    pub is3d: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub markers: Option<Vec<ParsedMarker>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerInfo {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub in_frame: f64,
    pub out_frame: f64,
}
