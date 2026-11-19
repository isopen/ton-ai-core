use crate::render::RenderInstance;

struct RenderSlot {
    inst: RenderInstance,
    pix: crate::rast::PixBuf,
}

static mut SLOTS: Option<Vec<Option<RenderSlot>>> = None;
static mut LAST_ERR: Option<Vec<u8>> = None;

fn slots() -> &'static mut Vec<Option<RenderSlot>> {
    unsafe {
        let p = core::ptr::addr_of_mut!(SLOTS);
        (*p).get_or_insert_with(Vec::new)
    }
}

fn set_err(msg: &str) {
    unsafe {
        let p = core::ptr::addr_of_mut!(LAST_ERR);
        *p = Some(msg.as_bytes().to_vec());
    }
}

fn pack(ptr: usize, len: u32) -> u64 {
    ((len as u64) << 32) | (ptr as u64 & 0xffff_ffff)
}

fn box_vec(v: Vec<u8>) -> u64 {
    let boxed: Box<[u8]> = v.into_boxed_slice();
    let len = boxed.len() as u32;
    let ptr = Box::into_raw(boxed) as *mut u8;
    pack(ptr as usize, len)
}

fn resp() -> u64 {
    unsafe {
        let p = core::ptr::addr_of_mut!(LAST_ERR);
        match &*p {
            Some(e) => box_vec(e.clone()),
            None => 0,
        }
    }
}

fn json_from(ptr: u32, len: u32) -> Option<&'static str> {
    if len == 0 {
        return None;
    }
    unsafe {
        let s = core::str::from_utf8_unchecked(core::slice::from_raw_parts(ptr as *const u8, len as usize));
        Some(s)
    }
}

fn key_from(ptr: u32, len: u32) -> Option<String> {
    if len == 0 {
        return None;
    }
    json_from(ptr, len).map(|s| s.to_string())
}

fn parse_model(json: &str, key: Option<&str>, cache: bool) -> Result<crate::types::ParsedAnimation, String> {
    let opts = Some(crate::ParseOptions { key: key.map(|s| s.to_string()), cache });
    crate::parse_tgs(json, opts).map_err(|e| e.0)
}

fn parse_and_render(json: &str) -> Option<RenderSlot> {
    match parse_model(json, None, false) {
        Ok(anim) => {
            let inst = RenderInstance::new(anim);
            let pix = crate::rast::PixBuf::new(0, 0)?;
            crate::cov_cache::seed_commit();
            Some(RenderSlot { inst, pix })
        }
        Err(_) => None,
    }
}

fn free_slot(s: usize) {
    let slots = slots();
    if s == 0 {
        return;
    }
    let i = s - 1;
    if i < slots.len() {
        slots[i] = None;
    }
}

fn take_slot(s: usize) -> Option<&'static mut RenderSlot> {
    if s == 0 {
        return None;
    }
    let i = s - 1;
    let slots = slots();
    if i >= slots.len() {
        return None;
    }
    slots[i].as_mut()
}

const SER_FAIL: &str = "tgs serialize failed";
const PARSE_FAIL: &str = "tgs parse failed";
const BAD_SIZE: &str = "tgs render: bad size";
const BAD_HANDLE: &str = "tgs render: bad handle";

#[no_mangle]
pub extern "C" fn tgs_alloc(len: u32) -> u64 {
    let boxed: Box<[core::mem::MaybeUninit<u8>]> = Box::new_uninit_slice(len as usize);
    pack(Box::into_raw(boxed) as *mut u8 as usize, len)
}

#[no_mangle]
pub extern "C" fn tgs_free(ptr: u32, len: u32) {
    if ptr == 0 || len == 0 {
        return;
    }
    unsafe {
        drop(Box::from_raw(core::ptr::slice_from_raw_parts_mut(
            ptr as *mut u8,
            len as usize,
        )));
    }
}

#[no_mangle]
pub extern "C" fn tgs_err() -> u64 {
    resp()
}

