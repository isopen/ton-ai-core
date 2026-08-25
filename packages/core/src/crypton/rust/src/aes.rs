fn gmul(a: u8, b: u8) -> u8 {
    let mut p = 0u8;
    let mut a = a;
    let mut b = b;
    for _ in 0..8 {
        let lo_mask = (b & 1).wrapping_neg();
        p ^= a & lo_mask;
        let hi = a & 0x80;
        a <<= 1;
        let reduce = (hi >> 7).wrapping_neg();
        a ^= 0x1b & reduce;
        b >>= 1;
    }
    p
}

fn rol(x: u8, r: usize) -> u8 {
    ((x << r) | (x >> (8 - r))) & 0xff
}

fn gf_inv(a: u8) -> u8 {
    let a2 = gmul(a, a);
    let a4 = gmul(a2, a2);
    let a8 = gmul(a4, a4);
    let a16 = gmul(a8, a8);
    let a32 = gmul(a16, a16);
    let a64 = gmul(a32, a32);
    let a128 = gmul(a64, a64);
    let mut acc = gmul(a2, a4);
    acc = gmul(acc, a8);
    acc = gmul(acc, a16);
    acc = gmul(acc, a32);
    acc = gmul(acc, a64);
    gmul(acc, a128)
}

fn affine_fwd(v: u8) -> u8 {
    v ^ rol(v, 1) ^ rol(v, 2) ^ rol(v, 3) ^ rol(v, 4) ^ 0x63
}

fn affine_inv(v: u8) -> u8 {
    rol(v, 1) ^ rol(v, 3) ^ rol(v, 6)
}

pub fn sbox_byte(b: u8) -> u8 {
    affine_fwd(gf_inv(b))
}

pub fn inv_sbox_byte(y: u8) -> u8 {
    gf_inv(affine_inv(y ^ 0x63))
}

pub fn key_expansion(key: &[u8]) -> Result<Vec<[u8; 16]>, crate::CryptoError> {
    const RCON: [u8; 7] = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40];
    let nr = 14;
    let total = 16 * (nr + 1);
    if key.len() != 32 { return Err(crate::CryptoError::InvalidKeyLength); }
    let mut w = vec![0u8; total];
    w[..32].copy_from_slice(key);
    let mut rcon_i = 0;
    let mut i = 32;
    while i < total {
        let mut t = [w[i-4], w[i-3], w[i-2], w[i-1]];
        if i % 32 == 0 {
            t = [sbox_byte(t[1]), sbox_byte(t[2]), sbox_byte(t[3]), sbox_byte(t[0])];
            t[0] ^= RCON[rcon_i];
            rcon_i += 1;
        } else if i % 32 == 16 {
            t = [sbox_byte(t[0]), sbox_byte(t[1]), sbox_byte(t[2]), sbox_byte(t[3])];
        }
        for j in 0..4 { w[i+j] = w[i-32+j] ^ t[j]; }
        i += 4;
    }
    let rounds = (0..nr+1).map(|r| { let mut b = [0u8;16]; b.copy_from_slice(&w[r*16..(r+1)*16]); b }).collect();
    crate::wipe(&mut w);
    Ok(rounds)
}

pub fn aes256_encrypt_block(rk: &[[u8;16]], block: &mut [u8;16]) {
    xor_round_key(block, &rk[0]);
    for r in 1..14 {
        sub_bytes(block);
        shift_rows(block);
        mix_columns(block);
        xor_round_key(block, &rk[r]);
    }
    sub_bytes(block);
    shift_rows(block);
    xor_round_key(block, &rk[14]);
}

pub fn aes256_decrypt_block(rk: &[[u8;16]], block: &mut [u8;16]) {
    xor_round_key(block, &rk[14]);
    for r in (1..14).rev() {
        inv_shift_rows(block);
        inv_sub_bytes(block);
        xor_round_key(block, &rk[r]);
        inv_mix_columns(block);
    }
    inv_shift_rows(block);
    inv_sub_bytes(block);
    xor_round_key(block, &rk[0]);
}

fn xor_round_key(b: &mut [u8;16], k: &[u8;16]) { for i in 0..16 { b[i] ^= k[i]; } }
fn sub_bytes(b: &mut [u8;16]) { for i in 0..16 { b[i] = sbox_byte(b[i]); } }
fn inv_sub_bytes(b: &mut [u8;16]) { for i in 0..16 { b[i] = inv_sbox_byte(b[i]); } }

fn shift_rows(b: &mut [u8;16]) {
    let t = *b;
    b[1]=t[5]; b[5]=t[9]; b[9]=t[13]; b[13]=t[1];
    b[2]=t[10]; b[6]=t[14]; b[10]=t[2]; b[14]=t[6];
    b[3]=t[15]; b[7]=t[3]; b[11]=t[7]; b[15]=t[11];
}
fn inv_shift_rows(b: &mut [u8;16]) {
    let t = *b;
    b[5]=t[1]; b[9]=t[5]; b[13]=t[9]; b[1]=t[13];
    b[10]=t[2]; b[14]=t[6]; b[2]=t[10]; b[6]=t[14];
    b[15]=t[3]; b[3]=t[7]; b[7]=t[11]; b[11]=t[15];
}
fn mix_columns(b: &mut [u8;16]) {
    for c in 0..4 {
        let o = c*4;
        let a = [b[o],b[o+1],b[o+2],b[o+3]];
        b[o]   = gmul(a[0],2)^gmul(a[1],3)^a[2]^a[3];
        b[o+1] = a[0]^gmul(a[1],2)^gmul(a[2],3)^a[3];
        b[o+2] = a[0]^a[1]^gmul(a[2],2)^gmul(a[3],3);
        b[o+3] = gmul(a[0],3)^a[1]^a[2]^gmul(a[3],2);
    }
}
fn inv_mix_columns(b: &mut [u8;16]) {
    for c in 0..4 {
        let o = c*4;
        let a = [b[o],b[o+1],b[o+2],b[o+3]];
        b[o]   = gmul(a[0],14)^gmul(a[1],11)^gmul(a[2],13)^gmul(a[3],9);
        b[o+1] = gmul(a[0],9)^gmul(a[1],14)^gmul(a[2],11)^gmul(a[3],13);
        b[o+2] = gmul(a[0],13)^gmul(a[1],9)^gmul(a[2],14)^gmul(a[3],11);
        b[o+3] = gmul(a[0],11)^gmul(a[1],13)^gmul(a[2],9)^gmul(a[3],14);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SBOX_ROW0: [u8; 16] = [
        0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
    ];

    #[test]
    fn computed_sbox_matches_reference_column() {
        for i in 0..16 {
            assert_eq!(sbox_byte(i as u8), SBOX_ROW0[i], "sbox[{i}]");
            assert_eq!(inv_sbox_byte(SBOX_ROW0[i]), i as u8, "inv_sbox[{:02x}]", SBOX_ROW0[i]);
        }
    }

    #[test]
    fn sbox_is_an_involutive_pair() {
        for x in 0..=255u8 {
            assert_eq!(inv_sbox_byte(sbox_byte(x)), x);
        }
    }
}
