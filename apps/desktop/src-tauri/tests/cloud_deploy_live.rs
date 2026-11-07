//! @feature CLOUD-08 Deploy flow for the user's Cloudflare account
//!
//! Owns: one live deploy and uninstall through the flow's own code, under a throwaway
//! `conducted-dev-c08-<time>` name, on the owner's Cloudflare account.
//!
//! Behaviour: D109 and docs/research/cloud-spike-2026-11-06.md. The test uses the app's bundled
//! deploy inputs (`resources/cloud`, made by `pnpm cloud:prepare`), the real `wrangler` login and
//! the user's Docker. It aims to prove the shipped path, not a stand-in: the Worker uploads the
//! pre-bundled script, Docker builds the sandbox image from the bundled Dockerfile, and the
//! uninstall removes the Worker, its container application, its images and its bucket.
//!
//! `#[ignore]` because it writes to a real Cloudflare account and needs Docker; run it with
//! `cargo test --test cloud_deploy_live -- --ignored --nocapture`. It deletes everything it made
//! even when the deploy fails, and it prints the numbers the research note records.
//!
//! Keys only piped: the pairing token is passed to wrangler through the same secret file the app
//! uses and is never printed.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use conducted_lib::cloud::{
    WRANGLER_TIMEOUT, Wrangler, bucket_names, container_id, deploy_worker, image_refs,
    make_pairing_token, uninstall_worker,
};

/// A name no other run uses, and one the brief allows: `conducted-dev-c08-<hhmmss>`.
fn live_name() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default();
    format!(
        "conducted-dev-c08-{:02}{:02}{:02}",
        (seconds / 3600) % 24,
        (seconds / 60) % 60,
        seconds % 60
    )
}

/// The repository's pinned wrangler (4.158), so the run tests the config it supports. The app
/// itself uses the user's wrangler and refuses one older than that.
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

/// Runs one read-only wrangler list and returns its stdout, or an empty string on failure.
fn listed(wrangler: &Wrangler, resources: &Path, args: &[&str]) -> String {
    let owned: Vec<String> = args.iter().map(|arg| (*arg).to_string()).collect();
    wrangler
        .run(&owned, resources, None, WRANGLER_TIMEOUT)
        .map(|output| output.stdout)
        .unwrap_or_default()
}

/// The Worker's own answer to its pairing check, proving the URL serves this Worker.
fn pair_answered(url: &str, token: &str) -> bool {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .expect("a client");
    tauri::async_runtime::block_on(async move {
        let response = client
            .get(format!("{url}/pair"))
            .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
            .send()
            .await;
        match response {
            Ok(answer) => {
                let status = answer.status();
                let body = answer.text().await.unwrap_or_default();
                status.is_success() && body.contains("conducted-cloud")
            }
            Err(_) => false,
        }
    })
}

#[test]
#[ignore = "live: deploys to the owner's Cloudflare account with Docker, then deletes everything"]
fn deploy_and_uninstall_through_the_flow() {
    let name = live_name();
    let resources = resources();
    assert!(
        resources.join("worker.js").is_file() && resources.join("sandbox/Dockerfile").is_file(),
        "the deploy inputs are missing: run `pnpm cloud:prepare` first"
    );
    let token = make_pairing_token().expect("a pairing token");
    let wrangler = live_wrangler();

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
    let paired = url
        .as_deref()
        .map(|url| pair_answered(url, &token))
        .unwrap_or(false);

    let uninstall_began = Instant::now();
    let removed = uninstall_worker(&wrangler, &resources, &name);
    let uninstall_ms = uninstall_began.elapsed().as_millis();

    // Every list must be clear of this run's resources.
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
    let url_gone = url
        .as_deref()
        .map(|url| !pair_answered(url, &token))
        .unwrap_or(true);

    println!(
        "CLOUD-08 live: name={name} deploy_ms={deploy_ms} pair_answered={paired} \
         uninstall_ms={uninstall_ms} worker_url_gone={url_gone} \
         container_left={container_left} images_left={images_left:?} bucket_left={bucket_left}"
    );

    assert!(deployed.is_ok(), "the deploy failed");
    assert!(
        paired,
        "the deployed Worker did not answer its pairing check"
    );
    assert!(removed.is_ok(), "the uninstall failed: {removed:?}");
    assert!(url_gone, "the Worker URL still answers after the uninstall");
    assert!(!container_left, "the container application is still there");
    assert!(
        images_left.is_empty(),
        "images are still there: {images_left:?}"
    );
    assert!(!bucket_left, "the bucket is still there");
}
