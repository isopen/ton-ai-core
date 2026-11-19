use crate::json::Value as JsonValue;

#[cfg(target_arch = "wasm32")]
mod clock {
    extern "C" {
        #[link_name = "perf_now"]
        pub(crate) fn perf_now() -> f64;
    }
}


#[allow(dead_code)]
pub(crate) fn clock_now() -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        unsafe { clock::perf_now() }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64()
            * 1000.0
    }
}

pub fn js_number(v: &JsonValue) -> f64 {
    match v {
        JsonValue::Number(n) => *n,
        JsonValue::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                0.0
            } else {
                t.parse::<f64>().unwrap_or(f64::NAN)
            }
        }
        JsonValue::Bool(b) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        JsonValue::Null => 0.0,
        _ => f64::NAN,
    }
}

pub fn js_number_of(v: Option<&JsonValue>) -> f64 {
    match v {
        Some(x) => js_number(x),
        None => f64::NAN,
    }
}

pub fn js_truthy(v: Option<&JsonValue>) -> bool {
    match v {
        None => false,
        Some(JsonValue::Bool(b)) => *b,
        Some(JsonValue::Number(n)) => {
            let f = *n;
            f != 0.0 && !f.is_nan()
        }
        Some(JsonValue::String(s)) => !s.is_empty(),
        Some(JsonValue::Null) => false,
        Some(JsonValue::Array(_)) | Some(JsonValue::Nums(_)) | Some(JsonValue::Object(_)) => true,
    }
}

pub fn js_is_object(v: &JsonValue) -> bool {
    v.is_object() || v.is_array()
}

pub fn js_str(v: &JsonValue) -> String {
    match v {
        JsonValue::String(s) => s.to_string(),
        JsonValue::Number(n) => {
            let f = *n;
            if !f.is_finite() {
                "NaN".to_string()
            } else if f == f.trunc() && f.abs() < 1e15 {
                format!("{}", f as i64)
            } else {
                format!("{}", f)
            }
        }
        JsonValue::Bool(b) => {
            if *b {
                "true".to_string()
            } else {
                "false".to_string()
            }
        }
        JsonValue::Null => "null".to_string(),
        _ => "[object Object]".to_string(),
    }
}

pub fn js_opt_str(v: Option<&JsonValue>) -> Option<String> {
    v.map(js_str)
}

pub fn js_owned_str(v: &JsonValue) -> crate::json::JsonStr {
    match v {
        JsonValue::String(s) => s.clone(),
        other => crate::json::JsonStr::new(&js_str(other)),
    }
}

pub fn js_owned_opt_str(v: Option<&JsonValue>) -> Option<crate::json::JsonStr> {
    v.map(js_owned_str)
}

pub fn js_strict_number(v: Option<&JsonValue>) -> Option<f64> {
    match v {
        Some(JsonValue::Number(n)) => {
            if n.is_finite() {
                Some(*n)
            } else {
                None
            }
        }
        _ => None,
    }
}

pub fn js_strict_eq(a: Option<&JsonValue>, b: Option<&JsonValue>) -> bool {
    match (a, b) {
        (Some(JsonValue::Number(x)), Some(JsonValue::Number(y))) => x == y,
        (Some(JsonValue::String(x)), Some(JsonValue::String(y))) => x == y,
        (Some(JsonValue::Bool(x)), Some(JsonValue::Bool(y))) => x == y,
        (Some(JsonValue::Null), Some(JsonValue::Null)) => true,
        (Some(x), Some(y)) => !x.is_array() && !y.is_array(),
        _ => false,
    }
}

pub fn unwrap_value(v: &JsonValue) -> JsonValue {
    if let Some(arr) = v.as_array() {
        if arr.len() == 1 && (arr[0].is_object() || arr[0].is_null()) {
            return arr[0].clone();
        }
    }
    v.clone()
}

pub fn unwrap_value_owned(v: JsonValue) -> JsonValue {
    match v {
        JsonValue::Array(mut a) if a.len() == 1 && (a[0].is_object() || a[0].is_null()) => a.swap_remove(0),
        other => other,
    }
}

pub fn is_num_array(v: &JsonValue) -> bool {
    v.is_num_array()
}

pub fn js_num_value(v: f64) -> JsonValue {
    if v.is_finite() {
        JsonValue::Number(v)
    } else {
        JsonValue::Null
    }
}

pub fn js_f64_vec(v: Option<&JsonValue>) -> Option<Vec<f64>> {
    match v? {
        JsonValue::Nums(n) => Some(n.iter().collect()),
        x => x.as_array().map(|a| a.iter().map(js_number).collect()),
    }
}