#[no_mangle]
pub extern "C" fn tgs_parse_json(ptr: u32, len: u32, key_ptr: u32, key_len: u32, cache: u8) -> u64 {
    let key = key_from(key_ptr, key_len);
    let json = match json_from(ptr, len) {
        Some(s) => s,
        None => {
            set_err(PARSE_FAIL);
            return 0;
        }
    };
    match parse_model(json, key.as_deref(), cache != 0)
        .ok()
        .and_then(|a| crate::serialize::serialize_animation(&a).ok())
    {
        Some(s) => box_vec(s.into_bytes()),
        None => {
            set_err(if resp() == 0 { SER_FAIL } else { PARSE_FAIL });
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn tgs_parse_binary(ptr: u32, len: u32, lex: u8, cache: u8) -> u64 {
    let json = match json_from(ptr, len) {
        Some(s) => s,
        None => {
            set_err(PARSE_FAIL);
            return 0;
        }
    };
    let opts = Some(crate::ParseOptions { key: None, cache: cache != 0 });
    let model = if lex != 0 {
        crate::parse_tgs_lex(json, opts).ok()
    } else {
        crate::parse_tgs(json, opts).ok()
    };
    match model {
        Some(a) => box_vec(crate::bridge::encode_animation(&a)),
        None => {
            set_err(PARSE_FAIL);
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn tgs_measure(ptr: u32, len: u32) -> u64 {
    let json = match json_from(ptr, len) {
        Some(s) => s,
        None => {
            set_err(PARSE_FAIL);
            return 0;
        }
    };
    match crate::parse_tgs_parts(json) {
        Ok((a, b, c, d)) => box_vec(format!("{:.2},{:.2},{:.2},{:.2}", a, b, c, d).into_bytes()),
        Err(_) => {
            set_err(PARSE_FAIL);
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn tgs_render_new(ptr: u32, len: u32, w: u32, h: u32) -> u32 {
    let json = match json_from(ptr, len) {
        Some(s) => s,
        None => {
            set_err(PARSE_FAIL);
            return 0;
        }
    };
    if w.max(1).checked_mul(h.max(1)).and_then(|x| x.checked_mul(4)).is_none() {
        set_err(BAD_SIZE);
        return 0;
    }
    let slots = slots();
    crate::cov_cache::note_new_instance();
    let mut idx = None;
    for (i, s) in slots.iter().enumerate() {
        if s.is_none() {
            idx = Some(i);
            break;
        }
    }
    match parse_and_render(json) {
        Some(slot) => match idx {
            Some(i) => {
                slots[i] = Some(slot);
                (i + 1) as u32
            }
            None => {
                slots.push(Some(slot));
                slots.len() as u32
            }
        },
        None => {
            set_err(BAD_SIZE);
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn tgs_render(handle: u32, frame: f64, w: u32, h: u32) -> u64 {
    let Some(slot) = take_slot(handle as usize) else {
        set_err(BAD_HANDLE);
        return 0;
    };
    if slot.pix.width() != w.max(1) || slot.pix.height() != h.max(1) {
        match crate::rast::PixBuf::new(w.max(1), h.max(1)) {
            Some(pix) => slot.pix = pix,
            None => {
                set_err(BAD_SIZE);
                return 0;
            }
        }
    }
    slot.inst.render_frame_into(&mut slot.pix, frame);
    pack(slot.pix.data().as_ptr() as usize, slot.pix.data().len() as u32)
}

#[no_mangle]
pub extern "C" fn tgs_render_in_frame(handle: u32) -> f64 {
    take_slot(handle as usize).map(|s| s.inst.anim.in_frame).unwrap_or(f64::NAN)
}

#[no_mangle]
pub extern "C" fn tgs_render_out_frame(handle: u32) -> f64 {
    take_slot(handle as usize).map(|s| s.inst.anim.out_frame).unwrap_or(f64::NAN)
}

#[no_mangle]
pub extern "C" fn tgs_render_frame_count(handle: u32) -> u32 {
    let Some(slot) = take_slot(handle as usize) else { return 0 };
    ((slot.inst.anim.out_frame - slot.inst.anim.in_frame).ceil() as u32).max(1)
}

#[no_mangle]
pub extern "C" fn tgs_render_drop(handle: u32) {
    free_slot(handle as usize);
}

#[no_mangle]
pub extern "C" fn tgs_prof_reset() {
    crate::prof::reset();
}

#[doc(hidden)]
#[no_mangle]
pub extern "C" fn tgs_cache_off(v: u32) {
    crate::cov_cache::capture_off(v != 0);
}

#[doc(hidden)]
#[no_mangle]
pub extern "C" fn tgs_cache_all_off(v: u32) {
    crate::cov_cache::cache_all_off(v != 0);
}

#[doc(hidden)]
#[no_mangle]
pub extern "C" fn tgs_skip_walk(v: u32) {
    crate::cov_cache::set_skip_walk(v != 0);
}

#[doc(hidden)]
#[no_mangle]
pub extern "C" fn tgs_skip_sink(v: u32) {
    crate::cov_cache::set_skip_sink(v != 0);
}

#[doc(hidden)]
#[no_mangle]
pub extern "C" fn tgs_skip_mark(v: u32) {
    crate::cov_cache::set_skip_mark(v != 0);
}

#[doc(hidden)]
#[no_mangle]
pub extern "C" fn tgs_debug_layers(handle: u32, frame: f64) -> u64 {
    let Some(slot) = take_slot(handle as usize) else {
        return 0;
    };
    box_vec(crate::render::debug_layers(&slot.inst.anim, frame).into_bytes())
}

#[doc(hidden)]
#[no_mangle]
pub extern "C" fn tgs_set_draw_log(v: u32) {
    crate::render::set_draw_log(v != 0);
}

#[doc(hidden)]
#[no_mangle]
pub extern "C" fn tgs_draw_log() -> u64 {
    box_vec(crate::render::draw_log_dump().into_bytes())
}

#[doc(hidden)]
#[no_mangle]
pub extern "C" fn tgs_paint_dbg() -> u64 {
    box_vec(crate::render::paint_dbg_dump().into_bytes())
}

#[doc(hidden)]
#[no_mangle]
pub extern "C" fn tgs_paint_dbg_clear() {
    crate::render::paint_dbg_clear();
}

#[doc(hidden)]
#[no_mangle]
pub extern "C" fn tgs_probe(v: u32) {
    crate::rast::probe_set(v != 0);
}

#[doc(hidden)]
#[no_mangle]
pub extern "C" fn tgs_probe_dump() -> u64 {
    box_vec(crate::rast::probe_dump().into_bytes())
}

#[doc(hidden)]
#[no_mangle]
pub extern "C" fn tgs_skip_one(v: u32) {
    crate::cov_cache::set_skip_one(v);
}

#[doc(hidden)]
#[no_mangle]
pub extern "C" fn tgs_only_one(v: u32) {
    crate::cov_cache::set_only_one(v);
}

#[doc(hidden)]
#[no_mangle]
pub extern "C" fn tgs_skip_draw(v: u32) {
    crate::cov_cache::set_skip_draw(v != 0);
}

#[doc(hidden)]
#[no_mangle]
pub extern "C" fn tgs_skip_fresh(v: u32) {
    crate::cov_cache::set_skip_fresh(v != 0);
}

#[doc(hidden)]
#[no_mangle]
pub extern "C" fn tgs_skip_raster(v: u32) {
    crate::cov_cache::set_skip_raster(v != 0);
}

#[no_mangle]
pub extern "C" fn tgs_skip_paint(v: u32) {
    crate::cov_cache::set_skip_paint(v != 0);
}

#[no_mangle]
pub extern "C" fn tgs_cache_stats() -> u64 {
    box_vec(crate::cov_cache::stats_string().into_bytes())
}

#[no_mangle]
pub extern "C" fn tgs_prof_stats() -> u64 {
    let ts = crate::prof::totals();
    let mut s = String::from("{");
    for (i, (ms, name)) in ts.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        s.push_str(&format!("\"{}\":{:.3}", name, ms));
    }
    s.push('}');
    box_vec(s.into_bytes())
}
