use crate::json::{JsonStr, Value as JsonValue};
use crate::easing::CubicBezier;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FillRule {
    Winding,
    Evenodd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrimMode {
    Simultaneously,
    Individually,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CubicBezierEasing {
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct BezierEasingDef {
    pub x: Option<f64>,
    pub y: Option<f64>,
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

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedKeyframe {
    pub t: f64,
    pub s: JsonValue,
    pub end_frame: Option<f64>,
    pub hold: bool,
    pub o: Option<BezierEasingDef>,
    pub i: Option<BezierEasingDef>,
    pub easing: Option<CubicBezierEasing>,
    pub easing_curve: Option<Box<CubicBezier>>,
    pub e: Option<JsonValue>,
    pub to: Option<Vec<f64>>,
    pub ti: Option<Vec<f64>>,
    pub h: Option<JsonValue>,
    pub n: Option<JsonValue>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParsedPropertyData {
    pub animated: bool,
    pub value: JsonValue,
    pub keyframes: Option<Vec<ParsedKeyframe>>,
    pub x: Option<Box<ParsedProperty>>,
    pub y: Option<Box<ParsedProperty>>,
    pub override_value: Option<PropertyValue>,
}

static EMPTY_PROP: ParsedPropertyData = ParsedPropertyData {
    animated: false,
    value: JsonValue::Null,
    keyframes: None,
    x: None,
    y: None,
    override_value: None,
};

pub struct ParsedProperty(std::ptr::NonNull<ParsedPropertyData>);

unsafe impl Send for ParsedProperty {}
unsafe impl Sync for ParsedProperty {}

impl ParsedProperty {
    #[inline]
    fn empty_ptr() -> std::ptr::NonNull<ParsedPropertyData> {
        unsafe {
            std::ptr::NonNull::new_unchecked(
                &EMPTY_PROP as *const ParsedPropertyData as *mut ParsedPropertyData,
            )
        }
    }

    #[inline]
    pub fn new(data: ParsedPropertyData) -> ParsedProperty {
        ParsedProperty(unsafe { std::ptr::NonNull::new_unchecked(Box::into_raw(Box::new(data))) })
    }

    #[inline]
    fn is_empty(&self) -> bool {
        self.0.as_ptr() == Self::empty_ptr().as_ptr()
    }
}

impl Default for ParsedProperty {
    #[inline]
    fn default() -> ParsedProperty {
        ParsedProperty(Self::empty_ptr())
    }
}

impl From<ParsedPropertyData> for ParsedProperty {
    #[inline]
    fn from(data: ParsedPropertyData) -> ParsedProperty {
        ParsedProperty::new(data)
    }
}

impl core::ops::Deref for ParsedProperty {
    type Target = ParsedPropertyData;
    #[inline]
    fn deref(&self) -> &ParsedPropertyData {
        unsafe { self.0.as_ref() }
    }
}

impl core::ops::DerefMut for ParsedProperty {
    #[inline]
    fn deref_mut(&mut self) -> &mut ParsedPropertyData {
        if self.is_empty() {
            let b = Box::new(ParsedPropertyData::default());
            self.0 = unsafe { std::ptr::NonNull::new_unchecked(Box::into_raw(b)) };
        }
        unsafe { self.0.as_mut() }
    }
}

impl Clone for ParsedProperty {
    fn clone(&self) -> ParsedProperty {
        if self.is_empty() {
            ParsedProperty::default()
        } else {
            ParsedProperty::new((**self).clone())
        }
    }
}

impl Drop for ParsedProperty {
    fn drop(&mut self) {
        if !self.is_empty() {
            unsafe {
                drop(Box::from_raw(self.0.as_ptr()));
            }
        }
    }
}

impl std::fmt::Debug for ParsedProperty {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(&**self, f)
    }
}

impl PartialEq for ParsedProperty {
    fn eq(&self, other: &ParsedProperty) -> bool {
        **self == **other
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParsedTransform {
    pub opacity: Option<ParsedProperty>,
    pub rotation: Option<ParsedProperty>,
    pub position: Option<ParsedProperty>,
    pub anchor: Option<ParsedProperty>,
    pub scale: Option<ParsedProperty>,
    pub skew: Option<ParsedProperty>,
    pub skew_axis: Option<ParsedProperty>,
    pub start_opacity: Option<ParsedProperty>,
    pub end_opacity: Option<ParsedProperty>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedGradient {
    pub gradient_type: GradientType,
    pub start_point: ParsedProperty,
    pub end_point: ParsedProperty,
    pub highlight_length: Option<ParsedProperty>,
    pub highlight_angle: Option<ParsedProperty>,
    pub color_points: Option<f64>,
    pub stops: ParsedProperty,
    pub stops_cache: GradStopsCache,
}

#[derive(Debug, Clone, Default)]
pub struct GradStopsCache(pub std::sync::Arc<std::sync::RwLock<Option<crate::gradlut::GradStops>>>);

impl PartialEq for GradStopsCache {
    fn eq(&self, _other: &Self) -> bool {
        true
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedDash {
    pub name: Option<JsonStr>,
    pub value: ParsedProperty,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct ParsedTextKeyframe {
    pub at: f64,
    pub text: JsonStr,
    pub font_size: Option<f64>,
    pub font_family: Option<JsonStr>,
    pub fill_color: Option<Vec<f64>>,
    pub justify: Option<f64>,
    pub line_height: Option<f64>,
    pub tracking: Option<f64>,
    pub stroke_color: Option<Vec<f64>>,
    pub stroke_width: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct ParsedText {
    pub text: JsonStr,
    pub font_size: Option<f64>,
    pub font_family: Option<JsonStr>,
    pub fill_color: Option<Vec<f64>>,
    pub justify: Option<f64>,
    pub line_height: Option<f64>,
    pub tracking: Option<f64>,
    pub stroke_color: Option<Vec<f64>>,
    pub stroke_width: Option<f64>,
    pub keyframes: Option<Vec<ParsedTextKeyframe>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedMask {
    pub name: Option<JsonStr>,
    pub inverted: bool,
    pub mode: MaskMode,
    pub path: ParsedProperty,
    pub opacity: ParsedProperty,
    pub expand: ParsedProperty,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct ParsedShape {
    pub shape_type: JsonStr,
    pub name: Option<JsonStr>,
    pub match_name: Option<JsonStr>,
    pub index: Option<f64>,
    pub children: Option<Vec<ParsedShape>>,
    pub position: Option<ParsedProperty>,
    pub star_type: Option<f64>,
    pub points: Option<ParsedProperty>,
    pub anchor: Option<ParsedProperty>,
    pub scale: Option<ParsedProperty>,
    pub rotation: Option<ParsedProperty>,
    pub outer_radius: Option<ParsedProperty>,
    pub inner_radius: Option<ParsedProperty>,
    pub outer_roundness: Option<ParsedProperty>,
    pub inner_roundness: Option<ParsedProperty>,
    pub size: Option<ParsedProperty>,
    pub radius: Option<ParsedProperty>,
    pub direction: Option<f64>,
    pub rd: Option<Box<ParsedShape>>,
    pub color: Option<ParsedProperty>,
    pub gradient: Option<ParsedGradient>,
    pub opacity: Option<ParsedProperty>,
    pub stroke_width: Option<ParsedProperty>,
    pub line_cap: Option<f64>,
    pub line_join: Option<f64>,
    pub miter_limit: Option<f64>,
    pub fill_rule: Option<FillRule>,
    pub dashes: Option<Vec<ParsedDash>>,
    pub copies: Option<ParsedProperty>,
    pub copies_offset: Option<ParsedProperty>,
    pub composite: Option<f64>,
    pub merge_mode: Option<f64>,
    pub transform: Option<ParsedTransform>,
    pub start: Option<ParsedProperty>,
    pub end: Option<ParsedProperty>,
    pub offset: Option<ParsedProperty>,
    pub trim_mode: Option<TrimMode>,
    pub vertices: Option<ParsedProperty>,
    pub verts_fast: Option<Box<VertFast>>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct VertContour {
    pub closed: Option<bool>,
    pub nv: usize,
    pub ni: usize,
    pub no: usize,
    pub flat: Vec<f64>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct VertShape {
    pub contours: Vec<VertContour>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct VertKf {
    pub t: f64,
    pub end_frame: Option<f64>,
    pub hold: bool,
    pub snap: bool,
    pub s: VertShape,
    pub e: Option<VertShape>,
    pub easing_curve: Option<Box<CubicBezier>>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct VertFast {
    pub animated: bool,
    pub value: VertShape,
    pub keyframes: Vec<VertKf>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParsedLayer {
    pub index: Option<f64>,
    pub layer_type: LayerType,
    pub transform: ParsedTransform,
    pub name: Option<JsonStr>,
    pub parent_index: Option<f64>,
    pub ref_id: Option<JsonStr>,
    pub in_frame: Option<f64>,
    pub out_frame: Option<f64>,
    pub start_time: Option<f64>,
    pub stretch: Option<f64>,
    pub auto_orient: Option<f64>,
    pub is3d: Option<bool>,
    pub blend_mode: Option<f64>,
    pub solid_color: Option<JsonStr>,
    pub solid_width: Option<f64>,
    pub solid_height: Option<f64>,
    pub layer_width: Option<f64>,
    pub layer_height: Option<f64>,
    pub matte_type: Option<MatteType>,
    pub matte_target: Option<bool>,
    pub time_remap: Option<ParsedProperty>,
    pub masks: Option<Vec<ParsedMask>>,
    pub text: Option<ParsedText>,
    pub shapes: Option<Vec<ParsedShape>>,
    pub hidden: Option<bool>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedAsset {
    pub id: Option<JsonStr>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub u: Option<JsonStr>,
    pub p: Option<JsonStr>,
    pub layers: Option<std::sync::Arc<Vec<ParsedLayer>>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedMarker {
    pub name: Option<JsonStr>,
    pub start_frame: f64,
    pub end_frame: f64,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParsedAnimation {
    pub width: f64,
    pub height: f64,
    pub fps: f64,
    pub in_frame: f64,
    pub out_frame: f64,
    pub duration: f64,
    pub layers: Vec<ParsedLayer>,
    pub assets: Vec<ParsedAsset>,
    pub name: Option<JsonStr>,
    pub version: Option<JsonStr>,
    pub tgs: bool,
    pub is3d: bool,
    pub markers: Option<Vec<ParsedMarker>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LayerInfo {
    pub name: Option<String>,
    pub in_frame: f64,
    pub out_frame: f64,
}
