use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    build_speech_bridge();
    tauri_build::build();
}

/// Builds the one Swift file that talks to Apple's speech stack and links it into the binary.
/// The app ships for macOS only; another target has no bridge and `speech.rs` reports it
/// unavailable.
fn build_speech_bridge() {
    if !cfg!(target_os = "macos") {
        return;
    }
    let manifest = std::env::var("CARGO_MANIFEST_DIR").expect("Cargo sets the manifest folder");
    let source = Path::new(&manifest).join("ConductedSpeech/OnDeviceSpeech.swift");
    let out = PathBuf::from(std::env::var("OUT_DIR").expect("Cargo sets the build folder"));
    let library = out.join("libconducted_speech.a");
    println!("cargo:rerun-if-changed={}", source.display());

    let mut command = Command::new("xcrun");
    // Let the Swift compiler use the toolchain's own macOS target. A deployment target inherited
    // from the shell would ask for runtime compatibility libraries this Xcode no longer ships.
    command.env_remove("MACOSX_DEPLOYMENT_TARGET");
    command.args([
        "swiftc",
        "-swift-version",
        "5",
        "-O",
        "-emit-library",
        "-static",
        "-module-name",
        "ConductedSpeech",
        "-o",
    ]);
    command.arg(&library).arg(&source);
    let status = command.status().expect("xcrun runs the Swift compiler");
    assert!(
        status.success(),
        "swiftc could not build the on-device speech bridge"
    );

    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=conducted_speech");
    println!("cargo:rustc-link-lib=framework=Speech");
    println!("cargo:rustc-link-lib=framework=AVFoundation");
}
