//! @feature COMP-07 Attachments: drop, paste, pick
//!
//! Owns: reading the files copied in Finder from the macOS pasteboard, for "Paste copied files as
//! paths" (Cmd+Shift+V). The clipboard plugin reads text and images only, and the web view sees no
//! file paths in a paste.
//!
//! Behaviour: docs/research/conductor/ui-map.md 3.5 and 5.4 ('Paste copied files as paths').
//!
//! Must handle:
//! - Every pasteboard item that carries a file URL gives its path, in the order Finder wrote them.
//! - An item without a file URL (copied text, an image) is skipped, so a clipboard with no files
//!   gives an empty list.
//! - A file URL whose path cannot be read is skipped rather than guessed.
//!
//! Test first: two file URLs written to a private pasteboard come back as their two paths, in
//! order, and a text item next to them is skipped.

use crate::error::CommandResult;

/// The paths of the files on the general pasteboard, in order.
#[tauri::command]
pub async fn clipboard_read_file_paths() -> CommandResult<Vec<String>> {
    read_general_pasteboard()
}

#[cfg(target_os = "macos")]
fn read_general_pasteboard() -> CommandResult<Vec<String>> {
    let pasteboard = objc2_app_kit::NSPasteboard::generalPasteboard();
    Ok(file_paths_on(&pasteboard))
}

#[cfg(not(target_os = "macos"))]
fn read_general_pasteboard() -> CommandResult<Vec<String>> {
    Err(crate::error::CommandError::Failed {
        code: "clipboard_unavailable",
        message: "Copied files can be read on macOS only.".to_string(),
    })
}

/// The file paths the items of `pasteboard` carry.
#[cfg(target_os = "macos")]
fn file_paths_on(pasteboard: &objc2_app_kit::NSPasteboard) -> Vec<String> {
    use objc2_app_kit::NSPasteboardTypeFileURL;
    use objc2_foundation::NSURL;

    let Some(items) = pasteboard.pasteboardItems() else {
        return Vec::new();
    };
    let mut paths = Vec::new();
    for item in items.iter() {
        // SAFETY: the type constant is a static string AppKit defines.
        let Some(text) = item.stringForType(unsafe { NSPasteboardTypeFileURL }) else {
            continue;
        };
        let Some(url) = NSURL::URLWithString(&text) else {
            continue;
        };
        if let Some(path) = url.path() {
            paths.push(path.to_string());
        }
    }
    paths
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{
        NSPasteboard, NSPasteboardItem, NSPasteboardTypeFileURL, NSPasteboardTypeString,
        NSPasteboardWriting,
    };
    use objc2_foundation::{NSArray, NSString, NSURL};

    use super::file_paths_on;

    /// A pasteboard of its own, so the test never touches the user's clipboard.
    struct PrivatePasteboard(Retained<NSPasteboard>);

    impl Drop for PrivatePasteboard {
        fn drop(&mut self) {
            // SAFETY: `releaseGlobally` takes no arguments and returns nothing; the pasteboard is
            // this test's own and is not used afterwards. objc2-app-kit does not bind it.
            unsafe {
                let _: () = objc2::msg_send![&*self.0, releaseGlobally];
            }
        }
    }

    fn file_item(path: &str) -> Retained<NSPasteboardItem> {
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        let text = url.absoluteString().expect("a file URL has a string form");
        let item = NSPasteboardItem::new();
        // SAFETY: the type constant is a static string AppKit defines.
        assert!(item.setString_forType(&text, unsafe { NSPasteboardTypeFileURL }));
        item
    }

    fn text_item(text: &str) -> Retained<NSPasteboardItem> {
        let item = NSPasteboardItem::new();
        // SAFETY: the type constant is a static string AppKit defines.
        assert!(
            item.setString_forType(&NSString::from_str(text), unsafe { NSPasteboardTypeString })
        );
        item
    }

    #[test]
    fn comp_07_copied_files_come_back_as_paths_in_order() {
        let pasteboard = PrivatePasteboard(NSPasteboard::pasteboardWithUniqueName());
        let items: Vec<Retained<ProtocolObject<dyn NSPasteboardWriting>>> = [
            file_item("/tmp/copied one.txt"),
            text_item("not a file"),
            file_item("/tmp/two.png"),
        ]
        .into_iter()
        .map(ProtocolObject::from_retained)
        .collect();
        pasteboard.0.clearContents();
        assert!(
            pasteboard
                .0
                .writeObjects(&NSArray::from_retained_slice(&items))
        );

        assert_eq!(
            file_paths_on(&pasteboard.0),
            vec![
                "/tmp/copied one.txt".to_string(),
                "/tmp/two.png".to_string()
            ]
        );
    }

    #[test]
    fn comp_07_a_pasteboard_without_files_gives_no_paths() {
        let pasteboard = PrivatePasteboard(NSPasteboard::pasteboardWithUniqueName());
        pasteboard.0.clearContents();
        assert!(file_paths_on(&pasteboard.0).is_empty());
    }
}
