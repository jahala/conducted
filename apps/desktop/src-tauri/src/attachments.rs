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
//!   removes its temp file. The source is checked before the destination folders are made, so a
//!   refused source leaves nothing behind.
//! - The source is copied, never moved. A source that is a folder fails with
//!   `attachment_is_directory`. A missing source fails with `attachment_missing`.
//! - A destination that exists is not overwritten: fail with `attachment_exists`. For a resized
//!   image that means the `.jpg` name it is written under.
//! - Images are detected from file contents, not the extension. A file named `.png` that is not an
//!   image is copied as is and reported with `is_image: false`.
//! - A resized image is written as JPEG under the destination's name with a `.jpg` extension,
//!   and the returned `path` names that file, so the name always matches the bytes.
//! - Resizing keeps the aspect ratio, honours EXIF orientation, flattens transparency onto white
//!   when it re-encodes as JPEG, and never enlarges. An animated GIF is copied as is and reported
//!   with `is_image: false`, because it is not a still image.
//! - If the image is still over `MAX_IMAGE_BYTES` after quality 0.7, fail with
//!   `attachment_too_large` instead of sending something the agent will reject.
//! - Decoding runs on the blocking pool because large images take real time. Memory use is bounded
//!   by refusing sources over `MAX_SOURCE_BYTES` with `attachment_too_large`.
//!
//! Draft file cleanup belongs to DATA-02: it removes files in `draft-attachments/` that are never
//! sent and the matching `attachments` rows. This module only writes into that folder.
//!
//! Our design choice: `MAX_SOURCE_BYTES` is 200 MiB, because Conductor's limit is not known.
//! Our design choice: transparency is flattened onto white, because JPEG has no alpha channel.
//! The implementation adds the `image` crate. File type sniffing uses its decoder, not `infer`.
//!
//! Test first: a 9000 x 100 PNG is copied with `resize_image: true` and comes back at most 7800
//! pixels wide with the same aspect ratio; a 100 x 100 PNG comes back byte for byte equal.

use std::fs::{self, File, OpenOptions};
use std::io::{self, BufReader, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use image::codecs::gif::GifDecoder;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{
    AnimationDecoder, DynamicImage, ImageDecoder, ImageFormat, ImageReader, Rgb, RgbImage,
};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::{CommandError, CommandResult, blocking};

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
    /// Size of the copy in bytes. The name matches `MaterializedFile.sizeBytes` in platform.ts.
    pub size_bytes: u64,
    /// True when the contents are a still image the app can show.
    pub is_image: bool,
    /// Pixel size, for images.
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// True when the copy was shrunk.
    pub resized: bool,
}

/// Facts proved from the source file contents rather than its name.
struct ImageInfo {
    width: u32,
    height: u32,
    animated: bool,
}

/// A re-encoded image, ready to be written.
struct ResizedImage {
    bytes: Vec<u8>,
    width: u32,
    height: u32,
}

/// Copies a file into the draft folder, shrinking it first when it is a large image and
/// `resize_image` is true.
#[tauri::command]
pub async fn attachment_materialize(
    app: AppHandle,
    source_path: String,
    destination_path: String,
    resize_image: bool,
) -> CommandResult<MaterializedAttachment> {
    let draft_root = draft_root(&app)?;
    let source = PathBuf::from(source_path);
    let destination = PathBuf::from(destination_path);
    blocking("attachment_task_failed", move || {
        materialize_into(&source, &destination, resize_image, &draft_root)
    })
    .await
}

/// Shrinks an image to fit the limits and writes the result to `destination_path`.
#[tauri::command]
pub async fn image_resize(
    app: AppHandle,
    source_path: String,
    destination_path: String,
) -> CommandResult<MaterializedAttachment> {
    let draft_root = draft_root(&app)?;
    let source = PathBuf::from(source_path);
    let destination = PathBuf::from(destination_path);
    blocking("attachment_task_failed", move || {
        materialize_into(&source, &destination, true, &draft_root)
    })
    .await
}

/// The folder every attachment destination must sit under.
fn draft_root(app: &AppHandle) -> CommandResult<PathBuf> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|error| CommandError::Failed {
            code: "attachment_app_data",
            message: error.to_string(),
        })?;
    Ok(data.join("draft-attachments"))
}

fn failed(code: &'static str, message: impl Into<String>) -> CommandError {
    CommandError::Failed {
        code,
        message: message.into(),
    }
}

fn decode_failed(error: impl std::fmt::Display) -> CommandError {
    failed("attachment_decode_failed", error.to_string())
}

fn too_large(message: impl Into<String>) -> CommandError {
    failed("attachment_too_large", message)
}

fn bad_destination(destination: &Path, reason: &str) -> CommandError {
    failed(
        "attachment_bad_destination",
        format!("Attachment destination {reason}: {}", destination.display()),
    )
}

