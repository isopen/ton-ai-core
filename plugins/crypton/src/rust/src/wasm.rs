use crate::CryptoError;

static mut LAST_ERR: Option<Vec<u8>> = None;

fn set_err(msg: &str) {
    unsafe {
        let p = core::ptr::addr_of_mut!(LAST_ERR);
        *p = Some(msg.as_bytes().to_vec());
    }
}

fn pack(ptr: usize, len: u32) -> u64 {
    ((len as u64) << 32) | (ptr as u64 & 0xffff_ffff)
}

fn box_vec(mut v: Vec<u8>) -> u64 {
    v.shrink_to_fit();
    let len = v.len() as u32;
    let mut v = core::mem::ManuallyDrop::new(v);
    pack(v.as_mut_ptr() as usize, len)
}

fn read_err() -> u64 {
    unsafe {
        let p = core::ptr::addr_of_mut!(LAST_ERR);
        match &*p {
            Some(e) => box_vec(e.clone()),
            None => 0,
        }
    }
}

fn bytes_from(ptr: u32, len: u32) -> &'static [u8] {
    unsafe { core::slice::from_raw_parts(ptr as *const u8, len as usize) }
}

fn str_from(ptr: u32, len: u32) -> &'static str {
    if len == 0 {
        return "";
    }
    unsafe { core::str::from_utf8_unchecked(bytes_from(ptr, len)) }
}

fn bytes_of(v: Vec<u8>) -> u64 {
    box_vec(v)
}

fn hex_of(s: String) -> u64 {
    box_vec(s.into_bytes())
}

fn run_bool(r: Result<bool, CryptoError>) -> u8 {
    match r {
        Ok(true) => 1,
        Ok(false) => 0,
        Err(e) => {
            set_err(&e.to_string());
            2
        }
    }
}

fn run_bytes(r: Result<Vec<u8>, CryptoError>) -> u64 {
    match r {
        Ok(v) => bytes_of(v),
        Err(e) => {
            set_err(&e.to_string());
            0
        }
    }
}

