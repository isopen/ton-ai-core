use tgs::{has_animated_properties, parse_tgs, load_tgs, ParseOptions};

fn read_fixture(name: &str) -> String {
    let content = std::fs::read_to_string(format!("tests/fixtures/{}", name)).unwrap();
    content
}

#[test]
fn parses_the_real_shock_fixture() {
    let json = read_fixture("emoji_shock.json");
    let anim = parse_tgs(&json, None).unwrap();
    assert_eq!(anim.width, 100.0);
    assert_eq!(anim.height, 100.0);
    assert!(anim.fps > 0.0);
    assert!(!anim.layers.is_empty());
    let _ = has_animated_properties(&anim);
}

#[test]
fn parses_the_real_wink_fixture() {
    let json = read_fixture("emoji_wink.json");
    let anim = parse_tgs(&json, None).unwrap();
    assert!(!anim.layers.is_empty());
    for layer in &anim.layers {
        assert!(layer.out_frame.unwrap_or(anim.out_frame) >= 0.0);
    }
}

#[test]
fn parses_the_real_wink_fixture_through_the_cache() {
    let json = read_fixture("emoji_wink.json");
    let opts = ParseOptions { key: Some("wink".to_string()), cache: true };
    let a = parse_tgs(&json, Some(opts.clone())).unwrap();
    let b = parse_tgs(&json, Some(opts)).unwrap();
    assert_eq!(a, b);
}

#[test]
fn load_tgs_accepts_the_payload_and_rejects_garbage() {
    let json = read_fixture("emoji_wink.json");
    let anim = load_tgs(json.as_bytes()).unwrap();
    assert!(!anim.layers.is_empty());
    let err = load_tgs(&[0x1f, 0x8b, 0x00, 0x01]).unwrap_err();
    assert_eq!(err.0, "TGS decompression failed");
}
