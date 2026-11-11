//! Nootion for Windows, macOS and Linux.
//!
//! The window first shows a small built-in page (`launcher/`) to pick or add a Nootion server, then loads that
//! server's own web app: the interface, offline mode and updates all come from the server, as in a browser.
//! Pages loaded from a server get no access to the app's commands (see `capabilities/default.json`).

mod menu;
mod probe;
mod profiles;

use std::sync::Mutex;

use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Manager, State, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

use profiles::{Profile, Profiles, Store};

pub struct AppState {
    store: Store,
    profiles: Mutex<Profiles>,
}

pub(crate) const MAIN: &str = "main";

/// Whether the interface should speak French (menus, launcher).
pub(crate) fn french() -> bool {
    sys_locale::get_locale().is_some_and(|l| l.to_lowercase().starts_with("fr"))
}

fn save(state: &AppState, profiles: &Profiles) -> Result<(), String> {
    state.store.save(profiles)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LauncherState {
    profiles: Vec<Profile>,
    last: Option<String>,
    french: bool,
    version: &'static str,
}

#[tauri::command]
fn launcher_state(state: State<'_, AppState>) -> LauncherState {
    let p = state.profiles.lock().unwrap();
    LauncherState { profiles: p.sorted(), last: p.last.clone(), french: french(), version: env!("CARGO_PKG_VERSION") }
}

#[tauri::command]
async fn check_server(url: String) -> Result<probe::ProbeOk, probe::ProbeError> {
    probe::probe(&url).await
}

/// Checks the server again, then saves it. Returns the saved profile.
#[tauri::command]
async fn add_server(state: State<'_, AppState>, url: String, name: String) -> Result<Profile, probe::ProbeError> {
    let ok = probe::probe(&url).await?;
    let mut p = state.profiles.lock().unwrap();
    let profile = p.upsert(&name, &ok.url, ok.version);
    save(&state, &p).map_err(|e| probe::ProbeError { code: "save_failed", detail: Some(e) })?;
    Ok(profile)
}

#[tauri::command]
fn remove_server(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut p = state.profiles.lock().unwrap();
    p.remove(&id);
    save(&state, &p)
}

/// Loads the server's web app in the window.
#[tauri::command]
fn open_server(window: WebviewWindow, state: State<'_, AppState>, id: String) -> Result<(), String> {
    let profile = {
        let mut p = state.profiles.lock().unwrap();
        let profile = p.touch(&id).ok_or("unknown")?;
        save(&state, &p)?;
        profile
    };
    let url = Url::parse(&profile.url).map_err(|e| e.to_string())?;
    let _ = window.set_title(&format!("{} · Nootion", profile.name));
    window.navigate(url).map_err(|e| e.to_string())
}

/// Back to the server picker. `?choose` keeps it from reopening the last server by itself.
pub(crate) fn show_launcher(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN) else { return };
    let _ = window.set_title("Nootion");
    if let Ok(url) = launcher_url(app).join("index.html?choose=1") {
        let _ = window.navigate(url);
    }
}

/// `tauri://localhost/` on macOS and Linux, `http://tauri.localhost/` on Windows.
fn launcher_url(app: &AppHandle) -> Url {
    let _ = app;
    #[cfg(windows)]
    let base = "http://tauri.localhost/";
    #[cfg(not(windows))]
    let base = "tauri://localhost/";
    if cfg!(dev) {
        if let Some(dev) = app.config().build.dev_url.clone() {
            return dev;
        }
    }
    Url::parse(base).expect("static url")
}

fn is_launcher(app: &AppHandle, url: &Url) -> bool {
    url.origin() == launcher_url(app).origin()
}

fn create_main_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let handle = app.clone();
    let opener = app.clone();
    WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
        .title("Nootion")
        .inner_size(1280.0, 840.0)
        .min_inner_size(400.0, 500.0)
        .center()
        // Links that open a new tab (external links, files, "open in a new tab") go to the default browser.
        .on_new_window(move |url, _features| {
            if matches!(url.scheme(), "http" | "https" | "mailto") {
                let _ = opener.opener().open_url(url.as_str(), None::<&str>);
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |window, payload| {
            if payload.event() == PageLoadEvent::Finished && !is_launcher(&handle, payload.url()) {
                menu::set_server_items(&handle, true);
            } else if payload.event() == PageLoadEvent::Finished {
                menu::set_server_items(&handle, false);
                let _ = window.set_title("Nootion");
            }
        })
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second launch brings the open window to the front instead of starting another app.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window(MAIN) {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![launcher_state, check_server, add_server, remove_server, open_server])
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            let store = Store::new(&dir);
            let profiles = store.load();
            app.manage(AppState { store, profiles: Mutex::new(profiles) });
            app.set_menu(menu::build(app.handle())?)?;
            app.on_menu_event(menu::handle);
            create_main_window(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Nootion");
}
