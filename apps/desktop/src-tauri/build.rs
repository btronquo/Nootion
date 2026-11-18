use std::fs;

fn main() {
    // The app's version is the one in apps/desktop/package.json, as for the installers (tauri.conf.json), so that
    // releases bump a single number. Cargo.toml's own version is not used.
    println!("cargo:rerun-if-changed=../package.json");
    let package = fs::read_to_string("../package.json").expect("apps/desktop/package.json");
    let package: serde_json::Value = serde_json::from_str(&package).expect("package.json is JSON");
    let version = package["version"].as_str().expect("a version in package.json");
    println!("cargo:rustc-env=NOOTION_DESKTOP_VERSION={version}");
    tauri_build::build()
}
