//! The menu bar: switching servers, editing shortcuts (needed on macOS for copy and paste), zoom and reload.

use std::sync::Mutex;

use tauri::menu::{Menu, MenuEvent, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, Wry};

use crate::{french, show_launcher, MAIN};

static ZOOM: Mutex<f64> = Mutex::new(1.0);

const SWITCH: &str = "switch-server";
const RELOAD: &str = "reload";
const ZOOM_IN: &str = "zoom-in";
const ZOOM_OUT: &str = "zoom-out";
const ZOOM_RESET: &str = "zoom-reset";
const DEVTOOLS: &str = "devtools";
const QUIT: &str = "quit";

/// Items that only make sense while a server is open.
const SERVER_ITEMS: [&str; 2] = [SWITCH, RELOAD];

fn tr(fr: &'static str, en: &'static str) -> &'static str {
    if french() {
        fr
    } else {
        en
    }
}

pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let switch = MenuItem::with_id(app, SWITCH, tr("Changer de serveur…", "Switch server…"), false, Some("CmdOrCtrl+Shift+O"))?;
    let reload = MenuItem::with_id(app, RELOAD, tr("Recharger", "Reload"), false, Some("CmdOrCtrl+R"))?;
    let zoom_in = MenuItem::with_id(app, ZOOM_IN, tr("Zoom avant", "Zoom in"), true, Some("CmdOrCtrl+="))?;
    let zoom_out = MenuItem::with_id(app, ZOOM_OUT, tr("Zoom arrière", "Zoom out"), true, Some("CmdOrCtrl+-"))?;
    let zoom_reset = MenuItem::with_id(app, ZOOM_RESET, tr("Taille réelle", "Actual size"), true, Some("CmdOrCtrl+0"))?;

    let app_menu = Submenu::with_items(
        app,
        "Nootion",
        true,
        &[
            &PredefinedMenuItem::about(app, Some(tr("À propos de Nootion", "About Nootion")), None)?,
            &PredefinedMenuItem::separator(app)?,
            &switch,
            &PredefinedMenuItem::separator(app)?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::hide(app, None)?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::hide_others(app, None)?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::separator(app)?,
            // Not the predefined item: it does nothing on Linux, and quitting must stop the local server.
            &MenuItem::with_id(app, QUIT, tr("Quitter", "Quit"), true, Some("CmdOrCtrl+Q"))?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        tr("Édition", "Edit"),
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        tr("Affichage", "View"),
        true,
        &[
            &reload,
            &PredefinedMenuItem::separator(app)?,
            &zoom_in,
            &zoom_out,
            &zoom_reset,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
            #[cfg(debug_assertions)]
            &MenuItem::with_id(app, DEVTOOLS, tr("Outils de développement", "Developer tools"), true, Some("CmdOrCtrl+Alt+I"))?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        tr("Fenêtre", "Window"),
        true,
        &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::maximize(app, None)?],
    )?;
    Menu::with_items(app, &[&app_menu, &edit, &view, &window])
}

/// Turns the server items on or off.
pub fn set_server_items(app: &AppHandle, enabled: bool) {
    let Some(menu) = app.menu() else { return };
    for id in SERVER_ITEMS {
        if let Some(MenuItemKind::MenuItem(item)) = find(&menu, id) {
            let _ = item.set_enabled(enabled);
        }
    }
}

fn find(menu: &Menu<Wry>, id: &str) -> Option<MenuItemKind<Wry>> {
    for item in menu.items().ok()? {
        if let MenuItemKind::Submenu(sub) = &item {
            if let Some(found) = sub.get(id) {
                return Some(found);
            }
        }
    }
    None
}

fn zoom(app: &AppHandle, f: impl FnOnce(f64) -> f64) {
    let Some(window) = app.get_webview_window(MAIN) else { return };
    let mut z = ZOOM.lock().unwrap();
    *z = f(*z).clamp(0.5, 2.5);
    let _ = window.set_zoom(*z);
}

pub fn handle(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        SWITCH => show_launcher(app),
        QUIT => app.exit(0),
        RELOAD => {
            if let Some(w) = app.get_webview_window(MAIN) {
                let _ = w.reload();
            }
        }
        ZOOM_IN => zoom(app, |z| z + 0.1),
        ZOOM_OUT => zoom(app, |z| z - 0.1),
        ZOOM_RESET => zoom(app, |_| 1.0),
        DEVTOOLS =>
        {
            #[cfg(debug_assertions)]
            if let Some(w) = app.get_webview_window(MAIN) {
                w.open_devtools();
            }
        }
        _ => {}
    }
}
