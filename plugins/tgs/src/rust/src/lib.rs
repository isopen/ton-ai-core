pub mod bezier;
mod accum;
mod cells;
mod cov_cache;
#[cfg(any(target_arch = "wasm32", feature = "prof"))]
pub use cov_cache::{set_skip_draw, set_skip_fresh, set_skip_raster, set_skip_sink, set_skip_walk, set_skip_paint};
pub fn set_sparse_k(v: u32) {
    accum::set_sparse_k(v);
}
mod direct;
mod framesig;
mod gradlut;
pub mod paint_simd;
pub mod bridge;
pub mod easing;
pub mod inflate;
pub mod jsutil;
pub mod json;
pub mod keyframes;
pub mod keypath;
pub mod parser;
pub mod prof;
pub mod rast;
pub mod render;
pub mod serialize;
pub mod static_check;
pub mod types;

#[cfg(target_arch = "wasm32")]
pub mod wasm;


pub use bezier::{bezier_length, bezier_point_at, bezier_split, bezier_t_at_length, BezierPoint, CubicBezierSeg};
pub use cov_cache::cache_all_off;
pub use easing::{build_easing, easing_value, CubicBezier};
pub use inflate::inflate_tgs;

pub fn cov_stats() -> String {
    cov_cache::stats_string()
}

pub fn cov_cache_probe_reset() {
    cov_cache::probe_reset();
}

#[doc(hidden)]
pub fn cov_cache_all_off(v: bool) {
    cov_cache::cache_all_off(v);
}
pub use keyframes::{interpolate_keyframes, lerp_value, parse_value};
pub use keypath::{get_override, match_key_path, set_value, FrameInfo, Property};
pub use parser::{
    analyze_tgs_features, configure_model_cache_size, frame_at_pos, layer_info, load_tgs, parse_tgs, parse_tgs_lex, parse_tgs_parts,
    ParseError, ParseOptions, TgsFeatureReport,
};
pub use static_check::{has_animated_properties, is_frame_invariant};
pub use types::{
    BezierEasingDef, CubicBezierEasing, FillRule, GradientType, LayerInfo, LayerType, MaskMode, MatteType,
    ParsedAnimation, ParsedAsset, ParsedDash, ParsedGradient, ParsedKeyframe, ParsedLayer, ParsedMarker, ParsedMask,
    ParsedProperty, ParsedPropertyData, ParsedShape, ParsedText, ParsedTextKeyframe, ParsedTransform,
    PropertyValue, TrimMode,
};

pub struct TgsError(pub String);

impl std::fmt::Display for TgsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::fmt::Debug for TgsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "TgsError({:?})", self.0)
    }
}

impl std::error::Error for TgsError {}

pub type TgsResult<T> = Result<T, TgsError>;

pub fn tgs_err<T>(msg: &str) -> TgsResult<T> {
    Err(TgsError(msg.to_string()))
}
