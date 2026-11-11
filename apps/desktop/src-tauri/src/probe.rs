//! Checks that an address typed by the user is a Nootion server before it is saved.

use std::time::Duration;

use serde::{Deserialize, Serialize};

/// Why a server can't be used. The launcher turns `code` into a sentence in the user's language.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProbeError {
    pub code: &'static str,
    pub detail: Option<String>,
}

impl ProbeError {
    fn new(code: &'static str, detail: impl Into<Option<String>>) -> Self {
        Self { code, detail: detail.into() }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProbeOk {
    /// The server's origin, as it will be saved and opened.
    pub url: String,
    pub version: Option<String>,
    /// http:// to a machine that isn't this one: passwords would travel unencrypted.
    pub insecure: bool,
}

#[derive(Deserialize)]
struct Health {
    ok: bool,
    version: Option<String>,
}

/// "notes.example.org/" → "https://notes.example.org". Only the origin is kept: Nootion is served at the root.
pub fn normalize_url(input: &str) -> Result<url::Url, ProbeError> {
    let s = input.trim();
    if s.is_empty() {
        return Err(ProbeError::new("invalid_url", None));
    }
    let with_scheme = if s.contains("://") { s.to_string() } else { format!("https://{s}") };
    let u = url::Url::parse(&with_scheme).map_err(|e| ProbeError::new("invalid_url", e.to_string()))?;
    if u.scheme() != "https" && u.scheme() != "http" {
        return Err(ProbeError::new("invalid_url", format!("scheme {}", u.scheme())));
    }
    if u.host_str().is_none_or(str::is_empty) {
        return Err(ProbeError::new("invalid_url", None));
    }
    let origin = u.origin().ascii_serialization();
    url::Url::parse(&origin).map_err(|e| ProbeError::new("invalid_url", e.to_string()))
}

fn is_local(u: &url::Url) -> bool {
    match u.host() {
        Some(url::Host::Domain(d)) => d == "localhost" || d.ends_with(".localhost"),
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    }
}

/// Origin without the trailing slash `Url` adds.
pub fn origin_string(u: &url::Url) -> String {
    u.origin().ascii_serialization()
}

/// Without a scheme, https is tried first, then http (a server on the local network often has no certificate).
/// A server that doesn't answer at all isn't tried twice: that would double the wait.
pub async fn probe(input: &str) -> Result<ProbeOk, ProbeError> {
    let first = probe_url(normalize_url(input)?).await;
    match first {
        Err(ref e) if !input.contains("://") && matches!(e.code, "unreachable" | "tls") => {
            let http = normalize_url(&format!("http://{}", input.trim()))?;
            probe_url(http).await.map_err(|_| first.unwrap_err())
        }
        other => other,
    }
}

async fn probe_url(base: url::Url) -> Result<ProbeOk, ProbeError> {
    let health = base.join("/api/health").map_err(|e| ProbeError::new("invalid_url", e.to_string()))?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent(concat!("Nootion-Desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| ProbeError::new("unreachable", e.to_string()))?;
    let res = client.get(health.clone()).send().await.map_err(|e| {
        let text = format!("{e:?}");
        let code = if e.is_timeout() {
            "timeout"
        } else if text.contains("certificate") || text.contains("Certificate") || text.contains("tls") {
            "tls"
        } else {
            "unreachable"
        };
        ProbeError::new(code, e.to_string())
    })?;
    if !res.status().is_success() {
        return Err(ProbeError::new("not_nootion", format!("HTTP {}", res.status().as_u16())));
    }
    // A redirect to another address (http → https, a new domain) is followed: keep where it led.
    let landed = res.url().clone();
    let body: Health = res.json().await.map_err(|_| ProbeError::new("not_nootion", None))?;
    if !body.ok {
        return Err(ProbeError::new("not_nootion", None));
    }
    let insecure = landed.scheme() == "http" && !is_local(&landed);
    Ok(ProbeOk { url: origin_string(&landed), version: body.version, insecure })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_addresses() {
        let n = |s: &str| normalize_url(s).map(|u| origin_string(&u));
        assert_eq!(n("notes.example.org").unwrap(), "https://notes.example.org");
        assert_eq!(n(" https://notes.example.org/some/page?x=1 ").unwrap(), "https://notes.example.org");
        assert_eq!(n("http://192.168.1.20:3000/").unwrap(), "http://192.168.1.20:3000");
        assert_eq!(n("HTTPS://Notes.Example.org:443").unwrap(), "https://notes.example.org");
        assert_eq!(n("").unwrap_err().code, "invalid_url");
        assert_eq!(n("ftp://x.org").unwrap_err().code, "invalid_url");
        assert_eq!(n("javascript:alert(1)").unwrap_err().code, "invalid_url");
    }

    #[test]
    fn local_addresses() {
        assert!(is_local(&url::Url::parse("http://localhost:3000").unwrap()));
        assert!(is_local(&url::Url::parse("http://127.0.0.1:3000").unwrap()));
        assert!(!is_local(&url::Url::parse("http://192.168.1.20").unwrap()));
    }

    /// A tiny HTTP server that answers every request with `body`, once per connection.
    async fn serve(body: &'static str) -> u16 {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else { return };
                let mut buf = [0u8; 2048];
                let _ = sock.read(&mut buf).await;
                let res = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = sock.write_all(res.as_bytes()).await;
            }
        });
        port
    }

    #[tokio::test]
    async fn finds_a_nootion_server_over_http_without_a_scheme() {
        let port = serve(r#"{"ok":true,"version":"3.4.0"}"#).await;
        let ok = probe(&format!("127.0.0.1:{port}")).await.unwrap();
        assert_eq!(ok.url, format!("http://127.0.0.1:{port}"));
        assert_eq!(ok.version.as_deref(), Some("3.4.0"));
        assert!(!ok.insecure);
    }

    #[tokio::test]
    async fn refuses_another_server() {
        let port = serve(r#"<html>hello</html>"#).await;
        assert_eq!(probe(&format!("http://127.0.0.1:{port}")).await.unwrap_err().code, "not_nootion");
        let port = serve(r#"{"ok":false}"#).await;
        assert_eq!(probe(&format!("http://127.0.0.1:{port}")).await.unwrap_err().code, "not_nootion");
    }

    #[tokio::test]
    async fn unreachable_server() {
        let e = probe("http://127.0.0.1:9").await.unwrap_err();
        assert_eq!(e.code, "unreachable");
    }
}
