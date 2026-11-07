//! @feature CLOUD-11 Local mirror and file sync for a cloud workspace
//!
//! Owns: one live run of the Worker paths CLOUD-11's second part depends on, under a throwaway
//! `conducted-dev-c11t-<time>` name on the owner's Cloudflare account: a text file, a binary file
//! and a file over 2 MiB through `/files`, and a terminal command through `/terminal` (the stream
//! a run-script uses in the sandbox). The desktop's Local terminal and Local run variant run on
//! this Mac; this run proves the sandbox and Worker half they read from.
//!
//! Behaviour: D120 and docs/research/cloud-spike-2026-11-06.md. It uses the app's bundled deploy
//! inputs (`resources/cloud`, made by `pnpm cloud:prepare`), the real `wrangler` login and Docker.
//!
//! `#[ignore]` because it writes to a real Cloudflare account and needs Docker; run it with
//! `cargo test --test cloud_c11_live -- --ignored --nocapture`. It deletes everything it made even
//! when a step fails. Keys only piped: the pairing token is passed to wrangler through the same
//! secret file the app uses and is never printed.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

use conducted_lib::cloud::{
    WRANGLER_TIMEOUT, Wrangler, bucket_names, container_id, deploy_worker, image_refs,
    make_pairing_token, uninstall_worker,
};

fn live_name() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default();
    format!(
        "conducted-dev-c11t-{:02}{:02}{:02}",
        (seconds / 3600) % 24,
        (seconds / 60) % 60,
        seconds % 60
    )
}

fn live_wrangler() -> Wrangler {
    let pinned =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../cloud/node_modules/.bin/wrangler");
    Wrangler {
        program: pinned.to_string_lossy().into_owned(),
    }
}

fn resources() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/cloud")
}

fn listed(wrangler: &Wrangler, resources: &Path, args: &[&str]) -> String {
    let owned: Vec<String> = args.iter().map(|arg| (*arg).to_string()).collect();
    wrangler
        .run(&owned, resources, None, WRANGLER_TIMEOUT)
        .map(|output| output.stdout)
        .unwrap_or_default()
}

/// One authenticated JSON call to the Worker.
async fn call(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    path: &str,
    body: Option<serde_json::Value>,
) -> (u16, String) {
    let mut request = client
        .post(format!("{url}{path}"))
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"));
    if let Some(body) = body {
        request = request.json(&body);
    }
    match request.send().await {
        Ok(answer) => {
            let status = answer.status().as_u16();
            (status, answer.text().await.unwrap_or_default())
        }
        Err(error) => (0, error.to_string()),
    }
}

/// Runs one command on the Worker's terminal stream and returns its output and exit code.
async fn terminal_command(
    url: &str,
    token: &str,
    workspace: &str,
    command: &[&str],
) -> Result<(String, Option<i64>), String> {
    let ws_url = format!(
        "{}/w/{workspace}/terminal",
        url.replacen("https://", "wss://", 1)
    );
    let mut request = ws_url
        .into_client_request()
        .map_err(|error| format!("bad terminal URL: {error}"))?;
    request.headers_mut().insert(
        tokio_tungstenite::tungstenite::http::header::AUTHORIZATION,
        format!("Bearer {token}")
            .parse()
            .map_err(|error| format!("bad token header: {error}"))?,
    );
    let (mut socket, _answer) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|error| format!("terminal connect failed: {error}"))?;
    socket
        .send(Message::Text(
            json!({
                "type": "start",
                "cwd": "/workspace",
                "cols": 80,
                "rows": 24,
                "command": command,
            })
            .to_string()
            .into(),
        ))
        .await
        .map_err(|error| format!("terminal start failed: {error}"))?;

    let mut output = String::new();
    let deadline = Duration::from_secs(120);
    let result = tokio::time::timeout(deadline, async {
        let mut sent = false;
        while let Some(frame) = socket.next().await {
            let text = match frame.map_err(|error| format!("terminal frame: {error}"))? {
                Message::Text(text) => text.to_string(),
                Message::Close(_) => break,
                _ => continue,
            };
            let message: serde_json::Value =
                serde_json::from_str(&text).map_err(|error| format!("terminal JSON: {error}"))?;
            match message["type"].as_str() {
                Some("ready") => {
                    if !sent {
                        sent = true;
                        let script = command.join(" ") + "\nexit\n";
                        socket
                            .send(Message::Text(
                                json!({ "type": "input", "data": script })
                                    .to_string()
                                    .into(),
                            ))
                            .await
                            .map_err(|error| format!("terminal input: {error}"))?;
                    }
                }
                Some("data") => {
                    let bytes = base64::engine::general_purpose::STANDARD
                        .decode(message["data"].as_str().unwrap_or(""))
                        .unwrap_or_default();
                    output.push_str(&String::from_utf8_lossy(&bytes));
                }
                Some("exit") => return Ok(message["exitCode"].as_i64()),
                Some("error") => return Err(message["message"].as_str().unwrap_or("").to_string()),
                _ => {}
            }
        }
        Ok(None)
    })
    .await
    .map_err(|_| "terminal timed out".to_string())??;
    Ok((output, result))
}

