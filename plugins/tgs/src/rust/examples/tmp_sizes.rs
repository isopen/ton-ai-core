use std::mem::size_of;

fn main() {
    println!("Value {}", size_of::<tgs::json::Value>());
    println!("Map {}", size_of::<tgs::json::Map>());
    println!("JsonStr {}", size_of::<tgs::json::JsonStr>());
    println!("Nums {}", size_of::<tgs::json::Nums>());
    println!("ParsedProperty {}", size_of::<tgs::types::ParsedProperty>());
    println!("ParsedKeyframe {}", size_of::<tgs::types::ParsedKeyframe>());
    println!("ParsedShape {}", size_of::<tgs::types::ParsedShape>());
    println!("ParsedLayer {}", size_of::<tgs::types::ParsedLayer>());
    println!("ParsedAnimation {}", size_of::<tgs::types::ParsedAnimation>());
    println!("ParsedTransform {}", size_of::<tgs::types::ParsedTransform>());
    println!("ParsedGradient {}", size_of::<tgs::types::ParsedGradient>());
    println!("ParsedMask {}", size_of::<tgs::types::ParsedMask>());
    println!("ParsedAsset {}", size_of::<tgs::types::ParsedAsset>());
    println!("ParsedDash {}", size_of::<tgs::types::ParsedDash>());
}
