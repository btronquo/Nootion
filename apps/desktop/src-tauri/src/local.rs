//! "On this computer": Nootion's own server, run by the app in the background, with its data in the app's folder.
//!
//! The server is the same as on a NAS (apps/server), run by a Node binary shipped with the app. It listens on
//! 127.0.0.1 only, on a port chosen once and kept (the web app's offline data and session belong to that address).
//! The app signs its user in without a password: see apps/server/src/routes/desktop.ts.

use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use rand::RngCore;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// Kept between launches, in `local/settings.json`.
#[derive(Debug, Default, Serialize, Deserialize)]
struct Settings {
    port: Option<u16>,
    /// The server's APP_SECRET: it encrypts the secrets stored in the database, so it never changes.
    secret: Option<String>,
}

struct Running {
    child: Child,
    port: u16,
    token: String,
}

#[derive(Default)]
pub struct Local {
    running: Mutex<Option<Running>>,
}

fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::rng().fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn port_is_free(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn free_port() -> Result<u16, String> {
    let l = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    Ok(l.local_addr().map_err(|e| e.to_string())?.port())
}

fn load_settings(path: &Path) -> Settings {
    fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save_settings(path: &Path, settings: &Settings) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// The Node binary shipped next to the app (`externalBin`, named so as not to replace a system `node` in /usr/bin),
/// or the one on the PATH while developing.
fn node_binary() -> PathBuf {
    let exe = |name: &str| if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) {
        let shipped = dir.join(exe("nootion-node"));
        if shipped.exists() {
            return shipped;
        }
    }
    PathBuf::from(exe("node"))
}

/// The server and the web app shipped as resources (`local-server/` in tauri.conf.json).
fn server_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().resource_dir().map_err(|e| e.to_string())?.join("local-server");
    if dir.join("dist").join("index.js").exists() {
        return Ok(dir);
    }
    // While developing: the folder prepared by scripts/prepare-local-server.mjs.
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("local-server");
    if dev.join("dist").join("index.js").exists() {
        return Ok(dev);
    }
    Err("server_missing".into())
}

pub fn available(app: &AppHandle) -> bool {
    server_dir(app).is_ok()
}

fn user_name() -> String {
    std::env::var("USERNAME").or_else(|_| std::env::var("USER")).unwrap_or_else(|_| "Nootion".into())
}

impl Local {
    /// Starts the server if it isn't running, waits until it answers, and returns its port and token.
    pub async fn ensure_started(&self, app: &AppHandle) -> Result<(u16, String), String> {
        if let Some((port, token)) = self.alive() {
            return Ok((port, token));
        }
        let (port, token) = self.spawn(app)?;
        wait_until_ready(port).await?;
        Ok((port, token))
    }

    fn alive(&self) -> Option<(u16, String)> {
        let mut guard = self.running.lock().unwrap();
        let running = guard.as_mut()?;
        match running.child.try_wait() {
            Ok(None) => Some((running.port, running.token.clone())),
            _ => {
                *guard = None;
                None
            }
        }
    }

    fn spawn(&self, app: &AppHandle) -> Result<(u16, String), String> {
        let base = app.path().app_data_dir().map_err(|e| e.to_string())?.join("local");
        let data = base.join("data");
        fs::create_dir_all(&data).map_err(|e| e.to_string())?;
        let settings_path = base.join("settings.json");
        let mut settings = load_settings(&settings_path);
        let port = match settings.port {
            Some(p) if port_is_free(p) => p,
            _ => free_port()?,
        };
        settings.port = Some(port);
        let secret = settings.secret.get_or_insert_with(|| random_hex(32)).clone();
        save_settings(&settings_path, &settings)?;

        let server = server_dir(app)?;
        let token = random_hex(32);
        let log = fs::OpenOptions::new().create(true).append(true).open(base.join("server.log")).map_err(|e| e.to_string())?;
        let mut cmd = Command::new(node_binary());
        cmd.arg(server.join("dist").join("index.js"))
            .current_dir(&server)
            .env("NODE_ENV", "production")
            .env("HOST", "127.0.0.1")
            .env("PORT", port.to_string())
            .env("APP_URL", format!("http://127.0.0.1:{port}"))
            .env("APP_SECRET", &secret)
            .env("DATA_DIR", &data)
            .env("WEB_DIR", server.join("web"))
            .env("UPDATE_CHECK", "false")
            .env("NOOTION_VERSION", env!("CARGO_PKG_VERSION"))
            .env("TRUST_PROXY", "false")
            .env("NOOTION_DESKTOP_TOKEN", &token)
            .env("NOOTION_DESKTOP_USER", user_name())
            .env("NOOTION_DESKTOP_PARENT_PID", std::process::id().to_string())
            .stdin(Stdio::null())
            .stdout(log.try_clone().map_err(|e| e.to_string())?)
            .stderr(log);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let child = cmd.spawn().map_err(|e| format!("spawn_failed: {e}"))?;
        *self.running.lock().unwrap() = Some(Running { child, port, token: token.clone() });
        Ok((port, token))
    }

    /// Asks the server to close its database and stop, then makes sure it did.
    pub fn stop(&self) {
        let Some(mut running) = self.running.lock().unwrap().take() else { return };
        let url = format!("http://127.0.0.1:{}/api/desktop/quit", running.port);
        let _ = reqwest::blocking::Client::new()
            .post(url)
            .header("x-nootion-desktop-token", &running.token)
            .timeout(Duration::from_secs(3))
            .send();
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if let Ok(Some(_)) = running.child.try_wait() {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let _ = running.child.kill();
        let _ = running.child.wait();
    }
}

async fn wait_until_ready(port: u16) -> Result<(), String> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(2)).build().map_err(|e| e.to_string())?;
    let url = format!("http://127.0.0.1:{port}/api/health");
    let deadline = Instant::now() + Duration::from_secs(60);
    while Instant::now() < deadline {
        if let Ok(res) = client.get(&url).send().await {
            if res.status().is_success() {
                return Ok(());
            }
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    Err("start_timeout".into())
}

/// A one-time address that signs the user in and lands on their home page.
pub async fn sign_in_url(port: u16, token: &str) -> Result<String, String> {
    #[derive(Deserialize)]
    struct Ticket {
        ticket: String,
    }
    let res = reqwest::Client::new()
        .post(format!("http://127.0.0.1:{port}/api/desktop/ticket"))
        .header("x-nootion-desktop-token", token)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let ticket: Ticket = res.error_for_status().map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
    Ok(format!("http://127.0.0.1:{port}/api/desktop/session?ticket={}", ticket.ticket))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_round_trip() {
        let dir = std::env::temp_dir().join(format!("nootion-local-test-{}", random_hex(4)));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        assert!(load_settings(&path).port.is_none());
        save_settings(&path, &Settings { port: Some(41234), secret: Some("s".into()) }).unwrap();
        let s = load_settings(&path);
        assert_eq!((s.port, s.secret.as_deref()), (Some(41234), Some("s")));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn ports() {
        let p = free_port().unwrap();
        assert!(port_is_free(p));
        let _held = TcpListener::bind(("127.0.0.1", p)).unwrap();
        assert!(!port_is_free(p));
        assert_eq!(random_hex(32).len(), 64);
    }
}
