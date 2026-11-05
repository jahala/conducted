//! @feature PLAT-06 File search: tree, fuzzy match, grep (gitignore-aware)
//!
//! Owns: listing a workspace's files, ranking them against a typed query, and searching their
//! contents. All three skip what git ignores.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A1 (search crates: a gitignore
//! walker, a fuzzy matcher, an in-process ripgrep engine) and A2 (`list_file_tree`,
//! `fuzzy_filter_files`, `fuzzy_match_files`, `grep_workspace`). ui-map.md covers the file
//! picker and search panel that call these. Watching files (the `notify` crate in Conductor) is
//! not part of these commands; the UI polls the tree (REV-06).
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
//! Our design choice: every path in a result is absolute, like the paths the rest of the Platform
//! uses. The walker's own filters are the standard ignore set; a small built-in set always keeps
//! `.git` out even when a custom filter would allow hidden folders.
//!
//! Test first: in a temp repo with an ignored `node_modules` folder, `search_list_tree` lists
//! tracked and untracked files but nothing from `node_modules` or `.git`.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use globset::{Glob, GlobSet, GlobSetBuilder};
use grep_matcher::Matcher as _;
use grep_regex::{RegexMatcher, RegexMatcherBuilder};
use grep_searcher::{BinaryDetection, Searcher, SearcherBuilder, Sink, SinkMatch};
use ignore::WalkBuilder;
use nucleo_matcher::pattern::{AtomKind, CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};
use serde::{Deserialize, Serialize};

use crate::error::{CommandError, CommandResult};

/// Most paths one tree listing returns.
pub const MAX_TREE_ENTRIES: usize = 200_000;
/// Largest file grep will open.
pub const MAX_GREP_FILE_BYTES: u64 = 4 * 1024 * 1024;
/// Longest preview grep keeps for one matching line.
const MAX_PREVIEW_CHARS: usize = 300;

/// One path under the root. Mirrors `TreeEntry` in platform.ts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeEntry {
    /// Absolute path, with `/` separators.
    pub path: String,
    pub is_directory: bool,
}

/// One line that matched. Mirrors `GrepMatch` in platform.ts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepMatch {
    /// Absolute path of the file.
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

/// The built-in names the walker always leaves out, even if the standard filters are changed.
fn always_ignored() -> GlobSet {
    let mut builder = GlobSetBuilder::new();
    for pattern in [".git", "**/.git"] {
        builder.add(Glob::new(pattern).expect("the built-in ignore pattern is valid"));
    }
    builder.build().expect("the built-in ignore set is valid")
}

/// The one walker configuration for the tree, fuzzy and grep commands.
fn walk_builder(root: &Path, max_filesize: Option<u64>) -> WalkBuilder {
    let ignored = always_ignored();
    let mut builder = WalkBuilder::new(root);
    builder
        .standard_filters(true)
        .require_git(false)
        .follow_links(false)
        .filter_entry(move |entry| !ignored.is_match(entry.path()));
    if let Some(limit) = max_filesize {
        builder.max_filesize(Some(limit));
    }
    builder
}

fn walk_error(error: ignore::Error) -> CommandError {
    CommandError::Failed {
        code: "search_walk_failed",
        message: error.to_string(),
    }
}

/// Confirms that the root is an existing folder and keeps the path as the caller gave it.
fn checked_root(root: &str) -> CommandResult<PathBuf> {
    let path = PathBuf::from(root);
    match fs::metadata(&path) {
        Ok(metadata) if metadata.is_dir() => Ok(path),
        Ok(_) => Err(CommandError::Failed {
            code: "search_bad_root",
            message: format!("Not a folder: {}", path.display()),
        }),
        Err(error) => Err(CommandError::Failed {
            code: "search_bad_root",
            message: format!("Cannot search {}: {error}", path.display()),
        }),
    }
}

/// Runs a blocking search off the async runtime.
async fn blocking<T, F>(work: F) -> CommandResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> CommandResult<T> + Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(work).await {
        Ok(result) => result,
        Err(error) => Err(CommandError::Failed {
            code: "search_task_failed",
            message: error.to_string(),
        }),
    }
}

