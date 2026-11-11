// No console window behind the app on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nootion_desktop_lib::run()
}
