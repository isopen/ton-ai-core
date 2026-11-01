use crate::types::{BezierEasingDef, CubicBezierEasing};
use std::collections::HashMap;
use std::collections::VecDeque;
use std::sync::Mutex;

const SAMPLE_TABLE_SIZE: usize = 11;
const NEWTON_ITERATIONS: usize = 4;
const NEWTON_MIN_SLOPE: f64 = 0.02;
const SUBDIVISION_PRECISION: f64 = 1e-7;
const SUBDIVISION_MAX_ITERATIONS: usize = 10;
const SAMPLE_STEP_SIZE: f64 = 1.0 / (SAMPLE_TABLE_SIZE as f64 - 1.0);
const MAX_INTERPOLATORS: usize = 256;

fn calc_bezier(t: f64, a1: f64, a2: f64) -> f64 {
    let a = 1.0 - 3.0 * a2 + 3.0 * a1;
    let b = 3.0 * a2 - 6.0 * a1;
    let c = 3.0 * a1;
    ((a * t + b) * t + c) * t
}

fn get_slope(t: f64, a1: f64, a2: f64) -> f64 {
    let a = 1.0 - 3.0 * a2 + 3.0 * a1;
    let b = 3.0 * a2 - 6.0 * a1;
    let c = 3.0 * a1;
    (3.0 * a * t + 2.0 * b) * t + c
}

fn clamp01(v: f64) -> f64 {
    if v < 0.0 {
        0.0
    } else if v > 1.0 {
        1.0
    } else {
        v
    }
}

#[derive(Debug, Clone)]
pub struct CubicBezier {
    x1: f64,
    y1: f64,
    x2: f64,
    y2: f64,
    sample_values: Option<[f64; SAMPLE_TABLE_SIZE]>,
}

impl CubicBezier {
    pub fn new(x1: f64, y1: f64, x2: f64, y2: f64) -> Self {
        let cx1 = clamp01(x1);
        let cy1 = y1;
        let cx2 = clamp01(x2);
        let cy2 = y2;
        let sample_values = if cx1 == cy1 && cx2 == cy2 {
            None
        } else {
            let mut samples = [0.0f64; SAMPLE_TABLE_SIZE];
            for (i, item) in samples.iter_mut().enumerate() {
                *item = calc_bezier(i as f64 * SAMPLE_STEP_SIZE, cx1, cx2);
            }
            Some(samples)
        };
        Self {
            x1: cx1,
            y1: cy1,
            x2: cx2,
            y2: cy2,
            sample_values,
        }
    }

    pub fn value(&self, a_x: f64) -> f64 {
        match &self.sample_values {
            None => a_x,
            Some(samples) => calc_bezier(self.get_t_for_x(a_x, samples), self.y1, self.y2),
        }
    }

    fn get_t_for_x(&self, a_x: f64, samples: &[f64; SAMPLE_TABLE_SIZE]) -> f64 {
        let mut interval_start = 0.0f64;
        let mut current_sample = 1usize;
        let last_sample = SAMPLE_TABLE_SIZE - 1;
        while current_sample != last_sample && samples[current_sample] <= a_x {
            interval_start += SAMPLE_STEP_SIZE;
            current_sample += 1;
        }
        current_sample -= 1;

        let denom = samples[current_sample + 1] - samples[current_sample];

        let dist = if denom == 0.0 {
            0.0
        } else {
            (a_x - samples[current_sample]) / denom
        };
        let guess_for_t = interval_start + dist * SAMPLE_STEP_SIZE;

        let initial_slope = get_slope(guess_for_t, self.x1, self.x2);
        if initial_slope >= NEWTON_MIN_SLOPE {
            return self.newton_raphson_iterate(a_x, guess_for_t);
        }
        if initial_slope == 0.0 {
            return guess_for_t;
        }
        self.binary_subdivide(a_x, interval_start, interval_start + SAMPLE_STEP_SIZE)
    }