/// Lists every non-ignored file and folder under `root`, up to `max_entries`.
fn collect_tree(root: &Path, max_entries: usize) -> CommandResult<Vec<TreeEntry>> {
    let mut entries = Vec::new();
    for result in walk_builder(root, None).build() {
        let entry = result.map_err(walk_error)?;
        if entry.depth() == 0 {
            continue;
        }
        entries.push(TreeEntry {
            path: entry.path().to_string_lossy().into_owned(),
            is_directory: entry.file_type().is_some_and(|kind| kind.is_dir()),
        });
        if entries.len() > max_entries {
            return Err(CommandError::Failed {
                code: "search_tree_too_large",
                message: format!("The workspace has more than {max_entries} files and folders."),
            });
        }
    }
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(entries)
}

/// Lists every non-ignored regular file under `root`.
fn collect_files(root: &Path) -> CommandResult<Vec<TreeEntry>> {
    let mut files = Vec::new();
    for result in walk_builder(root, None).build() {
        let entry = result.map_err(walk_error)?;
        if entry.depth() == 0 {
            continue;
        }
        if entry.file_type().is_some_and(|kind| kind.is_file()) {
            files.push(TreeEntry {
                path: entry.path().to_string_lossy().into_owned(),
                is_directory: false,
            });
        }
    }
    Ok(files)
}

fn new_matcher() -> Matcher {
    let mut config = Config::DEFAULT.match_paths();
    config.ignore_case = true;
    Matcher::new(config)
}

/// A path relative to the search root, used for scoring and tie-breaking.
fn relative_display(root: &Path, path: &str) -> String {
    Path::new(path)
        .strip_prefix(root)
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.replace('\\', "/"))
}

struct ScoredFile {
    entry: TreeEntry,
    score: u32,
    relative: String,
}

/// Keeps only the files that match `query`, with the score the matcher gave each one.
fn fuzzy_filter_files(
    root: &Path,
    files: Vec<TreeEntry>,
    query: &str,
    matcher: &mut Matcher,
) -> Vec<ScoredFile> {
    let pattern = Pattern::new(
        query,
        CaseMatching::Ignore,
        Normalization::Smart,
        AtomKind::Fuzzy,
    );
    let mut buffer = Vec::new();
    let mut scored = Vec::new();
    for entry in files {
        let relative = relative_display(root, &entry.path);
        let score = {
            let haystack = Utf32Str::new(&relative, &mut buffer);
            pattern.score(haystack, matcher)
        };
        if let Some(score) = score {
            scored.push(ScoredFile {
                entry,
                score,
                relative,
            });
        }
    }
    scored
}

/// Ranks filtered files by score, then shorter path, then alphabetical, and keeps `limit`.
fn fuzzy_match_files(mut scored: Vec<ScoredFile>, limit: usize) -> Vec<TreeEntry> {
    scored.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| {
                left.relative
                    .chars()
                    .count()
                    .cmp(&right.relative.chars().count())
            })
            .then_with(|| left.relative.cmp(&right.relative))
    });
    scored
        .into_iter()
        .take(limit)
        .map(|scored| scored.entry)
        .collect()
}

fn trim_line_end(line: &[u8]) -> &[u8] {
    let mut end = line.len();
    if end > 0 && line[end - 1] == b'\n' {
        end -= 1;
    }
    if end > 0 && line[end - 1] == b'\r' {
        end -= 1;
    }
    &line[..end]
}

fn looks_binary(bytes: &[u8]) -> bool {
    bytes.contains(&0)
}

/// The 1-based character column of `byte_index` in `line`.
fn character_column(line: &[u8], byte_index: usize) -> u32 {
    let prefix = line.get(..byte_index).unwrap_or(line);
    let width = std::str::from_utf8(prefix)
        .map(|text| text.chars().count())
        .unwrap_or(prefix.len());
    width as u32 + 1
}

/// The line without its terminator, with surrounding whitespace trimmed and a length cap.
fn preview_of(line: &[u8]) -> String {
    let text = String::from_utf8_lossy(trim_line_end(line));
    let trimmed = text.trim();
    let mut preview: String = trimmed.chars().take(MAX_PREVIEW_CHARS).collect();
    if trimmed.chars().count() > MAX_PREVIEW_CHARS {
        preview.push('…');
    }
    preview
}

struct GrepSink {
    matcher: RegexMatcher,
    limit: usize,
    path: String,
    matches: Vec<GrepMatch>,
}