/// Creates the destination parents, proves the path stays under the draft folder, and returns the
/// real path to write.
fn prepare_destination(destination: &Path, draft_root: &Path) -> CommandResult<PathBuf> {
    if !destination.is_absolute() {
        return Err(bad_destination(destination, "must be absolute"));
    }
    if destination
        .components()
        .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err(bad_destination(destination, "must not contain . or .."));
    }
    let file_name = destination
        .file_name()
        .filter(|name| !name.is_empty())
        .ok_or_else(|| bad_destination(destination, "must end in a file name"))?;
    let parent = destination
        .parent()
        .ok_or_else(|| bad_destination(destination, "has no parent folder"))?;

    fs::create_dir_all(draft_root)?;
    let root = fs::canonicalize(draft_root)?;

    let mut ancestor = parent;
    while fs::symlink_metadata(ancestor).is_err() {
        ancestor = ancestor
            .parent()
            .ok_or_else(|| bad_destination(destination, "has no existing parent"))?;
    }
    let canonical_ancestor = fs::canonicalize(ancestor)
        .map_err(|_| bad_destination(destination, "follows a broken link"))?;
    if !canonical_ancestor.starts_with(&root) {
        return Err(bad_destination(
            destination,
            "must stay inside draft-attachments",
        ));
    }

    fs::create_dir_all(parent)?;
    let canonical_parent = fs::canonicalize(parent)?;
    if !canonical_parent.starts_with(&root) {
        return Err(bad_destination(
            destination,
            "must stay inside draft-attachments",
        ));
    }

    let target = canonical_parent.join(file_name);
    if fs::symlink_metadata(&target).is_ok() {
        return Err(failed(
            "attachment_exists",
            format!(
                "Attachment destination already exists: {}",
                destination.display()
            ),
        ));
    }
    Ok(target)
}

/// Copies `source` into the draft folder, shrinking it first when asked and needed.
fn materialize_into(
    source: &Path,
    destination: &Path,
    resize_image: bool,
    draft_root: &Path,
) -> CommandResult<MaterializedAttachment> {
    let reported_path = destination.to_string_lossy().into_owned();

    let metadata = match fs::metadata(source) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Err(failed(
                "attachment_missing",
                format!("Attachment source does not exist: {}", source.display()),
            ));
        }
        Err(error) => return Err(CommandError::Io(error)),
    };
    if metadata.is_dir() {
        return Err(failed(
            "attachment_is_directory",
            format!("Attachment source is a folder: {}", source.display()),
        ));
    }
    if metadata.len() > MAX_SOURCE_BYTES {
        return Err(too_large(format!(
            "Attachment source is larger than {MAX_SOURCE_BYTES} bytes"
        )));
    }

    let image = probe_image(source)?;

    let target = prepare_destination(destination, draft_root)?;

    let Some(image) = image else {
        copy_atomic(source, &target)?;
        return Ok(MaterializedAttachment {
            path: reported_path,
            size_bytes: metadata.len(),
            is_image: false,
            width: None,
            height: None,
            resized: false,
        });
    };

    let over_limit = image.width > MAX_PIXEL_DIMENSION
        || image.height > MAX_PIXEL_DIMENSION
        || metadata.len() > MAX_IMAGE_BYTES;
    if resize_image && over_limit && !image.animated {
        let resized = resize_image_bytes(source)?;
        let written = jpeg_path(&target);
        if written != target && fs::symlink_metadata(&written).is_ok() {
            return Err(failed(
                "attachment_exists",
                format!(
                    "Attachment destination already exists: {}",
                    written.display()
                ),
            ));
        }
        write_bytes_atomic(&resized.bytes, &written)?;
        return Ok(MaterializedAttachment {
            path: written.to_string_lossy().into_owned(),
            size_bytes: resized.bytes.len() as u64,
            is_image: true,
            width: Some(resized.width),
            height: Some(resized.height),
            resized: true,
        });
    }

    copy_atomic(source, &target)?;
    Ok(MaterializedAttachment {
        path: reported_path,
        size_bytes: metadata.len(),
        is_image: !image.animated,
        width: Some(image.width),
        height: Some(image.height),
        resized: false,
    })
}

/// A re-encoded image is JPEG, so its file name says so: `wide.png` is written as `wide.jpg`.
/// An agent that takes the image type from the name then sends what the bytes are.
fn jpeg_path(path: &Path) -> PathBuf {
    let is_jpeg = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("jpg") || extension.eq_ignore_ascii_case("jpeg")
        });
    if is_jpeg {
        path.to_path_buf()
    } else {
        path.with_extension("jpg")
    }
}

