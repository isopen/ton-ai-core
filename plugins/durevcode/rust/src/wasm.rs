use wasm_bindgen::prelude::*;
use crate::analyze_diff;
use crate::models::{chat_url_for, is_free_id, needs_responses_endpoint, FREE_MODELS};

#[wasm_bindgen]
pub fn durev_version() -> String {
    crate::version().to_string()
}

#[wasm_bindgen]
pub fn durev_stat(text: &str) -> String {
    let s = analyze_diff(text);
    format!("add={} del={} hunks={} score={}", s.add, s.del, s.hunks, s.score)
}

#[wasm_bindgen]
pub fn durev_models() -> String {
    let mut out = String::new();
    for m in FREE_MODELS {
        out.push_str(m.id);
        out.push('\n');
    }
    out
}

#[wasm_bindgen]
pub fn durev_is_free(id: &str) -> bool {
    is_free_id(id)
}

#[wasm_bindgen]
pub fn durev_chat_url(id: &str) -> String {
    chat_url_for(id).to_string()
}

#[wasm_bindgen]
pub fn durev_needs_responses(id: &str) -> bool {
    needs_responses_endpoint(id)
}