impl GrepSink {
    fn new(matcher: RegexMatcher, limit: usize) -> Self {
        Self {
            matcher,
            limit,
            path: String::new(),
            matches: Vec::new(),
        }
    }
}

impl Sink for GrepSink {
    type Error = io::Error;

    fn matched(&mut self, _searcher: &Searcher, mat: &SinkMatch<'_>) -> Result<bool, Self::Error> {
        let line_number = mat.line_number().unwrap_or(0) as u32;
        // A searcher may report several matches on one line. The result is one row per line.
        if self
            .matches
            .last()
            .is_some_and(|last| last.line == line_number && last.path == self.path)
        {
            return Ok(self.matches.len() < self.limit);
        }
        let line = mat.bytes();
        let found = self
            .matcher
            .find(line)
            .map_err(|error| io::Error::other(error.to_string()))?;
        let Some(found) = found else {
            return Ok(true);
        };
        self.matches.push(GrepMatch {
            path: self.path.clone(),
            line: line_number,
            column: character_column(line, found.start()),
            preview: preview_of(line),
        });
        Ok(self.matches.len() < self.limit)
    }
}

/// Searches the contents of non-ignored files under `root`.
fn grep_workspace(
    root: &Path,
    query: &str,
    options: &GrepOptions,
) -> CommandResult<Vec<GrepMatch>> {
    let limit = options.limit as usize;
    if limit == 0 {
        return Ok(Vec::new());
    }
    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(!options.case_sensitive)
        .fixed_strings(!options.regex)
        .word(options.whole_word)
        .build(query)
        .map_err(|error| CommandError::Failed {
            code: "search_bad_pattern",
            message: format!("Invalid pattern: {error}"),
        })?;
    let mut sink = GrepSink::new(matcher.clone(), limit);
    let mut searcher = SearcherBuilder::new()
        .line_number(true)
        .binary_detection(BinaryDetection::quit(b'\0'))
        .build();
    for result in walk_builder(root, Some(MAX_GREP_FILE_BYTES)).build() {
        let entry = result.map_err(walk_error)?;
        if entry.depth() == 0 || !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let path = entry.path();
        let bytes = fs::read(path).map_err(|error| CommandError::Failed {
            code: "search_read_failed",
            message: format!("Could not read {}: {error}", path.display()),
        })?;
        if looks_binary(&bytes) {
            continue;
        }
        sink.path = path.to_string_lossy().into_owned();
        searcher
            .search_slice(matcher.clone(), &bytes, &mut sink)
            .map_err(|error| CommandError::Failed {
                code: "search_failed",
                message: error.to_string(),
            })?;
        if sink.matches.len() >= limit {
            break;
        }
    }
    Ok(sink.matches)
}

/// Lists every non-ignored file and folder under `root`.
#[tauri::command]
pub async fn search_list_tree(root: String) -> CommandResult<Vec<TreeEntry>> {
    blocking(move || {
        let root = checked_root(&root)?;
        collect_tree(&root, MAX_TREE_ENTRIES)
    })
    .await
}

/// Ranks non-ignored files against `query` and returns the best `limit`.
#[tauri::command]
pub async fn search_fuzzy(
    root: String,
    query: String,
    limit: u32,
) -> CommandResult<Vec<TreeEntry>> {
    blocking(move || {
        let root = checked_root(&root)?;
        let files = collect_files(&root)?;
        let mut matcher = new_matcher();
        let scored = fuzzy_filter_files(&root, files, &query, &mut matcher);
        Ok(fuzzy_match_files(scored, limit as usize))
    })
    .await
}

