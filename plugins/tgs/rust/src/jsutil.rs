use serde_json::Value as JsonValue;

pub fn js_number(v: &JsonValue) -> f64 {
    match v {
        JsonValue::Number(n) => n.as_f64().unwrap_or(f64::NAN),
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
            let f = n.as_f64().unwrap_or(f64::NAN);
            f != 0.0 && !f.is_nan()
        }
        Some(JsonValue::String(s)) => !s.is_empty(),
        Some(JsonValue::Null) => false,
        Some(JsonValue::Array(_)) | Some(JsonValue::Object(_)) => true,
    }
}

pub fn js_is_object(v: &JsonValue) -> bool {
    v.is_object() || v.is_array()
}

pub fn js_str(v: &JsonValue) -> String {
    match v {
        JsonValue::String(s) => s.clone(),
        JsonValue::Number(n) => match n.as_f64() {
            Some(f) if f == f.trunc() && f.is_finite() && f.abs() < 1e15 => format!("{}", f as i64),
            Some(f) => format!("{}", f),
            None => "NaN".to_string(),
        },
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

pub fn js_strict_number(v: Option<&JsonValue>) -> Option<f64> {
    match v {
        Some(JsonValue::Number(n)) => {
            let f = n.as_f64()?;
            if f.is_finite() {
                Some(f)
            } else {
                None
            }
        }
        _ => None,
    }
}

pub fn js_strict_eq(a: Option<&JsonValue>, b: Option<&JsonValue>) -> bool {
    match (a, b) {
        (Some(JsonValue::Number(x)), Some(JsonValue::Number(y))) => x.as_f64() == y.as_f64(),
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

pub fn is_num_array(v: &JsonValue) -> bool {
    v.as_array()
        .map(|a| a.iter().all(|x| x.is_number()))
        .unwrap_or(false)
}

pub fn js_num_value(v: f64) -> JsonValue {
    serde_json::Number::from_f64(v)
        .map(JsonValue::Number)
        .unwrap_or(JsonValue::Null)
}

pub fn js_f64_vec(v: Option<&JsonValue>) -> Option<Vec<f64>> {
    v.and_then(|x| x.as_array()).map(|a| a.iter().map(js_number).collect())
}
