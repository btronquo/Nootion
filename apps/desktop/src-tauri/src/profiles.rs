//! The servers this app knows, kept in `profiles.json` in the app's config folder
//! (`%APPDATA%\app.nootion.desktop`, `~/Library/Application Support/app.nootion.desktop`, `~/.config/app.nootion.desktop`).

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    /// Origin of the server, normalized by `probe::normalize_url`: `https://notes.example.org`.
    pub url: String,
    /// Version the server reported the last time it was checked.
    #[serde(default)]
    pub version: Option<String>,
    /// Milliseconds since the epoch.
    #[serde(default)]
    pub last_used_at: Option<u64>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Profiles {
    #[serde(default)]
    pub profiles: Vec<Profile>,
    /// The profile opened last, reopened at start.
    #[serde(default)]
    pub last: Option<String>,
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub struct Store {
    path: PathBuf,
}

impl Store {
    pub fn new(dir: &Path) -> Self {
        Self { path: dir.join("profiles.json") }
    }

    /// A missing or unreadable file is an empty list: the user adds a server again rather than being stuck.
    pub fn load(&self) -> Profiles {
        fs::read_to_string(&self.path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }

    /// Written to a temporary file then renamed, so a crash never leaves half a file.
    pub fn save(&self, profiles: &Profiles) -> Result<(), String> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let tmp = self.path.with_extension("json.tmp");
        let json = serde_json::to_string_pretty(profiles).map_err(|e| e.to_string())?;
        fs::write(&tmp, json).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &self.path).map_err(|e| e.to_string())
    }
}

impl Profiles {
    /// Adds a server, or updates the one with the same address (no duplicates).
    pub fn upsert(&mut self, name: &str, url: &str, version: Option<String>) -> Profile {
        let name = if name.trim().is_empty() { default_name(url) } else { name.trim().to_string() };
        if let Some(p) = self.profiles.iter_mut().find(|p| p.url == url) {
            p.name = name;
            p.version = version.or(p.version.take());
            return p.clone();
        }
        let p = Profile { id: uuid::Uuid::new_v4().to_string(), name, url: url.to_string(), version, last_used_at: None };
        self.profiles.push(p.clone());
        p
    }

    pub fn remove(&mut self, id: &str) {
        self.profiles.retain(|p| p.id != id);
        if self.last.as_deref() == Some(id) {
            self.last = None;
        }
    }

    pub fn touch(&mut self, id: &str) -> Option<Profile> {
        let p = self.profiles.iter_mut().find(|p| p.id == id)?;
        p.last_used_at = Some(now_ms());
        self.last = Some(id.to_string());
        Some(p.clone())
    }

    /// Most recently used first, then by name.
    pub fn sorted(&self) -> Vec<Profile> {
        let mut list = self.profiles.clone();
        list.sort_by(|a, b| b.last_used_at.cmp(&a.last_used_at).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        list
    }
}

/// "notes.example.org" for "https://notes.example.org".
fn default_name(url: &str) -> String {
    url::Url::parse(url).ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_else(|| url.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_keeps_one_profile_per_address() {
        let mut p = Profiles::default();
        let a = p.upsert("", "https://notes.example.org", Some("3.4.0".into()));
        assert_eq!(a.name, "notes.example.org");
        let b = p.upsert("Maison", "https://notes.example.org", None);
        assert_eq!(a.id, b.id);
        assert_eq!(b.name, "Maison");
        assert_eq!(b.version.as_deref(), Some("3.4.0"));
        assert_eq!(p.profiles.len(), 1);
    }

    #[test]
    fn remove_forgets_the_last_opened() {
        let mut p = Profiles::default();
        let a = p.upsert("A", "https://a.example", None);
        p.touch(&a.id);
        assert_eq!(p.last.as_deref(), Some(a.id.as_str()));
        p.remove(&a.id);
        assert!(p.last.is_none() && p.profiles.is_empty());
    }

    #[test]
    fn store_round_trip_and_bad_file() {
        let dir = std::env::temp_dir().join(format!("nootion-desktop-test-{}", uuid::Uuid::new_v4()));
        let store = Store::new(&dir);
        assert_eq!(store.load(), Profiles::default());
        let mut p = Profiles::default();
        p.upsert("A", "https://a.example", None);
        store.save(&p).unwrap();
        assert_eq!(store.load(), p);
        fs::write(dir.join("profiles.json"), "{not json").unwrap();
        assert_eq!(store.load(), Profiles::default());
        let _ = fs::remove_dir_all(dir);
    }
}