/// Reads the image format and dimensions from the file's first bytes. `None` means the contents
/// are not an image the app can decode.
fn probe_image(source: &Path) -> CommandResult<Option<ImageInfo>> {
    let reader = ImageReader::new(BufReader::new(File::open(source)?))
        .with_guessed_format()
        .map_err(CommandError::Io)?;
    let Some(format) = reader.format() else {
        return Ok(None);
    };
    let (width, height) = reader.into_dimensions().map_err(decode_failed)?;
    let animated = format == ImageFormat::Gif && gif_is_animated(source)?;
    Ok(Some(ImageInfo {
        width,
        height,
        animated,
    }))
}

/// A GIF with more than one frame is copied rather than flattened to one frame.
fn gif_is_animated(source: &Path) -> CommandResult<bool> {
    let file = File::open(source)?;
    let decoder = GifDecoder::new(BufReader::new(file)).map_err(decode_failed)?;
    let mut frames = decoder.into_frames();
    match frames.next() {
        Some(Ok(_)) => {}
        Some(Err(error)) => return Err(decode_failed(error)),
        None => return Ok(false),
    }
    match frames.next() {
        Some(Ok(_)) => Ok(true),
        Some(Err(error)) => Err(decode_failed(error)),
        None => Ok(false),
    }
}

/// Decodes, orients, shrinks and re-encodes an image to fit the limits.
fn resize_image_bytes(source: &Path) -> CommandResult<ResizedImage> {
    let reader = ImageReader::new(BufReader::new(File::open(source)?))
        .with_guessed_format()
        .map_err(CommandError::Io)?;
    let mut decoder = reader.into_decoder().map_err(decode_failed)?;
    let orientation = decoder.orientation().map_err(decode_failed)?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(decode_failed)?;
    image.apply_orientation(orientation);

    let (width, height) = (image.width(), image.height());
    if width == 0 || height == 0 {
        return Err(decode_failed("image has no pixels"));
    }
    let scale = (MAX_PIXEL_DIMENSION as f64 / width as f64)
        .min(MAX_PIXEL_DIMENSION as f64 / height as f64)
        .min(1.0);
    if scale < 1.0 {
        let new_width = ((width as f64 * scale).round() as u32).max(1);
        let new_height = ((height as f64 * scale).round() as u32).max(1);
        image = image.resize_exact(new_width, new_height, FilterType::Lanczos3);
    }

    let rgb = flatten_on_white(image);
    let bytes = encode_jpeg_within_limit(&rgb, MAX_IMAGE_BYTES)?;
    Ok(ResizedImage {
        bytes,
        width: rgb.width(),
        height: rgb.height(),
    })
}

/// Drops the alpha channel by blending each pixel over white.
fn flatten_on_white(image: DynamicImage) -> RgbImage {
    let rgba = image.to_rgba8();
    RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let pixel = rgba.get_pixel(x, y);
        let alpha = u32::from(pixel[3]);
        let over_white =
            |channel: u8| ((u32::from(channel) * alpha + 255 * (255 - alpha)) / 255) as u8;
        Rgb([
            over_white(pixel[0]),
            over_white(pixel[1]),
            over_white(pixel[2]),
        ])
    })
}

fn encode_jpeg(image: &RgbImage, quality: u8) -> CommandResult<Vec<u8>> {
    let mut buffer = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut buffer, quality);
    encoder.encode_image(image).map_err(decode_failed)?;
    Ok(buffer)
}

/// Encodes at the first quality that fits, then fails with `attachment_too_large`.
fn encode_jpeg_within_limit(image: &RgbImage, max_bytes: u64) -> CommandResult<Vec<u8>> {
    let mut last_size = 0;
    for quality in JPEG_QUALITIES {
        let bytes = encode_jpeg(image, quality)?;
        last_size = bytes.len();
        if last_size as u64 <= max_bytes {
            return Ok(bytes);
        }
    }
    Err(too_large(format!(
        "Image is still {last_size} bytes after resizing; the limit is {max_bytes}"
    )))
}

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

fn temp_path_for(target: &Path) -> CommandResult<PathBuf> {
    let parent = target
        .parent()
        .ok_or_else(|| failed("attachment_write_failed", "destination has no parent"))?;
    let name = target
        .file_name()
        .ok_or_else(|| failed("attachment_write_failed", "destination has no file name"))?;
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    Ok(parent.join(format!(
        ".{}.tmp-{}-{counter}",
        name.to_string_lossy(),
        std::process::id()
    )))
}

fn remove_temp(path: &Path) {
    if fs::symlink_metadata(path).is_err() {
        return;
    }
    if let Err(error) = fs::remove_file(path) {
        eprintln!(
            "could not remove attachment temp file {}: {error}",
            path.display()
        );
    }
}