fn run_hex(r: Result<String, CryptoError>) -> u64 {
    match r {
        Ok(s) => hex_of(s),
        Err(e) => {
            set_err(&e.to_string());
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn crypton_alloc(len: u32) -> u64 {
    let mut v: Vec<u8> = Vec::with_capacity(len as usize);
    let ptr = v.as_mut_ptr() as usize;
    core::mem::forget(v);
    pack(ptr, len)
}

#[no_mangle]
pub extern "C" fn crypton_free(ptr: u32, len: u32) {
    if ptr == 0 || len == 0 {
        return;
    }
    unsafe {
        drop(Vec::from_raw_parts(ptr as *mut u8, len as usize, len as usize));
    }
}

#[no_mangle]
pub extern "C" fn crypton_err() -> u64 {
    read_err()
}

#[no_mangle]
pub extern "C" fn crypton_get_random_bytes(len: u32) -> u64 {
    match crate::get_random_bytes(len as usize) {
        Ok(v) => bytes_of(v),
        Err(e) => {
            set_err(&e.to_string());
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn crypton_sha1(ptr: u32, len: u32) -> u64 {
    bytes_of(crate::hashes::sha1(bytes_from(ptr, len)).to_vec())
}

#[no_mangle]
pub extern "C" fn crypton_sha256(ptr: u32, len: u32) -> u64 {
    bytes_of(crate::hashes::sha256(bytes_from(ptr, len)).to_vec())
}

#[no_mangle]
pub extern "C" fn crypton_sha512(ptr: u32, len: u32) -> u64 {
    bytes_of(crate::hashes::sha512(bytes_from(ptr, len)).to_vec())
}

#[no_mangle]
pub extern "C" fn crypton_hmac_sha256(k_ptr: u32, k_len: u32, d_ptr: u32, d_len: u32) -> u64 {
    bytes_of(crate::hmac_sha256(bytes_from(k_ptr, k_len), bytes_from(d_ptr, d_len)))
}

#[no_mangle]
pub extern "C" fn crypton_hmac_sha512(k_ptr: u32, k_len: u32, d_ptr: u32, d_len: u32) -> u64 {
    bytes_of(crate::hmac_sha512(bytes_from(k_ptr, k_len), bytes_from(d_ptr, d_len)))
}

#[no_mangle]
pub extern "C" fn crypton_hkdf_sha512_extract(salt_ptr: u32, salt_len: u32, ikm_ptr: u32, ikm_len: u32) -> u64 {
    bytes_of(crate::hmac_sha512(bytes_from(salt_ptr, salt_len), bytes_from(ikm_ptr, ikm_len)))
}

#[no_mangle]
pub extern "C" fn crypton_hkdf_sha512_expand(prk_ptr: u32, prk_len: u32, info_ptr: u32, info_len: u32, len: u32) -> u64 {
    run_bytes(crate::hkdf_expand_checked(bytes_from(prk_ptr, prk_len), bytes_from(info_ptr, info_len), len as usize))
}

#[no_mangle]
pub extern "C" fn crypton_pbkdf2_sha256(pw_ptr: u32, pw_len: u32, salt_ptr: u32, salt_len: u32, iters: u32, dk_len: u32) -> u64 {
    run_bytes(crate::pbkdf2_sha256_checked(
        bytes_from(pw_ptr, pw_len),
        bytes_from(salt_ptr, salt_len),
        iters as usize,
        dk_len as usize,
    ))
}

#[no_mangle]
pub extern "C" fn crypton_mod_pow(b_ptr: u32, b_len: u32, e_ptr: u32, e_len: u32, m_ptr: u32, m_len: u32) -> u64 {
    run_hex(crate::mod_pow_hex_checked(
        str_from(b_ptr, b_len),
        str_from(e_ptr, e_len),
        str_from(m_ptr, m_len),
    ))
}

#[no_mangle]
pub extern "C" fn crypton_is_probably_prime(n_ptr: u32, n_len: u32, rounds: u32) -> u8 {
    run_bool(crate::is_probably_prime_checked(str_from(n_ptr, n_len), rounds))
}

#[no_mangle]
pub extern "C" fn crypton_aes256_ecb_encrypt(k_ptr: u32, k_len: u32, d_ptr: u32, d_len: u32) -> u64 {
    run_bytes(crate::ecb_encrypt_checked(bytes_from(k_ptr, k_len), bytes_from(d_ptr, d_len)))
}

#[no_mangle]
pub extern "C" fn crypton_aes256_ecb_decrypt(k_ptr: u32, k_len: u32, d_ptr: u32, d_len: u32) -> u64 {
    run_bytes(crate::ecb_decrypt_checked(bytes_from(k_ptr, k_len), bytes_from(d_ptr, d_len)))
}

#[no_mangle]
pub extern "C" fn crypton_aes256_cbc_encrypt(k_ptr: u32, k_len: u32, iv_ptr: u32, iv_len: u32, d_ptr: u32, d_len: u32) -> u64 {
    run_bytes(crate::cbc_encrypt_checked(bytes_from(k_ptr, k_len), bytes_from(iv_ptr, iv_len), bytes_from(d_ptr, d_len)))
}

#[no_mangle]
pub extern "C" fn crypton_aes256_cbc_decrypt(k_ptr: u32, k_len: u32, iv_ptr: u32, iv_len: u32, d_ptr: u32, d_len: u32) -> u64 {
    run_bytes(crate::cbc_decrypt_checked(bytes_from(k_ptr, k_len), bytes_from(iv_ptr, iv_len), bytes_from(d_ptr, d_len)))
}

#[no_mangle]
pub extern "C" fn crypton_aes256_cbc_encrypt_etm(mk_ptr: u32, mk_len: u32, ek_ptr: u32, ek_len: u32, iv_ptr: u32, iv_len: u32, d_ptr: u32, d_len: u32) -> u64 {
    run_bytes(crate::cbc_encrypt_etm_checked(
        bytes_from(mk_ptr, mk_len),
        bytes_from(ek_ptr, ek_len),
        bytes_from(iv_ptr, iv_len),
        bytes_from(d_ptr, d_len),
    ))
}

#[no_mangle]
pub extern "C" fn crypton_aes256_cbc_decrypt_etm(mk_ptr: u32, mk_len: u32, ek_ptr: u32, ek_len: u32, iv_ptr: u32, iv_len: u32, d_ptr: u32, d_len: u32) -> u64 {
    run_bytes(crate::cbc_decrypt_etm_checked(
        bytes_from(mk_ptr, mk_len),
        bytes_from(ek_ptr, ek_len),
        bytes_from(iv_ptr, iv_len),
        bytes_from(d_ptr, d_len),
    ))
}

#[no_mangle]
pub extern "C" fn crypton_aes256_cbc_seal(mk_ptr: u32, mk_len: u32, ek_ptr: u32, ek_len: u32, d_ptr: u32, d_len: u32) -> u64 {
    run_bytes(crate::cbc_seal_checked(bytes_from(mk_ptr, mk_len), bytes_from(ek_ptr, ek_len), bytes_from(d_ptr, d_len)))
}

#[no_mangle]
pub extern "C" fn crypton_aes256_cbc_open(mk_ptr: u32, mk_len: u32, ek_ptr: u32, ek_len: u32, d_ptr: u32, d_len: u32) -> u64 {
    run_bytes(crate::cbc_open_checked(bytes_from(mk_ptr, mk_len), bytes_from(ek_ptr, ek_len), bytes_from(d_ptr, d_len)))
}

#[no_mangle]
pub extern "C" fn crypton_aes256_ige_encrypt(d_ptr: u32, d_len: u32, k_ptr: u32, k_len: u32, iv_ptr: u32, iv_len: u32) -> u64 {
    run_bytes(crate::ige_encrypt_checked(bytes_from(d_ptr, d_len), bytes_from(k_ptr, k_len), bytes_from(iv_ptr, iv_len)))
}

#[no_mangle]
pub extern "C" fn crypton_aes256_ige_decrypt(d_ptr: u32, d_len: u32, k_ptr: u32, k_len: u32, iv_ptr: u32, iv_len: u32) -> u64 {
    run_bytes(crate::ige_decrypt_checked(bytes_from(d_ptr, d_len), bytes_from(k_ptr, k_len), bytes_from(iv_ptr, iv_len)))
}

#[no_mangle]
pub extern "C" fn crypton_aes256_ctr_process(d_ptr: u32, d_len: u32, k_ptr: u32, k_len: u32, iv_ptr: u32, iv_len: u32, byte_offset: u64) -> u64 {
    run_bytes(crate::ctr_process_checked(
        bytes_from(d_ptr, d_len),
        bytes_from(k_ptr, k_len),
        bytes_from(iv_ptr, iv_len),
        byte_offset,
    ))
}
