use crate::{TgsError, TgsResult};
use flate2::read::GzDecoder;
use std::io::Read;

const GZIP_MAGIC: [u8; 2] = [0x1f, 0x8b];
pub const MAX_PAYLOAD: usize = 16 * 1024 * 1024;

pub fn inflate_tgs(data: &[u8]) -> TgsResult<String> {
    if data.len() > MAX_PAYLOAD {
        return Err(TgsError("TGS payload exceeds size limit".to_string()));
    }
    if data.len() >= 2 && data[0] == GZIP_MAGIC[0] && data[1] == GZIP_MAGIC[1] {
        let mut decoder = GzDecoder::new(data);
        let mut out: Vec<u8> = Vec::new();
        let mut chunk = [0u8; 65536];
        loop {
            match decoder.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => {
                    out.extend_from_slice(&chunk[..n]);
                    if out.len() > MAX_PAYLOAD {
                        return Err(TgsError("TGS payload exceeds size limit".to_string()));
                    }
                }
                Err(_) => return Err(TgsError("TGS decompression failed".to_string())),
            }
        }
        Ok(String::from_utf8_lossy(&out).into_owned())
    } else {
        Ok(String::from_utf8_lossy(data).into_owned())
    }
}