fn write_bytes_atomic(bytes: &[u8], destination: &Path) -> CommandResult<()> {
    let temp = temp_path_for(destination)?;
    let result = (|| -> io::Result<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        rename_new(&temp, destination)
    })();
    if let Err(error) = result {
        remove_temp(&temp);
        return Err(CommandError::Io(error));
    }
    Ok(())
}

fn copy_atomic(source: &Path, destination: &Path) -> CommandResult<()> {
    let temp = temp_path_for(destination)?;
    let result = (|| -> io::Result<()> {
        fs::copy(source, &temp)?;
        rename_new(&temp, destination)
    })();
    if let Err(error) = result {
        remove_temp(&temp);
        return Err(CommandError::Io(error));
    }
    Ok(())
}

/// Renames, refusing to replace an existing destination.
fn rename_new(from: &Path, to: &Path) -> io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;

        const RENAME_EXCL: std::os::raw::c_uint = 0x4;

        unsafe extern "C" {
            fn renamex_np(
                from: *const std::os::raw::c_char,
                to: *const std::os::raw::c_char,
                flags: std::os::raw::c_uint,
            ) -> std::os::raw::c_int;
        }

        let from_c = CString::new(from.as_os_str().as_bytes()).map_err(|_| {
            io::Error::new(io::ErrorKind::InvalidInput, "path contains a null byte")
        })?;
        let to_c = CString::new(to.as_os_str().as_bytes()).map_err(|_| {
            io::Error::new(io::ErrorKind::InvalidInput, "path contains a null byte")
        })?;
        let result = unsafe { renamex_np(from_c.as_ptr(), to_c.as_ptr(), RENAME_EXCL) };
        if result == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        if fs::symlink_metadata(to).is_ok() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "destination already exists",
            ));
        }
        fs::rename(from, to)
    }
}

#[cfg(test)]
mod tests {
    use std::fs::{self, File};
    use std::os::unix::fs::symlink;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    use image::codecs::gif::GifEncoder;
    use image::{Delay, DynamicImage, Frame, ImageFormat, Rgb, RgbImage, Rgba, RgbaImage};

