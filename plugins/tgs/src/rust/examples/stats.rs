use std::fs::read;

fn prop(p: &Option<tgs::types::ParsedProperty>, kf: &mut u64, anim: &mut u64) {
    if let Some(p) = p {
        if p.animated {
            *anim += 1;
        }
        if let Some(k) = &p.keyframes {
            *kf += k.len() as u64;
        }
    }
}

fn shape(s: &tgs::types::ParsedShape, c: &mut [u64; 16], kf: &mut u64, anim: &mut u64) {
    let t = s.shape_type.as_str();
    match t {
        "group" => c[0] += 1,
        "fill" => c[1] += 1,
        "stroke" => c[2] += 1,
        "gradientFill" => c[3] += 1,
        "gradientStroke" => c[4] += 1,
        "transform" => c[5] += 1,
        "trim" => c[6] += 1,
        "repeater" => c[7] += 1,
        "rect" | "roundedCorner" => c[8] += 1,
        "ellipse" => c[9] += 1,
        "star" => c[10] += 1,
        "path" => c[11] += 1,
        _ => c[12] += 1,
    }
    prop(&s.position, kf, anim);
    prop(&s.anchor, kf, anim);
    prop(&s.scale, kf, anim);
    prop(&s.rotation, kf, anim);
    prop(&s.points, kf, anim);
    prop(&s.outer_radius, kf, anim);
    prop(&s.inner_radius, kf, anim);
    prop(&s.outer_roundness, kf, anim);
    prop(&s.inner_roundness, kf, anim);
    prop(&s.size, kf, anim);
    prop(&s.radius, kf, anim);
    prop(&s.color, kf, anim);
    prop(&s.opacity, kf, anim);
    prop(&s.stroke_width, kf, anim);
    prop(&s.copies, kf, anim);
    prop(&s.copies_offset, kf, anim);
    prop(&s.start, kf, anim);
    prop(&s.end, kf, anim);
    prop(&s.offset, kf, anim);
    prop(&s.vertices, kf, anim);
    if let Some(ch) = &s.children {
        for x in ch {
            shape(x, c, kf, anim);
        }
    }
    if let Some(rd) = &s.rd {
        shape(rd, c, kf, anim);
    }
}

fn main() {
    let mut out = String::from("pack,file,bytes,w,h,fps,frames,layers,assets,groups,fills,strokes,gfills,gstrokes,transforms,trims,repeaters,rects,ellipses,stars,paths,other,masks,mattes,animated,kf,solid,image,precomp,null,text\n");
    for path in std::env::args().skip(1) {
        let data = match read(&path) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let json = match tgs::inflate_tgs(&data) {
            Ok(j) => j,
            Err(_) => continue,
        };
        let a = match tgs::parse_tgs(&json, None) {
            Ok(a) => a,
            Err(_) => continue,
        };
        let mut c = [0u64; 16];
        let mut kf = 0u64;
        let mut anim = 0u64;
        let mut masks = 0u64;
        let mut mattes = 0u64;
        let (mut solid, mut image, mut precomp, mut nul, mut text) = (0u64, 0u64, 0u64, 0u64, 0u64);
        let mut count_layer = |l: &tgs::types::ParsedLayer| {
            if l.masks.is_some() {
                masks += l.masks.as_ref().unwrap().len() as u64;
            }
            if l.matte_type.is_some() && l.matte_type != Some(tgs::types::MatteType::None) {
                mattes += 1;
            }
            match l.layer_type {
                tgs::types::LayerType::Solid => solid += 1,
                tgs::types::LayerType::Image => image += 1,
                tgs::types::LayerType::Precomp => precomp += 1,
                tgs::types::LayerType::Null => nul += 1,
                tgs::types::LayerType::Text => text += 1,
                _ => {}
            }
            prop(&l.time_remap, &mut kf, &mut anim);
            if let Some(s) = &l.shapes {
                for x in s {
                    shape(x, &mut c, &mut kf, &mut anim);
                }
            }
            for p in [
                &l.transform.position, &l.transform.anchor, &l.transform.scale,
                &l.transform.rotation, &l.transform.opacity, &l.transform.skew,
                &l.transform.skew_axis,
            ] {
                prop(p, &mut kf, &mut anim);
            }
        };
        for l in &a.layers {
            count_layer(l);
        }
        for aset in &a.assets {
            if let Some(ls) = &aset.layers {
                for l in ls.iter() {
                    count_layer(l);
                }
            }
        }
        let mut it = path.rsplit('/');
        let file = it.next().unwrap_or("");
        let pack = it.next().unwrap_or("");
        let frames = (a.out_frame - a.in_frame).ceil().max(1.0);
        out.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}\n",
            pack, file, data.len(), a.width as u32, a.height as u32, a.fps as u32, frames as u32,
            a.layers.len(), a.assets.len(), c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9], c[10], c[11], c[12],
            masks, mattes, anim, kf, solid, image, precomp, nul, text
        ));
    }
    print!("{}", out);
}