    fn newton_raphson_iterate(&self, a_x: f64, mut guess_t: f64) -> f64 {
        for _ in 0..NEWTON_ITERATIONS {
            let current_x = calc_bezier(guess_t, self.x1, self.x2) - a_x;
            let current_slope = get_slope(guess_t, self.x1, self.x2);
            if current_slope == 0.0 {
                return guess_t;
            }
            guess_t -= current_x / current_slope;
        }
        guess_t
    }

    fn binary_subdivide(&self, a_x: f64, mut a: f64, mut b: f64) -> f64 {
        let mut current_t;
        let mut current_x;
        let mut i = 0usize;
        loop {
            current_t = a + (b - a) / 2.0;
            current_x = calc_bezier(current_t, self.x1, self.x2) - a_x;
            if current_x > 0.0 {
                b = current_t;
            } else {
                a = current_t;
            }
            if !(current_x.abs() > SUBDIVISION_PRECISION) {
                break;
            }
            i += 1;
            if i >= SUBDIVISION_MAX_ITERATIONS {
                break;
            }
        }
        current_t
    }
}

fn tangent_component(def: Option<&BezierEasingDef>, axis: u8) -> f64 {
    match def {
        None => 0.0,
        Some(d) => {
            let arr = if axis == 0 { d.x.as_ref() } else { d.y.as_ref() };
            match arr.and_then(|a| a.first()) {
                Some(el) => *el,
                None => 0.0,
            }
        }
    }
}

pub fn build_easing(o: Option<&BezierEasingDef>, i: Option<&BezierEasingDef>) -> Option<CubicBezierEasing> {
    if o.is_none() && i.is_none() {
        return None;
    }
    let x1 = tangent_component(o, 0);
    let y1 = tangent_component(o, 1);
    let x2 = tangent_component(i, 0);
    let y2 = tangent_component(i, 1);
    if !(x1.is_finite() && y1.is_finite() && x2.is_finite() && y2.is_finite()) {
        return None;
    }
    Some(CubicBezierEasing { x1, y1, x2, y2 })
}

fn easing_key(x1: f64, y1: f64, x2: f64, y2: f64) -> String {
    format!("{}_{}_{}_{}", x1, y1, x2, y2)
}

fn cache_get(cache: &Mutex<(HashMap<String, CubicBezier>, VecDeque<String>)>, key: &str) -> Option<CubicBezier> {
    let mut guard = cache.lock().unwrap();
    let (map, order) = &mut *guard;
    let value = map.remove(key)?;
    if let Some(pos) = order.iter().position(|k| k == key) {
        order.remove(pos);
    }
    order.push_back(key.to_string());
    map.insert(key.to_string(), value.clone());
    Some(value)
}

fn cache_put(cache: &Mutex<(HashMap<String, CubicBezier>, VecDeque<String>)>, key: String, value: CubicBezier) {
    let mut guard = cache.lock().unwrap();
    let (map, order) = &mut *guard;
    let _ = map.remove(&key);
    if let Some(pos) = order.iter().position(|k| *k == key) {
        order.remove(pos);
    }
    order.push_back(key.clone());
    map.insert(key, value);
    while map.len() > MAX_INTERPOLATORS {
        if let Some(oldest) = order.pop_front() {
            map.remove(&oldest);
        }
    }
}

fn interpolator_cache() -> &'static Mutex<(HashMap<String, CubicBezier>, VecDeque<String>)> {
    static CACHE: std::sync::OnceLock<Mutex<(HashMap<String, CubicBezier>, VecDeque<String>)>> = std::sync::OnceLock::new();
    CACHE.get_or_init(|| Mutex::new((HashMap::new(), VecDeque::new())))
}

pub fn easing_value(easing: CubicBezierEasing, t: f64) -> f64 {
    let key = easing_key(easing.x1, easing.y1, easing.x2, easing.y2);
    let cache = interpolator_cache();
    if let Some(interp) = cache_get(cache, &key) {
        return interp.value(t);
    }
    let interp = CubicBezier::new(easing.x1, easing.y1, easing.x2, easing.y2);
    let result = interp.value(t);
    cache_put(cache, key, interp);
    result
}
