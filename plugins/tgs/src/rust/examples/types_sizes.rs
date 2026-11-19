use std::mem::size_of;
use tgs::types::*;

fn main() {
    println!("Value={}", size_of::<tgs::json::Value>());
    println!("JsonStr={}", size_of::<tgs::json::JsonStr>());
    println!("Map={}", size_of::<tgs::json::Map>());
    println!("MapEntry={}", size_of::<Option<(tgs::json::JsonStr, tgs::json::Value)>>());
    println!("ParsedKeyframe={}", size_of::<ParsedKeyframe>());
    println!("ParsedProperty={}", size_of::<ParsedProperty>());
    println!("ParsedLayer={}", size_of::<ParsedLayer>());
    println!("ParsedShape={}", size_of::<ParsedShape>());
    println!("ParsedTransform={}", size_of::<ParsedTransform>());
    println!("ParsedMask={}", size_of::<ParsedMask>());
    println!("ParsedAsset={}", size_of::<ParsedAsset>());
    println!("ParsedGradient={}", size_of::<ParsedGradient>());
    println!("ParsedDash={}", size_of::<ParsedDash>());
    println!("BezierEasingDef={}", size_of::<BezierEasingDef>());
    println!("Option<BezierEasingDef>={}", size_of::<Option<BezierEasingDef>>());
    println!("ParsedAnimation={}", size_of::<ParsedAnimation>());
    println!("Option<Value>={}", size_of::<Option<tgs::json::Value>>());
    println!("Option<Box<ParsedProperty>>={}", size_of::<Option<Box<ParsedProperty>>>());
}