    use super::{
        JPEG_QUALITIES, MAX_IMAGE_BYTES, MAX_PIXEL_DIMENSION, MAX_SOURCE_BYTES,
        MaterializedAttachment, encode_jpeg, encode_jpeg_within_limit, flatten_on_white,
        materialize_into, write_bytes_atomic,
    };
    use crate::error::CommandError;

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new() -> Self {
            let counter = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "conducted-plat-20-{}-{counter}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create test folder");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }

        fn draft_root(&self) -> PathBuf {
            self.path.join("app-data/draft-attachments")
        }

        fn destination(&self, name: &str) -> PathBuf {
            self.draft_root().join("workspace/chat").join(name)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            if let Err(error) = fs::remove_dir_all(&self.path) {
                eprintln!(
                    "could not remove test folder {}: {error}",
                    self.path.display()
                );
            }
        }
    }

    fn as_string(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    fn write_png(path: &Path, width: u32, height: u32, colour: [u8; 4]) {
        RgbaImage::from_pixel(width, height, Rgba(colour))
            .save_with_format(path, ImageFormat::Png)
            .expect("write png");
    }

    /// Writes a PNG of pseudo-random pixels. Its high entropy keeps the file large at any
    /// dimension, so the byte limit can be tested without crossing the pixel limit.
    fn write_noise_png(path: &Path, width: u32, height: u32) {
        let image = RgbImage::from_fn(width, height, |x, y| {
            let mut value = x.wrapping_mul(0x9e37_79b9) ^ y.wrapping_mul(0x85eb_ca6b);
            value ^= value >> 16;
            value = value.wrapping_mul(0x21f0_aaad);
            value ^= value >> 15;
            value = value.wrapping_mul(0x735a_2d97);
            value ^= value >> 15;
            Rgb([value as u8, (value >> 8) as u8, (value >> 16) as u8])
        });
        image
            .save_with_format(path, ImageFormat::Png)
            .expect("write noise png");
    }

    /// Every file and folder under `root`, so a test can prove a refusal added none.
    fn entries_under(root: &Path) -> Vec<PathBuf> {
        let mut found = Vec::new();
        collect_entries(root, &mut found);
        found.sort();
        found
    }

    fn collect_entries(path: &Path, found: &mut Vec<PathBuf>) {
        let Ok(entries) = fs::read_dir(path) else {
            return;
        };
        for entry in entries {
            let path = entry.expect("entry").path();
            if path.is_dir() {
                collect_entries(&path, found);
            }
            found.push(path);
        }
    }

    fn assert_code(error: CommandError, code: &str) {
        match error {
            CommandError::Failed { code: actual, .. } => assert_eq!(actual, code),
            other => panic!("expected {code}, got {other:?}"),
        }
    }

    #[test]
    fn plat_20_materialize_copies_a_dropped_file_into_the_draft_folder() {
        let folder = TempDir::new();
        let source = folder.path().join("notes.txt");
        fs::write(&source, "hello attachment").expect("write source");
        let destination = folder.destination("notes.txt");
        let draft_root = folder.draft_root();

        let result =
            materialize_into(&source, &destination, false, &draft_root).expect("materialize");

        assert_eq!(result.path, as_string(&destination));
        assert_eq!(result.size_bytes, 16);
        assert!(!result.is_image);
        assert!(!result.resized);
        assert_eq!(result.width, None);
        assert_eq!(
            fs::read_to_string(&destination).expect("copy"),
            "hello attachment"
        );
        assert!(draft_root.is_dir(), "the draft folder is created");
    }

    #[test]
    fn plat_20_materialized_attachment_uses_the_platform_contract_field_names() {
        let attachment = MaterializedAttachment {
            path: "/tmp/draft-attachments/chat/notes.txt".to_string(),
            size_bytes: 16,
            is_image: false,
            width: None,
            height: None,
            resized: false,
        };

        let json = serde_json::to_value(&attachment).expect("serialize");

        assert_eq!(json["sizeBytes"], 16);
        assert_eq!(json["isImage"], false);
        assert_eq!(json["resized"], false);
        assert!(json["width"].is_null());
        assert!(json["height"].is_null());
        assert!(
            json.get("size").is_none(),
            "the platform contract never reads a field named size"
        );
    }

    #[test]
    fn plat_20_materialize_copies_a_small_image_byte_for_byte() {
        let folder = TempDir::new();
        let source = folder.path().join("small.png");
        write_png(&source, 100, 100, [10, 20, 30, 255]);
        let original = fs::read(&source).expect("read source");
        let destination = folder.destination("small.png");
        let draft_root = folder.draft_root();

        let result =
            materialize_into(&source, &destination, true, &draft_root).expect("materialize");

        assert!(result.is_image);
        assert!(!result.resized);
        assert_eq!(result.width, Some(100));
        assert_eq!(result.height, Some(100));
        assert_eq!(fs::read(&destination).expect("copy"), original);
    }

    #[test]
    fn plat_20_materialize_shrinks_a_large_image_to_the_pixel_limit() {
        let folder = TempDir::new();
        let source = folder.path().join("wide.png");
        write_png(&source, 9000, 100, [200, 100, 50, 255]);
        let destination = folder.destination("wide.png");
        let draft_root = folder.draft_root();

        let result =
            materialize_into(&source, &destination, true, &draft_root).expect("materialize");

        assert!(result.is_image);
        assert!(result.resized);
        assert_eq!(result.width, Some(MAX_PIXEL_DIMENSION));
        let height = result.height.expect("height");
        let ratio = f64::from(result.width.expect("width")) / f64::from(height);
        assert!(
            (ratio - 90.0).abs() / 90.0 < 0.01,
            "aspect ratio was {ratio}"
        );
        assert!(
            result.path.ends_with("wide.jpg"),
            "a JPEG keeps a .jpg name: {}",
            result.path
        );
        let written = PathBuf::from(&result.path);
        let bytes = fs::read(&written).expect("copy");
        assert_eq!(&bytes[..2], &[0xff, 0xd8], "the copy is a JPEG");
        let (width, stored_height) = image::image_dimensions(&written).expect("dimensions");
        assert_eq!(width, MAX_PIXEL_DIMENSION);
        assert_eq!(stored_height, height);
    }

    #[test]
    fn plat_20_materialize_shrinks_an_image_over_the_byte_limit() {
        let folder = TempDir::new();
        let source = folder.path().join("noisy.png");
        write_noise_png(&source, 1500, 1500);
        let source_bytes = fs::metadata(&source).expect("source metadata").len();
        assert!(
            source_bytes > MAX_IMAGE_BYTES,
            "the source is {source_bytes} bytes, not over the limit"
        );
        let destination = folder.destination("noisy.png");
        let draft_root = folder.draft_root();

        let result =
            materialize_into(&source, &destination, true, &draft_root).expect("materialize");

        assert!(result.resized, "the byte limit alone forces a resize");
        assert!(result.is_image);
        assert_eq!(result.width, Some(1500));
        assert_eq!(result.height, Some(1500));
        assert!(result.size_bytes <= MAX_IMAGE_BYTES);
        assert!(result.size_bytes < source_bytes);
        assert!(
            result.path.ends_with("noisy.jpg"),
            "returned {}",
            result.path
        );
        assert_eq!(
            fs::metadata(&result.path).expect("copy").len(),
            result.size_bytes
        );
    }

    #[test]
    fn plat_20_materialize_refuses_an_image_that_stays_too_large() {
        let folder = TempDir::new();
        let source = folder.path().join("noisy-large.png");
        write_noise_png(&source, 4000, 4000);
        let destination = folder.destination("noisy-large.png");
        let draft_root = folder.draft_root();

        let error = materialize_into(&source, &destination, true, &draft_root)
            .expect_err("noise stays over the limit at both qualities");

        assert_code(error, "attachment_too_large");
        assert!(!destination.exists());
        let parent = destination.parent().expect("parent");
        assert_eq!(
            entries_under(parent),
            Vec::<PathBuf>::new(),
            "a failed resize leaves no destination and no temp file"
        );
    }

    #[test]
    fn plat_20_materialize_does_not_shrink_an_image_when_resize_is_false() {
        let folder = TempDir::new();
        let source = folder.path().join("wide.png");
        write_png(&source, 9000, 100, [200, 100, 50, 255]);
        let original = fs::read(&source).expect("read source");
        let destination = folder.destination("wide.png");
        let draft_root = folder.draft_root();

        let result =
            materialize_into(&source, &destination, false, &draft_root).expect("materialize");

        assert!(result.is_image);
        assert!(!result.resized);
        assert_eq!(result.width, Some(9000));
        assert_eq!(result.height, Some(100));
        assert_eq!(fs::read(&destination).expect("copy"), original);
    }

    #[test]
    fn plat_20_image_resize_shrinks_a_large_image() {
        let folder = TempDir::new();
        let source = folder.path().join("wide.png");
        write_png(&source, 9000, 100, [20, 120, 220, 255]);
        let destination = folder.destination("wide-small.png");
        let draft_root = folder.draft_root();

        let result =
            materialize_into(&source, &destination, true, &draft_root).expect("image resize");

        assert!(result.resized);
        assert_eq!(result.width, Some(MAX_PIXEL_DIMENSION));
        assert!(
            result.path.ends_with("wide-small.jpg"),
            "returned {}",
            result.path
        );
        assert!(PathBuf::from(&result.path).is_file());
        assert!(
            !destination.exists(),
            "nothing is written under the .png name"
        );
    }

    #[test]
    fn plat_20_materialize_detects_an_image_from_its_contents_not_its_name() {
        let folder = TempDir::new();
        let source = folder.path().join("photo.txt");
        write_png(&source, 40, 30, [1, 2, 3, 255]);
        let destination = folder.destination("photo.txt");
        let draft_root = folder.draft_root();

        let result =
            materialize_into(&source, &destination, false, &draft_root).expect("materialize");

        assert!(result.is_image);
        assert_eq!(result.width, Some(40));
        assert_eq!(result.height, Some(30));
    }

    #[test]
    fn plat_20_materialize_copies_a_non_image_named_png_as_is() {
        let folder = TempDir::new();
        let source = folder.path().join("fake.png");
        fs::write(&source, "not pixels").expect("write source");
        let destination = folder.destination("fake.png");
        let draft_root = folder.draft_root();

        let result =
            materialize_into(&source, &destination, true, &draft_root).expect("materialize");

        assert!(!result.is_image);
        assert!(!result.resized);
        assert_eq!(result.width, None);
        assert_eq!(
            fs::read_to_string(&destination).expect("copy"),
            "not pixels"
        );
    }

    #[test]
    fn plat_20_materialize_refuses_a_missing_source() {
        let folder = TempDir::new();
        let source = folder.path().join("missing.txt");
        let destination = folder.destination("missing.txt");
        let draft_root = folder.draft_root();
        let before = entries_under(&draft_root);

        let error = materialize_into(&source, &destination, false, &draft_root)
            .expect_err("missing source fails");

        assert_code(error, "attachment_missing");
        assert!(!destination.exists());
        assert_eq!(
            entries_under(&draft_root),
            before,
            "the refusal leaves nothing behind"
        );
    }

    #[test]
    fn plat_20_materialize_refuses_a_directory() {
        let folder = TempDir::new();
        let source = folder.path().join("folder");
        fs::create_dir(&source).expect("create source folder");
        let destination = folder.destination("folder");
        let draft_root = folder.draft_root();
        let before = entries_under(&draft_root);

        let error = materialize_into(&source, &destination, false, &draft_root)
            .expect_err("folder source fails");

        assert_code(error, "attachment_is_directory");
        assert!(!destination.exists());
        assert_eq!(
            entries_under(&draft_root),
            before,
            "the refusal leaves nothing behind"
        );
    }

    #[test]
    fn plat_20_a_resized_image_refuses_a_taken_jpg_name() {
        let folder = TempDir::new();
        let source = folder.path().join("wide.png");
        write_png(&source, 9000, 100, [200, 100, 50, 255]);
        let destination = folder.destination("wide.png");
        let taken = destination.with_extension("jpg");
        fs::create_dir_all(taken.parent().expect("parent")).expect("create parents");
        fs::write(&taken, "old").expect("write the taken name");
        let draft_root = folder.draft_root();

        let error = materialize_into(&source, &destination, true, &draft_root)
            .expect_err("a taken .jpg name fails");

        assert_code(error, "attachment_exists");
        assert_eq!(fs::read_to_string(&taken).expect("taken"), "old");
        assert!(
            !destination.exists(),
            "nothing is written under the .png name"
        );
    }

    #[test]
    fn plat_20_materialize_refuses_an_existing_destination() {
        let folder = TempDir::new();
        let source = folder.path().join("source.txt");
        fs::write(&source, "new").expect("write source");
        let destination = folder.destination("taken.txt");
        fs::create_dir_all(destination.parent().expect("parent")).expect("create parents");
        fs::write(&destination, "old").expect("write destination");
        let draft_root = folder.draft_root();

        let error = materialize_into(&source, &destination, false, &draft_root)
            .expect_err("existing destination fails");

        assert_code(error, "attachment_exists");
        assert_eq!(
            fs::read_to_string(&destination).expect("destination"),
            "old"
        );
    }

    #[test]
    fn plat_20_write_bytes_atomic_leaves_no_temp_file_on_failure() {
        let folder = TempDir::new();
        let destination = folder.path().join("taken.bin");
        fs::write(&destination, "old").expect("write destination");

        let error = write_bytes_atomic(b"new", &destination).expect_err("destination exists");

        assert!(matches!(error, CommandError::Io(_)));
        assert_eq!(
            fs::read_to_string(&destination).expect("destination"),
            "old"
        );
        let names: Vec<String> = fs::read_dir(folder.path())
            .expect("list folder")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(names, vec!["taken.bin".to_string()], "no temp file is left");
    }

    #[test]
    fn plat_20_materialize_refuses_a_destination_outside_the_draft_folder() {
        let folder = TempDir::new();
        let source = folder.path().join("source.txt");
        fs::write(&source, "hello").expect("write source");
        let destination = folder.path().join("elsewhere/source.txt");
        let draft_root = folder.draft_root();

        let error = materialize_into(&source, &destination, false, &draft_root)
            .expect_err("outside destination fails");

        assert_code(error, "attachment_bad_destination");
        assert!(!destination.exists());
    }

    #[test]
    fn plat_20_materialize_refuses_a_parent_directory_escape() {
        let folder = TempDir::new();
        let source = folder.path().join("source.txt");
        fs::write(&source, "hello").expect("write source");
        let draft_root = folder.draft_root();
        let destination = draft_root.join("workspace/../../escape.txt");

        let error =
            materialize_into(&source, &destination, false, &draft_root).expect_err("escape fails");

        assert_code(error, "attachment_bad_destination");
        assert!(!folder.path().join("escape.txt").exists());
    }

    #[test]
    fn plat_20_materialize_refuses_a_symlink_that_leaves_the_draft_folder() {
        let folder = TempDir::new();
        let source = folder.path().join("source.txt");
        fs::write(&source, "hello").expect("write source");
        let draft_root = folder.draft_root();
        let outside = folder.path().join("outside");
        fs::create_dir(&outside).expect("create outside folder");
        fs::create_dir_all(&draft_root).expect("create draft root");
        symlink(&outside, draft_root.join("link")).expect("make escaping link");
        let destination = draft_root.join("link/source.txt");

        let error = materialize_into(&source, &destination, false, &draft_root)
            .expect_err("symlink escape fails");

        assert_code(error, "attachment_bad_destination");
        assert!(!outside.join("source.txt").exists());
    }

    #[test]
    fn plat_20_materialize_refuses_a_source_over_the_source_limit() {
        let folder = TempDir::new();
        let source = folder.path().join("huge.bin");
        let file = File::create(&source).expect("create source");
        file.set_len(MAX_SOURCE_BYTES + 1).expect("grow source");
        let destination = folder.destination("huge.bin");
        let draft_root = folder.draft_root();
        let before = entries_under(&draft_root);

        let error = materialize_into(&source, &destination, false, &draft_root)
            .expect_err("huge source fails");

        assert_code(error, "attachment_too_large");
        assert!(!destination.exists());
        assert_eq!(
            entries_under(&draft_root),
            before,
            "the refusal leaves nothing behind"
        );
    }

    #[test]
    fn plat_20_materialize_copies_an_animated_gif_as_is() {
        let folder = TempDir::new();
        let source = folder.path().join("animated.gif");
        let frame = RgbaImage::from_pixel(8000, 2, Rgba([30, 60, 90, 255]));
        let mut encoder = GifEncoder::new(File::create(&source).expect("create gif"));
        encoder
            .encode_frame(Frame::from_parts(
                frame.clone(),
                0,
                0,
                Delay::from_numer_denom_ms(100, 1),
            ))
            .expect("write first frame");
        encoder
            .encode_frame(Frame::from_parts(
                frame,
                0,
                0,
                Delay::from_numer_denom_ms(100, 1),
            ))
            .expect("write second frame");
        drop(encoder);
        let original = fs::read(&source).expect("read source");
        let destination = folder.destination("animated.gif");
        let draft_root = folder.draft_root();

        let result =
            materialize_into(&source, &destination, true, &draft_root).expect("materialize");

        assert!(!result.resized);
        assert!(!result.is_image, "an animated GIF is not a still image");
        assert_eq!(result.width, Some(8000));
        assert_eq!(result.height, Some(2));
        assert_eq!(fs::read(&destination).expect("copy"), original);
    }

    #[test]
    fn plat_20_flatten_on_white_makes_transparent_pixels_white() {
        let mut image = RgbaImage::new(2, 1);
        image.put_pixel(0, 0, Rgba([200, 40, 10, 255]));
        image.put_pixel(1, 0, Rgba([0, 0, 0, 0]));

        let flat = flatten_on_white(DynamicImage::ImageRgba8(image));

        assert_eq!(flat.get_pixel(0, 0), &Rgb([200, 40, 10]));
        assert_eq!(flat.get_pixel(1, 0), &Rgb([255, 255, 255]));
    }

    #[test]
    fn plat_20_jpeg_quality_falls_back_when_85_is_too_large() {
        let image = RgbImage::from_fn(200, 200, |x, y| {
            let value = ((x * 7 + y * 13 + x * y) % 256) as u8;
            Rgb([value, value.wrapping_mul(3), value.wrapping_add(17)])
        });
        let at_85 = encode_jpeg(&image, JPEG_QUALITIES[0]).expect("encode 85");
        let at_70 = encode_jpeg(&image, JPEG_QUALITIES[1]).expect("encode 70");
        assert!(at_70.len() < at_85.len(), "quality 70 must be smaller");

        let chosen =
            encode_jpeg_within_limit(&image, at_85.len() as u64 - 1).expect("fallback fits");

        assert_eq!(chosen, at_70);
    }

    #[test]
    fn plat_20_jpeg_quality_reports_too_large_when_both_exceed_the_limit() {
        let image = RgbImage::from_pixel(10, 10, Rgb([1, 2, 3]));

        let error = encode_jpeg_within_limit(&image, 0).expect_err("nothing fits zero bytes");

        assert_code(error, "attachment_too_large");
    }

    #[test]
    fn plat_20_materialize_applies_exif_orientation_before_resizing() {
        let folder = TempDir::new();
        let source = folder.path().join("rotated.jpg");
        let image = RgbImage::from_pixel(8000, 10, Rgb([90, 120, 150]));
        let jpeg = encode_jpeg(&image, 90).expect("encode source");
        fs::write(&source, with_exif_orientation(jpeg, 6)).expect("write source");
        let destination = folder.destination("rotated.jpg");
        let draft_root = folder.draft_root();

        let result =
            materialize_into(&source, &destination, true, &draft_root).expect("materialize");

        assert!(result.resized);
        assert_eq!(result.height, Some(MAX_PIXEL_DIMENSION));
        assert!(
            result.width.expect("width") < MAX_PIXEL_DIMENSION,
            "a 90 degree turn makes the short edge the width"
        );
    }

    fn with_exif_orientation(jpeg: Vec<u8>, orientation: u16) -> Vec<u8> {
        assert_eq!(&jpeg[..2], &[0xff, 0xd8], "source is a JPEG");
        let mut app1 = Vec::new();
        app1.extend_from_slice(b"Exif\0\0");
        app1.extend_from_slice(b"II");
        app1.extend_from_slice(&42u16.to_le_bytes());
        app1.extend_from_slice(&8u32.to_le_bytes());
        app1.extend_from_slice(&1u16.to_le_bytes());
        app1.extend_from_slice(&0x0112u16.to_le_bytes());
        app1.extend_from_slice(&3u16.to_le_bytes());
        app1.extend_from_slice(&1u32.to_le_bytes());
        app1.extend_from_slice(&orientation.to_le_bytes());
        app1.extend_from_slice(&0u16.to_le_bytes());
        app1.extend_from_slice(&0u32.to_le_bytes());

        let mut result = Vec::with_capacity(jpeg.len() + app1.len() + 4);
        result.extend_from_slice(&jpeg[..2]);
        result.extend_from_slice(&[0xff, 0xe1]);
        result.extend_from_slice(&((app1.len() + 2) as u16).to_be_bytes());
        result.extend_from_slice(&app1);
        result.extend_from_slice(&jpeg[2..]);
        result
    }
}
