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

const SBOX: [u8; 256] = [
    0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
    0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
    0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
    0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
    0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
    0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
    0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
    0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
    0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
    0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
    0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
    0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
    0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
    0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
    0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
    0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16,
];

const INV_SBOX: [u8; 256] = {
    let mut t = [0u8; 256];
    let mut i = 0;
    while i < 256 { t[SBOX[i] as usize] = i as u8; i += 1; }
    t
};

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
    SBOX[b as usize]
}

pub fn inv_sbox_byte(y: u8) -> u8 {
    INV_SBOX[y as usize]
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
