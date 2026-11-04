//! Binary entry point. Everything lives in the library crate (lib.rs) so tests can reach it.

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    conducted_lib::run()
}
