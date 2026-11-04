//! @feature PLAT-20 Attachments: copy dropped files, shrink large images
//!
//! Owns: copying a file the user dropped or picked into the app's draft folder, and shrinking
//! images that are too large for the agents.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 (`attachments.rs`:
//! `materialize_local_path_attachment`, `resize_image`) and D1 (`draft-attachments/`). services-map.md
//! 5A.6: drafts live at `draft-attachments/<workspace>/<short id>/<name>`; images over a pixel
//! limit of 7800 or a size of 4.5 MiB are rescaled and re-encoded as JPEG at quality 0.85, then
//! 0.7 if still too big.
//!
//! Must handle:
//! - The UI chooses `destination_path` (it knows the workspace and the id). Rust checks that it
//!   lies under `<app data>/draft-attachments/` and fails with `attachment_bad_destination`
//!   otherwise, so a path from the webview cannot write elsewhere.
//! - The copy is atomic: write to a temp file beside the destination, then rename. A failed copy
//!   leaves nothing behind.
//! - The source is copied, never moved. A source that is a folder fails with
//!   `attachment_is_directory`. A missing source fails with `attachment_missing`.
//! - A destination that exists is not overwritten: fail with `attachment_exists`.
//! - Images are detected from file contents, not the extension. A file named `.png` that is not an
//!   image is copied as is and reported with `is_image: false`.
//! - Resizing keeps the aspect ratio, honours EXIF orientation, flattens transparency onto white
//!   when it re-encodes as JPEG, and never enlarges. An animated GIF is copied as is.
//! - If the image is still over `MAX_IMAGE_BYTES` after quality 0.7, fail with
//!   `attachment_too_large` instead of sending something the agent will reject.
//! - Decoding runs on the blocking pool because large images take real time. Memory use is bounded
//!   by refusing sources over `MAX_SOURCE_BYTES` with `attachment_too_large`.
//! - Draft files older than 7 days are removed by the data-lifetime job (DATA-02), which also
//!   deletes the matching `attachments` rows.
//!
//! Our design choice: `MAX_SOURCE_BYTES` is 200 MiB, because Conductor's limit is not known.
//! Our design choice: transparency is flattened onto white, because JPEG has no alpha channel.
//! The implementation adds the `image` crate. File type sniffing uses its decoder, not `infer`.
//!
//! Test first: a 9000 x 100 PNG is copied with `resize_image: true` and comes back at most 7800
//! pixels wide with the same aspect ratio; a 100 x 100 PNG comes back byte for byte equal.

use serde::Serialize;

use crate::error::CommandResult;
use crate::not_implemented;

/// Longest edge, in pixels, an image may have.
pub const MAX_PIXEL_DIMENSION: u32 = 7_800;
/// Largest image file, in bytes, sent to an agent.
pub const MAX_IMAGE_BYTES: u64 = 4_718_592;
/// JPEG qualities tried in order when re-encoding.
pub const JPEG_QUALITIES: [u8; 2] = [85, 70];
/// Largest source file copied.
pub const MAX_SOURCE_BYTES: u64 = 200 * 1024 * 1024;

/// A file that now sits in the draft folder.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterializedAttachment {
    /// Where the copy is.
    pub path: String,
    pub size: u64,
    /// True when the contents are a still image the app can show.
    pub is_image: bool,
    /// Pixel size, for images.
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// True when the copy was shrunk.
    pub resized: bool,
}

/// Copies a file into the draft folder, shrinking it first when it is a large image and
/// `resize_image` is true.
#[tauri::command]
#[allow(unused_variables)]
pub async fn attachment_materialize(
    source_path: String,
    destination_path: String,
    resize_image: bool,
) -> CommandResult<MaterializedAttachment> {
    not_implemented!("PLAT-20")
}

/// Shrinks an image to fit the limits and writes the result to `destination_path`.
#[tauri::command]
#[allow(unused_variables)]
pub async fn image_resize(
    source_path: String,
    destination_path: String,
) -> CommandResult<MaterializedAttachment> {
    not_implemented!("PLAT-20")
}