/// Searches file contents under `root`.
#[tauri::command]
pub async fn search_grep(
    root: String,
    query: String,
    options: GrepOptions,
) -> CommandResult<Vec<GrepMatch>> {
    blocking(move || {
        let root = checked_root(&root)?;
        grep_workspace(&root, &query, &options)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::os::unix::fs::symlink;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    /// A folder that removes itself, so a test leaves nothing behind.
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new() -> Self {
            let counter = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "conducted-plat-06-{}-{counter}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create test folder");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn as_string(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    fn write(root: &Path, relative: &str, contents: &[u8]) {
        let path = root.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent folder");
        }
        fs::write(&path, contents).expect("write test file");
    }

    fn options(case_sensitive: bool, whole_word: bool, regex: bool, limit: u32) -> GrepOptions {
        GrepOptions {
            case_sensitive,
            whole_word,
            regex,
            limit,
        }
    }

    #[test]
    fn plat_06_list_tree_skips_ignored_and_git() {
        let folder = TempDir::new();
        let root = folder.path();
        write(root, ".gitignore", b"ignored.txt\nnode_modules/\n");
        write(root, ".git/config", b"x");
        write(root, "ignored.txt", b"i");
        write(root, "node_modules/pkg/index.js", b"j");
        write(root, "src/a.ts", b"a");
        write(root, "keep.md", b"k");

        let entries =
            tauri::async_runtime::block_on(search_list_tree(as_string(root))).expect("list tree");
        let paths: Vec<&str> = entries.iter().map(|entry| entry.path.as_str()).collect();

        assert!(paths.iter().any(|path| path.ends_with("/src/a.ts")));
        assert!(paths.iter().any(|path| path.ends_with("/keep.md")));
        assert!(paths.iter().any(|path| path.ends_with("/src")));
        assert!(!paths.iter().any(|path| path.contains("/.git")));
        assert!(!paths.iter().any(|path| path.ends_with("ignored.txt")));
        assert!(!paths.iter().any(|path| path.contains("node_modules")));
        assert!(
            entries
                .iter()
                .any(|entry| entry.path.ends_with("/src") && entry.is_directory)
        );
    }

    #[test]
    fn plat_06_list_tree_rejects_a_missing_or_file_root() {
        let folder = TempDir::new();
        let missing = folder.path().join("missing");
        let file = folder.path().join("file.txt");
        fs::write(&file, b"x").expect("write file");

        for root in [missing, file] {
            let error = tauri::async_runtime::block_on(search_list_tree(as_string(&root)))
                .expect_err("the root is not a folder");
            assert!(matches!(
                error,
                CommandError::Failed {
                    code: "search_bad_root",
                    ..
                }
            ));
        }
    }

    #[test]
    fn plat_06_tree_too_large_fails_instead_of_cutting_the_list() {
        let folder = TempDir::new();
        let root = folder.path();
        write(root, "a.txt", b"a");
        write(root, "b.txt", b"b");

        let error = collect_tree(root, 1).expect_err("two entries exceed a limit of one");
        assert!(matches!(
            error,
            CommandError::Failed {
                code: "search_tree_too_large",
                ..
            }
        ));
        assert!(collect_tree(root, 2).is_ok());
    }

    #[test]
    fn plat_06_symlink_loop_does_not_hang_the_walk() {
        let folder = TempDir::new();
        let root = folder.path();
        fs::create_dir(root.join("dir")).expect("create folder");
        symlink(root.join("dir"), root.join("dir/loop")).expect("make loop link");

        let entries = collect_tree(root, MAX_TREE_ENTRIES).expect("list tree");

        assert!(entries.len() < 5, "the walk followed the loop: {entries:?}");
    }

    #[test]
    fn plat_06_fuzzy_filter_files_keeps_only_matching_files() {
        let folder = TempDir::new();
        let root = folder.path();
        write(root, "alpha.ts", b"a");
        write(root, "src/alphabet.ts", b"b");
        write(root, "src/a-l-p-h-a.ts", b"c");
        write(root, "gamma.ts", b"d");
        let files = collect_files(root).expect("collect files");
        let mut matcher = new_matcher();

        let scored = fuzzy_filter_files(root, files, "alpha", &mut matcher);
        let names: Vec<String> = scored
            .iter()
            .map(|scored| scored.relative.clone())
            .collect();

        assert!(names.iter().any(|name| name == "alpha.ts"));
        assert!(names.iter().any(|name| name == "src/alphabet.ts"));
        assert!(names.iter().any(|name| name == "src/a-l-p-h-a.ts"));
        assert!(!names.iter().any(|name| name.contains("gamma")));
    }

    #[test]
    fn plat_06_fuzzy_match_files_ranks_and_limits() {
        let folder = TempDir::new();
        let root = folder.path();
        write(root, "alpha.ts", b"a");
        write(root, "src/alphabet.ts", b"b");
        write(root, "src/a-l-p-h-a.ts", b"c");
        write(root, "gamma.ts", b"d");

        let results =
            tauri::async_runtime::block_on(search_fuzzy(as_string(root), "alpha".to_string(), 2))
                .expect("fuzzy search");

        assert_eq!(results.len(), 2);
        assert!(results[0].path.ends_with("alpha.ts"));
    }

    #[test]
    fn plat_06_fuzzy_skips_ignored_files() {
        let folder = TempDir::new();
        let root = folder.path();
        write(root, ".gitignore", b"node_modules/\n");
        write(root, "node_modules/alpha.ts", b"a");
        write(root, "src/alpha.ts", b"b");

        let results =
            tauri::async_runtime::block_on(search_fuzzy(as_string(root), "alpha".to_string(), 10))
                .expect("fuzzy search");

        assert!(
            results
                .iter()
                .all(|entry| !entry.path.contains("node_modules"))
        );
    }

    #[test]
    fn plat_06_grep_reports_line_column_and_preview() {
        let folder = TempDir::new();
        let root = folder.path();
        write(root, "src/app.ts", b"const retry = 1;\nsecond retry\n");

        let matches = grep_workspace(root, "retry", &options(true, false, false, 10))
            .expect("search contents");

        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].line, 1);
        assert_eq!(matches[0].column, 7);
        assert_eq!(matches[0].preview, "const retry = 1;");
        assert!(matches[0].path.ends_with("src/app.ts"));
        assert_eq!(matches[1].line, 2);
        assert_eq!(matches[1].column, 8);
    }

    #[test]
    fn plat_06_grep_honours_case_and_whole_word() {
        let folder = TempDir::new();
        let root = folder.path();
        write(root, "a.txt", b"Retry retrying RETRY\n");
        write(root, "b.txt", b"retrying\n");

        let insensitive = grep_workspace(root, "retry", &options(false, false, false, 10))
            .expect("case-insensitive search");
        assert_eq!(insensitive.len(), 2);

        let whole = grep_workspace(root, "retry", &options(false, true, false, 10))
            .expect("whole-word search");
        assert_eq!(whole.len(), 1);
        assert!(whole[0].path.ends_with("a.txt"));
    }

    #[test]
    fn plat_06_grep_accepts_a_regular_expression() {
        let folder = TempDir::new();
        let root = folder.path();
        write(root, "a.txt", b"abc123\n");

        let matches = grep_workspace(root, r"\d+", &options(true, false, true, 10))
            .expect("regular expression search");

        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].column, 4);
    }

    #[test]
    fn plat_06_grep_rejects_a_bad_pattern_with_the_parser_message() {
        let folder = TempDir::new();
        let root = folder.path();
        write(root, "a.txt", b"x");

        let error = grep_workspace(root, "(", &options(false, false, true, 10))
            .expect_err("a bad pattern fails");

        match error {
            CommandError::Failed { code, message } => {
                assert_eq!(code, "search_bad_pattern");
                assert!(message.starts_with("Invalid pattern"), "message: {message}");
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[test]
    fn plat_06_grep_stops_at_the_limit() {
        let folder = TempDir::new();
        let root = folder.path();
        write(root, "a.txt", b"needle\n");
        write(root, "b.txt", b"needle\n");

        let matches = grep_workspace(root, "needle", &options(false, false, false, 1))
            .expect("search contents");

        assert_eq!(matches.len(), 1);
    }

    #[test]
    fn plat_06_grep_skips_binary_and_large_files() {
        let folder = TempDir::new();
        let root = folder.path();
        write(root, "binary.bin", b"needle\0more");
        let large = root.join("large.txt");
        let mut file = fs::File::create(&large).expect("create large file");
        file.write_all(b"needle\n").expect("write large file");
        file.set_len(MAX_GREP_FILE_BYTES + 1)
            .expect("grow large file");
        drop(file);
        write(root, "ok.txt", b"needle\n");

        let matches = grep_workspace(root, "needle", &options(false, false, false, 10))
            .expect("search contents");

        assert_eq!(matches.len(), 1);
        assert!(matches[0].path.ends_with("ok.txt"));
    }

    #[test]
    fn plat_06_grep_limit_zero_returns_nothing() {
        let folder = TempDir::new();
        let root = folder.path();
        write(root, "a.txt", b"needle\n");

        let matches = grep_workspace(root, "needle", &options(false, false, false, 0))
            .expect("search contents");

        assert!(matches.is_empty());
    }
}
