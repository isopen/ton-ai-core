use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn parse_tgs_json(json: &str, key: Option<String>, cache: bool) -> Result<String, JsValue> {
    let opts = Some(super::ParseOptions { key, cache });
    let anim = super::parse_tgs(json, opts).map_err(|e| JsValue::from_str(&e.0))?;
    serde_json::to_string(&anim).map_err(|e| JsValue::from_str(&format!("tgs serialize failed: {}", e)))
}