#[test]
#[ignore = "live: deploys to the owner's Cloudflare account with Docker, then deletes everything"]
fn files_and_terminal_on_a_real_sandbox() {
    let name = live_name();
    let resources = resources();
    assert!(
        resources.join("worker.js").is_file() && resources.join("sandbox/Dockerfile").is_file(),
        "the deploy inputs are missing: run `pnpm cloud:prepare` first"
    );
    let token = make_pairing_token().expect("a pairing token");
    let wrangler = live_wrangler();
    let workspace = format!("c11live{}", &name[name.len() - 6..]);

    let deploy_began = Instant::now();
    let deployed = deploy_worker(&wrangler, &resources, &name, &token);
    let deploy_ms = deploy_began.elapsed().as_millis();
    let url = match &deployed {
        Ok(url) => Some(url.clone()),
        Err(error) => {
            eprintln!("deploy failed ({deploy_ms} ms): {error:?}");
            None
        }
    };

    let mut result: Result<(), String> = Err("the deploy failed".into());
    let mut start_ms = 0u128;
    let mut file_ms = 0u128;
    let mut terminal_ms = 0u128;
    if let Some(url) = &url {
        result = tauri::async_runtime::block_on(async {
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(180))
                .build()
                .map_err(|error| error.to_string())?;
            // The first start after a deploy pulls the new image and can outlast Cloudflare's
            // 100-second request window; a retry finds the container already running.
            let began = Instant::now();
            let mut last = String::new();
            let mut started = false;
            for _ in 0..3 {
                let (status, body) =
                    call(&client, url, &token, &format!("/w/{workspace}/start"), None).await;
                if status == 200 {
                    started = true;
                    break;
                }
                last = format!("start answered {status}: {body}");
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
            start_ms = began.elapsed().as_millis();
            if !started {
                return Err(last);
            }

            let began = Instant::now();
            let text_path = "/workspace/notes.txt";
            let (status, body) = call(
                &client,
                url,
                &token,
                &format!("/w/{workspace}/files"),
                Some(json!({ "operation": "write", "path": text_path, "text": "hello c11" })),
            )
            .await;
            if status != 200 {
                return Err(format!("write answered {status}: {body}"));
            }
            let binary = [0x89u8, 0x50, 0x00, 0xff, 0x10];
            let (status, body) = call(
                &client,
                url,
                &token,
                &format!("/w/{workspace}/files"),
                Some(json!({
                    "operation": "writeBytes",
                    "path": "/workspace/logo.bin",
                    "base64": base64::engine::general_purpose::STANDARD.encode(binary),
                })),
            )
            .await;
            if status != 200 {
                return Err(format!("writeBytes answered {status}: {body}"));
            }
            let large = "x".repeat(3 * 1024 * 1024);
            let (status, body) = call(
                &client,
                url,
                &token,
                &format!("/w/{workspace}/files"),
                Some(json!({ "operation": "write", "path": "/workspace/big.txt", "text": large })),
            )
            .await;
            if status != 200 {
                return Err(format!("large write answered {status}: {body}"));
            }
            let (status, body) = call(
                &client,
                url,
                &token,
                &format!("/w/{workspace}/files"),
                Some(json!({ "operation": "readBytes", "path": "/workspace/logo.bin" })),
            )
            .await;
            if status != 200 {
                return Err(format!("readBytes answered {status}: {body}"));
            }
            let read: serde_json::Value =
                serde_json::from_str(&body).map_err(|error| error.to_string())?;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(read["base64"].as_str().unwrap_or(""))
                .map_err(|error| error.to_string())?;
            if bytes != binary {
                return Err(format!("binary round trip differed: {bytes:?}"));
            }
            let (status, body) = call(
                &client,
                url,
                &token,
                &format!("/w/{workspace}/files"),
                Some(json!({ "operation": "list", "path": "/workspace" })),
            )
            .await;
            if status != 200 {
                return Err(format!("list answered {status}: {body}"));
            }
            let listed: serde_json::Value =
                serde_json::from_str(&body).map_err(|error| error.to_string())?;
            let entries = listed["entries"]
                .as_array()
                .ok_or_else(|| "list had no entries".to_string())?;
            let sizes: Vec<(String, i64)> = entries
                .iter()
                .filter_map(|entry| {
                    Some((entry["path"].as_str()?.to_string(), entry["size"].as_i64()?))
                })
                .collect();
            if !sizes.iter().any(|(path, _)| path == "/workspace/big.txt") {
                return Err(format!("the large file is not listed: {sizes:?}"));
            }
            // A file over the limit is refused by the Worker itself, before it reads it.
            let (status, body) = call(
                &client,
                url,
                &token,
                &format!("/w/{workspace}/exec"),
                Some(json!({
                    "program": "dd",
                    "args": ["if=/dev/zero", "of=/workspace/over.bin", "bs=1048576", "count=20"],
                    "cwd": "/workspace",
                })),
            )
            .await;
            if status != 200 {
                return Err(format!("dd answered {status}: {body}"));
            }
            let (status, body) = call(
                &client,
                url,
                &token,
                &format!("/w/{workspace}/files"),
                Some(json!({ "operation": "readBytes", "path": "/workspace/over.bin" })),
            )
            .await;
            if status != 500 || !body.contains("cloud read limit") {
                return Err(format!("an over-limit read answered {status}: {body}"));
            }
            let _ = call(
                &client,
                url,
                &token,
                &format!("/w/{workspace}/files"),
                Some(json!({ "operation": "trash", "path": "/workspace/over.bin" })),
            )
            .await;
            file_ms = began.elapsed().as_millis();

            let began = Instant::now();
            let (output, code) = terminal_command(
                url,
                &token,
                &workspace,
                &["/bin/bash", "-l", "-c", "echo TERMOK && pwd"],
            )
            .await?;
            if !output.contains("TERMOK") || !output.contains("/workspace") || code != Some(0) {
                return Err(format!("terminal output was {output:?} with exit {code:?}"));
            }
            terminal_ms = began.elapsed().as_millis();
            Ok(())
        });
    }

    let uninstall_began = Instant::now();
    let removed = uninstall_worker(&wrangler, &resources, &name);
    let uninstall_ms = uninstall_began.elapsed().as_millis();

    let containers = listed(&wrangler, &resources, &["containers", "list", "--json"]);
    let images = listed(
        &wrangler,
        &resources,
        &["containers", "images", "list", "--json"],
    );
    let buckets = listed(&wrangler, &resources, &["r2", "bucket", "list"]);
    let container_left = container_id(&containers, &format!("{name}-sandbox")).is_some();
    let images_left = image_refs(&images, &name);
    let bucket_left = bucket_names(&buckets).iter().any(|bucket| bucket == &name);

    println!(
        "CLOUD-11 live: name={name} deploy_ms={deploy_ms} start_ms={start_ms} file_ms={file_ms} \
         terminal_ms={terminal_ms} uninstall_ms={uninstall_ms} container_left={container_left} \
         images_left={images_left:?} bucket_left={bucket_left} result={result:?}"
    );

    assert!(deployed.is_ok(), "the deploy failed");
    assert!(result.is_ok(), "the live checks failed: {result:?}");
    assert!(removed.is_ok(), "the uninstall failed: {removed:?}");
    assert!(!container_left, "the container application is still there");
    assert!(
        images_left.is_empty(),
        "images are still there: {images_left:?}"
    );
    assert!(!bucket_left, "the bucket is still there");
}

