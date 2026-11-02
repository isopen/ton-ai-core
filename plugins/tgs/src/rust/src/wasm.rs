use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn parse_tgs_json(json: &str, key: Option<String>, cache: bool) -> Result<String, JsValue> {
    let opts = Some(super::ParseOptions { key, cache });
    let anim = super::parse_tgs(json, opts).map_err(|e| JsValue::from_str(&e.0))?;
    serde_json::to_string(&anim).map_err(|e| JsValue::from_str(&format!("tgs serialize failed: {}", e)))
}

#[wasm_bindgen]
pub fn measure_parse_parts(json: &str) -> Result<String, JsValue> {
    let (t_json, t_build, t_ser, t_lex) = super::parse_tgs_parts(json).map_err(|e| JsValue::from_str(&e.0))?;
    Ok(format!("{:.2},{:.2},{:.2},{:.2}", t_json, t_build, t_ser, t_lex))
}

#[wasm_bindgen]
pub fn parse_tgs_binary(json: &str, key: Option<String>, cache: bool) -> Result<Vec<u8>, JsValue> {
    let opts = Some(super::ParseOptions { key, cache });
    let anim = super::parse_tgs(json, opts).map_err(|e| JsValue::from_str(&e.0))?;
    Ok(super::bridge::encode_animation(&anim))
}

#[wasm_bindgen]
pub fn parse_tgs_binary_lex(json: &str, key: Option<String>, cache: bool) -> Result<Vec<u8>, JsValue> {
    let opts = Some(super::ParseOptions { key, cache });
    let anim = super::parse_tgs_lex(json, opts).map_err(|e| JsValue::from_str(&e.0))?;
    Ok(super::bridge::encode_animation(&anim))
}

#[wasm_bindgen]
pub fn parse_tgs_binary_serde(json: &str, key: Option<String>, cache: bool) -> Result<Vec<u8>, JsValue> {
    let opts = Some(super::ParseOptions { key, cache });
    let anim = super::parse_tgs(json, opts).map_err(|e| JsValue::from_str(&e.0))?;
    Ok(super::bridge::encode_animation(&anim))
}
