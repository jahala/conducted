//! @feature PLAT-06 File search: tree, fuzzy match, grep (gitignore-aware)
//!
//! Owns: listing a workspace's files, ranking them against a typed query, and searching their
//! contents. All three skip what git ignores.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A1 (search crates: a gitignore
//! walker, a fuzzy matcher, an in-process ripgrep engine) and A2 (`list_file_tree`,
//! `fuzzy_filter_files`, `fuzzy_match_files`, `grep_workspace`). ui-map.md covers the file
//! picker and search panel that call these.
//!
//! Must handle:
//! - Honour `.gitignore`, `.git/info/exclude` and the global ignore file. Never list `.git`.
//! - Do not follow symlinks out of the root. A symlink loop must not hang the walk.
//! - Binary files are skipped by grep. Files over `MAX_GREP_FILE_BYTES` are skipped too.
//! - The root must be an existing directory; otherwise fail with `search_bad_root`.
//! - Fuzzy and grep results stop at `limit`. A tree with more than `MAX_TREE_ENTRIES` entries
//!   fails with `search_tree_too_large` instead of returning a silently cut list.
//! - Walks run on the blocking thread pool, never on the async runtime or the main thread.
//! - A bad regex fails with `search_bad_pattern`, with the parser's message.
//! - The UI starts a new query on every keystroke. The newest answer wins on the UI side, so a
//!   slow older walk may finish late. Rust does not cancel it, but must not hold locks.
//! - Fuzzy matching ranks by score, then shorter path, then alphabetical, so equal scores are
//!   stable between runs.
//!
//! Test first: in a temp repo with an ignored `node_modules` folder, `search_list_tree` lists
//! tracked and untracked files but nothing from `node_modules` or `.git`.

use serde::{Deserialize, Serialize};

use crate::error::CommandResult;
use crate::not_implemented;

/// Most paths one tree listing returns.
pub const MAX_TREE_ENTRIES: usize = 200_000;
/// Largest file grep will open.
pub const MAX_GREP_FILE_BYTES: u64 = 4 * 1024 * 1024;

/// One path under the root. Mirrors `TreeEntry` in platform.ts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeEntry {
    /// Path relative to the root, with `/` separators.
    pub path: String,
    pub is_directory: bool,
}

/// One line that matched. Mirrors `GrepMatch` in platform.ts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepMatch {
    /// Path relative to the root.
    pub path: String,
    /// 1-based line number.
    pub line: u32,
    /// 1-based column of the first match on the line, counted in characters.
    pub column: u32,
    /// The line text, trimmed to a sensible length.
    pub preview: String,
}

/// Grep settings. Mirrors the options object of `FileSearch.grep` in platform.ts.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
    /// Treat the query as a regular expression instead of plain text.
    pub regex: bool,
    /// Stop after this many matches.
    pub limit: u32,
}

/// Lists every non-ignored file and folder under `root`.
#[tauri::command]
#[allow(unused_variables)]
pub async fn search_list_tree(root: String) -> CommandResult<Vec<TreeEntry>> {
    not_implemented!("PLAT-06")
}

/// Ranks non-ignored files against `query` and returns the best `limit`.
#[tauri::command]
#[allow(unused_variables)]
pub async fn search_fuzzy(
    root: String,
    query: String,
    limit: u32,
) -> CommandResult<Vec<TreeEntry>> {
    not_implemented!("PLAT-06")
}

/// Searches file contents under `root`.
#[tauri::command]
#[allow(unused_variables)]
pub async fn search_grep(
    root: String,
    query: String,
    options: GrepOptions,
) -> CommandResult<Vec<GrepMatch>> {
    not_implemented!("PLAT-06")
}