/// Measures the largest file one `readBytes` answer carries reliably on the live Worker.
#[test]
#[ignore = "live: deploys to the owner's Cloudflare account with Docker, then deletes everything"]
fn measure_the_read_bytes_limit() {
    let name = live_name();
    let resources = resources();
    assert!(
        resources.join("worker.js").is_file() && resources.join("sandbox/Dockerfile").is_file(),
        "the deploy inputs are missing: run `pnpm cloud:prepare` first"
    );
    let token = make_pairing_token().expect("a pairing token");
    let wrangler = live_wrangler();
    let workspace = format!("c11size{}", &name[name.len() - 6..]);

    let deployed = deploy_worker(&wrangler, &resources, &name, &token);
    let mut measurements: Vec<(u64, Result<usize, String>)> = Vec::new();
    if let Ok(url) = &deployed {
        let result = tauri::async_runtime::block_on(async {
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(240))
                .build()
                .map_err(|error| error.to_string())?;
            let mut started = false;
            for _ in 0..3 {
                let (status, _body) =
                    call(&client, url, &token, &format!("/w/{workspace}/start"), None).await;
                if status == 200 {
                    started = true;
                    break;
                }
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
            if !started {
                return Err("the sandbox did not start".to_string());
            }
            for mib in [16u64, 20, 22, 23, 24] {
                let (status, body) = call(
                    &client,
                    url,
                    &token,
                    &format!("/w/{workspace}/exec"),
                    Some(json!({
                        "program": "dd",
                        "args": [
                            "if=/dev/zero",
                            "of=/workspace/probe.bin",
                            "bs=1048576",
                            &format!("count={mib}"),
                        ],
                        "cwd": "/workspace",
                    })),
                )
                .await;
                if status != 200 {
                    measurements.push((mib, Err(format!("dd answered {status}: {body}"))));
                    continue;
                }
                let (status, body) = call(
                    &client,
                    url,
                    &token,
                    &format!("/w/{workspace}/files"),
                    Some(json!({ "operation": "readBytes", "path": "/workspace/probe.bin" })),
                )
                .await;
                let outcome = if status != 200 {
                    Err(format!("readBytes answered {status}: {body}"))
                } else {
                    let parsed: serde_json::Value =
                        serde_json::from_str(&body).map_err(|error| error.to_string())?;
                    base64::engine::general_purpose::STANDARD
                        .decode(parsed["base64"].as_str().unwrap_or(""))
                        .map(|bytes| bytes.len())
                        .map_err(|error| error.to_string())
                };
                measurements.push((mib, outcome));
                let _ = call(
                    &client,
                    url,
                    &token,
                    &format!("/w/{workspace}/files"),
                    Some(json!({ "operation": "trash", "path": "/workspace/probe.bin" })),
                )
                .await;
            }
            Ok(())
        });
        eprintln!("measurement run: {result:?}");
    }

    let removed = uninstall_worker(&wrangler, &resources, &name);
    let containers = listed(&wrangler, &resources, &["containers", "list", "--json"]);
    let images = listed(
        &wrangler,
        &resources,
        &["containers", "images", "list", "--json"],
    );
    let buckets = listed(&wrangler, &resources, &["r2", "bucket", "list"]);
    let container_left = container_id(&containers, &format!("{name}-sandbox")).is_some();
    let images_left = image_refs(&images, &name);
    let bucket_left = bucket_names(&buckets).iter().any(|bucket| bucket == &name);
    println!(
        "CLOUD-11 readBytes limit: name={name} measurements={measurements:?} \
         uninstall_ok={} container_left={container_left} images_left={images_left:?} \
         bucket_left={bucket_left}",
        removed.is_ok()
    );
    assert!(deployed.is_ok(), "the deploy failed");
    assert!(removed.is_ok(), "the uninstall failed: {removed:?}");
    assert!(!container_left);
    assert!(images_left.is_empty());
    assert!(!bucket_left);
}
