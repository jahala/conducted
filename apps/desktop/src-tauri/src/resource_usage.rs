//! @feature PLAT-14 CPU and memory per process, grouped by workspace
//!
//! Owns: reading the process table and reporting CPU and memory for the app's own processes:
//! the shell itself, the WebKit helpers that draw and fetch for its window, the sidecar,
//! terminals, and the agent programs the sidecar runs.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 (`resource_usage.rs`: process
//! table with memory footprint per terminal and sidecar, command lines redacted). ui-map.md 1.3
//! describes the "Resources" popover that shows the result: each row carries its parent's pid
//! (the popover's tree), a label, and the terminal it runs in (its "Include terminal processes"
//! toggle). Conductor's binary lists every process with `ps -eo pid=,ppid=,ucomm=,args=`, names
//! the app "Main", its runtime "Sidecar", and WebKit's helpers by the strings `WebKit.WebContent`
//! ("Renderer" on screen), `WebKit.Networking` ("Networking") and `WebKit.GPU`.
//!
//! Must handle:
//! - Report only the app's own processes: the app pid, the WebKit helpers macOS holds the app
//!   responsible for, and all their descendants. Never list other users' or unrelated processes.
//!   WebKit starts its helpers through launchd, so they are not the app's children; the
//!   responsible pid is how macOS ties them to the app that asked for them.
//! - Labels: the app is "Main", the bundled sidecar is "Sidecar", WebKit's WebContent helper is
//!   "Renderer", any other WebKit helper is its name after `com.apple.WebKit.` ("Networking",
//!   "GPU"), and every other process is its program's base name.
//! - A terminal's shell and everything it starts carry the terminal's id.
//! - A zombie (a process that ended and was not yet collected) is not listed; Conductor drops rows
//!   whose command says `<defunct>`. `sysinfo` already leaves zombies out, and a test holds that.
//! - CPU percent needs two samples. The first call takes a baseline and returns 0.0 for CPU;
//!   later calls use the time since the previous sample. Samples are kept in shared state.
//! - Memory is the resident size the process table reports. macOS's physical footprint is not
//!   read here.
//! - Group by workspace: a process belongs to the longest workspace path that is a prefix of its
//!   working directory. Processes with no match have no workspace.
//! - The kernel reports a working directory with symbolic links resolved (on macOS, `/var` and
//!   `/tmp` are links into `/private`). Workspace paths are resolved the same way before they are
//!   compared, and the row carries the path the UI sent. A path that resolves to no folder can
//!   hold no process, so it groups nothing.
//! - A process can vanish between listing and reading. Skip it quietly.
//! - Never return command lines or arguments: they can contain tokens. A label is the program's
//!   base name at most.
//! - The call is cheap enough for the UI to poll every few seconds. It runs on the blocking pool.
//!
//! Our design choice: workspace paths come from the UI as an argument, and terminal ids from the
//! terminal table (`PtyState`). The `sysinfo` crate reads the process table; we keep our own CPU
//! samples so the command returns the percentage from the time between two calls. Our app has no
//! process like Conductor's second `conductor-runtime` or its `ps`, so none is listed.
//!
//! Test first: spawn a shell with a child `sleep` under the app's pid in a temp workspace folder;
//! `resource_usage` lists both, grouped under that folder, with no arguments in the label.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, RefreshKind, System, UpdateKind};
use tauri::State;

use crate::error::{CommandError, CommandResult, blocking, lock};
use crate::pty::PtyState;
use crate::sidecar::SIDECAR_PROGRAM_NAME;

/// One process. Mirrors `ProcessUsage` in platform.ts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessUsage {
    pub pid: u32,
    /// The parent's pid, or 0 when the process table names none.
    pub ppid: u32,
    /// What the popover calls the process. Never carries arguments.
    pub label: String,
    /// Share of one core, so 100.0 is one full core and values above 100 are possible.
    pub cpu_percent: f32,
    pub memory_bytes: u64,
    /// The workspace folder this process belongs to, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
    /// The terminal this process runs in: the terminal's shell or a program started from it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_id: Option<String>,
}

/// CPU time seen at the previous sample, per pid, to compute the next percentage.
#[derive(Debug, Clone, Copy)]
pub struct CpuSample {
    /// Total CPU time used so far, in nanoseconds.
    pub cpu_time_ns: u64,
    /// Wall-clock time of the sample, in nanoseconds since the Unix epoch.
    pub taken_at_ns: u64,
}

/// Shared state, registered once with `.manage(ResourceUsageState::default())`.
#[derive(Default)]
pub struct ResourceUsageState {
    pub previous: Arc<Mutex<HashMap<u32, CpuSample>>>,
}

/// The name WebKit's helper programs start with.
const WEBKIT_PREFIX: &str = "com.apple.WebKit.";

/// Returns usage for the app's processes. `workspace_paths` lets the shell group processes.
#[tauri::command]
pub async fn resource_usage(
    state: State<'_, ResourceUsageState>,
    terminals: State<'_, PtyState>,
    workspace_paths: Vec<String>,
) -> CommandResult<Vec<ProcessUsage>> {
    let previous = Arc::clone(&state.previous);
    let terminal_pids: HashMap<u32, String> = lock(&terminals.sessions)
        .values()
        .filter_map(|session| session.pid.map(|pid| (pid, session.id.clone())))
        .collect();
    let root_pid = std::process::id();
    blocking("resource_usage_failed", move || {
        let mut samples = previous.lock().map_err(|error| CommandError::Failed {
            code: "resource_usage_failed",
            message: format!("The CPU samples could not be read: {error}"),
        })?;
        collect_usage(
            root_pid,
            &workspace_paths,
            &terminal_pids,
            &mut samples,
            &responsible_pid,
        )
    })
    .await
}

/// One row of the process table, as far as choosing and labelling needs it.
#[derive(Debug, Clone)]
struct Listed {
    pid: u32,
    ppid: Option<u32>,
    name: String,
}

/// The pids to report, in breadth-first order: the app, the WebKit helpers it is responsible
/// for, and every descendant of either.
fn app_pids(
    root_pid: u32,
    listed: &[Listed],
    responsible_for: &dyn Fn(u32) -> Option<u32>,
) -> Vec<u32> {
    let children = children_of(listed);
    let mut queue = VecDeque::from([root_pid]);
    for process in listed {
        if process.pid != root_pid
            && webkit_helper(&process.name).is_some()
            && responsible_for(process.pid) == Some(root_pid)
        {
            queue.push_back(process.pid);
        }
    }
    let known: HashSet<u32> = listed.iter().map(|process| process.pid).collect();
    let mut seen: HashSet<u32> = queue.iter().copied().collect();
    let mut order = Vec::new();
    while let Some(pid) = queue.pop_front() {
        if !known.contains(&pid) {
            continue;
        }
        order.push(pid);
        for &kid in children.get(&pid).map(Vec::as_slice).unwrap_or_default() {
            if seen.insert(kid) {
                queue.push_back(kid);
            }
        }
    }
    order
}

fn children_of(listed: &[Listed]) -> HashMap<u32, Vec<u32>> {
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for process in listed {
        if let Some(parent) = process.ppid {
            children.entry(parent).or_default().push(process.pid);
        }
    }
    children
}

/// Each terminal's shell and all its descendants, mapped to the terminal's id.
fn terminal_ids(listed: &[Listed], terminal_pids: &HashMap<u32, String>) -> HashMap<u32, String> {
    let children = children_of(listed);
    let mut owners = HashMap::new();
    for (&shell, id) in terminal_pids {
        let mut queue = VecDeque::from([shell]);
        while let Some(pid) = queue.pop_front() {
            if owners.contains_key(&pid) {
                continue;
            }
            owners.insert(pid, id.clone());
            queue.extend(children.get(&pid).into_iter().flatten().copied());
        }
    }
    owners
}

/// The part of a WebKit helper's name after `com.apple.WebKit.`, if it is one.
fn webkit_helper(name: &str) -> Option<&str> {
    name.strip_prefix(WEBKIT_PREFIX)
        .filter(|helper| !helper.is_empty())
}

/// What the popover calls a process.
fn label_for(pid: u32, root_pid: u32, name: &str) -> String {
    if pid == root_pid {
        return "Main".to_string();
    }
    if name == SIDECAR_PROGRAM_NAME {
        return "Sidecar".to_string();
    }
    match webkit_helper(name) {
        Some(helper) if helper.starts_with("WebContent") => "Renderer".to_string(),
        Some(helper) => helper.to_string(),
        None => name.to_string(),
    }
}

/// The pid macOS holds responsible for `pid`: the app a helper works for.
#[cfg(target_os = "macos")]
fn responsible_pid(pid: u32) -> Option<u32> {
    unsafe extern "C" {
        fn responsibility_get_pid_responsible_for_pid(pid: i32) -> i32;
    }
    let pid = i32::try_from(pid).ok()?;
    // SAFETY: the call takes a pid by value and only reads the kernel's process table.
    let responsible = unsafe { responsibility_get_pid_responsible_for_pid(pid) };
    u32::try_from(responsible).ok().filter(|&found| found > 0)
}

/// Other systems start web helpers as the app's children, so the tree already holds them.
#[cfg(not(target_os = "macos"))]
fn responsible_pid(_pid: u32) -> Option<u32> {
    None
}

/// Reads the app's processes and turns them into one row per process.
fn collect_usage(
    root_pid: u32,
    workspace_paths: &[String],
    terminal_pids: &HashMap<u32, String>,
    previous: &mut HashMap<u32, CpuSample>,
    responsible_for: &dyn Fn(u32) -> Option<u32>,
) -> CommandResult<Vec<ProcessUsage>> {
    let taken_at_ns = now_ns()?;
    let workspaces = resolve_workspaces(workspace_paths);
    let resolved_paths: Vec<String> = workspaces.keys().cloned().collect();
    let refresh = ProcessRefreshKind::nothing()
        .with_cpu()
        .with_memory()
        .with_cwd(UpdateKind::Always);
    let system = System::new_with_specifics(RefreshKind::nothing().with_processes(refresh))
        .map_err(|error| CommandError::Failed {
            code: "resource_usage_failed",
            message: format!("The process table could not be read: {error}"),
        })?;

    let processes = system.processes();
    let listed: Vec<Listed> = processes
        .values()
        .map(|process| Listed {
            pid: process.pid().as_u32(),
            ppid: process.parent().map(Pid::as_u32),
            name: process.name().to_string_lossy().into_owned(),
        })
        .collect();
    let terminals = terminal_ids(&listed, terminal_pids);

    let mut next = HashMap::new();
    let mut usage = Vec::new();
    for pid in app_pids(root_pid, &listed, responsible_for) {
        let Some(process) = processes.get(&Pid::from_u32(pid)) else {
            continue;
        };
        let sample = CpuSample {
            cpu_time_ns: process.accumulated_cpu_time().saturating_mul(1_000_000),
            taken_at_ns,
        };
        let cpu_percent = previous
            .get(&pid)
            .map_or(0.0, |last| percent_between(*last, sample));
        next.insert(pid, sample);
        usage.push(ProcessUsage {
            pid,
            ppid: process.parent().map_or(0, Pid::as_u32),
            label: label_for(pid, root_pid, &process.name().to_string_lossy()),
            cpu_percent,
            memory_bytes: process.memory(),
            workspace_path: workspace_for(process.cwd(), &resolved_paths)
                .and_then(|resolved| workspaces.get(&resolved).cloned()),
            terminal_id: terminals.get(&pid).cloned(),
        });
    }
    *previous = next;
    usage.sort_by_key(|process| process.pid);
    Ok(usage)
}

/// The percentage of one core used between two samples.
fn percent_between(previous: CpuSample, current: CpuSample) -> f32 {
    let cpu_ns = current.cpu_time_ns.saturating_sub(previous.cpu_time_ns);
    let wall_ns = current.taken_at_ns.saturating_sub(previous.taken_at_ns);
    if wall_ns == 0 {
        return 0.0;
    }
    ((cpu_ns as f64 / wall_ns as f64) * 100.0) as f32
}

/// Each absolute workspace path with its symbolic links resolved, mapped to the path as sent.
/// The kernel reports working directories in resolved form, so they are compared in that form.
fn resolve_workspaces(workspace_paths: &[String]) -> HashMap<String, String> {
    workspace_paths
        .iter()
        .filter(|given| Path::new(given.as_str()).is_absolute())
        .filter_map(|given| {
            let resolved = std::fs::canonicalize(given).ok()?;
            Some((resolved.to_string_lossy().into_owned(), given.clone()))
        })
        .collect()
}

/// The longest absolute workspace path that contains `cwd`, if any.
fn workspace_for(cwd: Option<&Path>, workspace_paths: &[String]) -> Option<String> {
    let cwd = cwd?;
    let mut best: Option<(&String, usize)> = None;
    for workspace in workspace_paths {
        let path = Path::new(workspace);
        if workspace.is_empty() || !path.is_absolute() || !cwd.starts_with(path) {
            continue;
        }
        let components = path.components().count();
        if best.is_none_or(|(_, best_components)| components > best_components) {
            best = Some((workspace, components));
        }
    }
    best.map(|(workspace, _)| workspace.clone())
}

/// The wall clock in nanoseconds since the Unix epoch.
fn now_ns() -> CommandResult<u64> {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| CommandError::Failed {
            code: "resource_usage_failed",
            message: format!("The system clock is before the Unix epoch: {error}"),
        })?;
    Ok(elapsed.as_nanos().min(u128::from(u64::MAX)) as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::process::CommandExt;
    use std::path::PathBuf;
    use std::process::{Child, Command};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{Duration, Instant};

    /// A folder under the run's temp folder that removes itself, so a test leaves nothing behind.
    struct TempWorkspace {
        path: PathBuf,
    }

    impl TempWorkspace {
        fn new() -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let counter = COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "conducted-plat-14-{}-{counter}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).expect("create the test workspace");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempWorkspace {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    /// A shell that stays alive with a `sleep` child, in its own process group.
    struct ShellTree {
        child: Child,
    }

    impl ShellTree {
        fn spawn_in(workspace: &Path) -> Self {
            let child = Command::new("/bin/sh")
                .arg("-c")
                .arg("sleep 60 & wait")
                .current_dir(workspace)
                .process_group(0)
                .spawn()
                .expect("spawn the test shell");
            Self { child }
        }

        fn pid(&self) -> u32 {
            self.child.id()
        }
    }

    impl Drop for ShellTree {
        fn drop(&mut self) {
            crate::process_group::terminate_group(self.child.id(), Duration::from_millis(200));
            let _ = self.child.wait();
        }
    }

    /// A responsible-pid lookup that ties no process to the app.
    fn no_helpers(_pid: u32) -> Option<u32> {
        None
    }

    fn listed(pid: u32, ppid: Option<u32>, name: &str) -> Listed {
        Listed {
            pid,
            ppid,
            name: name.to_string(),
        }
    }

    /// Polls until the process table satisfies `ready`, then returns that snapshot.
    fn wait_for(
        root_pid: u32,
        workspace_paths: &[String],
        terminal_pids: &HashMap<u32, String>,
        ready: impl Fn(&[ProcessUsage]) -> bool,
        what: &str,
    ) -> Vec<ProcessUsage> {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let mut previous = HashMap::new();
            let usage = collect_usage(
                root_pid,
                workspace_paths,
                terminal_pids,
                &mut previous,
                &no_helpers,
            )
            .expect("read the process tree");
            if ready(&usage) {
                return usage;
            }
            assert!(Instant::now() < deadline, "{what} never appeared");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn plat_14_lists_the_app_tree_grouped_by_workspace_without_arguments() {
        let workspace = TempWorkspace::new();
        let tree = ShellTree::spawn_in(workspace.path());
        let paths = vec![workspace.path().to_string_lossy().into_owned()];

        let shell_pid = tree.pid();
        let usage = wait_for(
            std::process::id(),
            &paths,
            &HashMap::new(),
            |usage| {
                usage.iter().any(|process| process.pid == shell_pid)
                    && usage.iter().any(|process| {
                        process.label == "sleep"
                            && process.workspace_path.as_deref() == Some(paths[0].as_str())
                    })
            },
            "the shell and its sleep child",
        );
        assert!(!usage.is_empty());

        let shell = usage
            .iter()
            .find(|process| process.pid == tree.pid())
            .expect("the shell is listed");
        assert!(!shell.label.is_empty());
        assert!(!shell.label.contains(' '), "the label carries no arguments");
        assert!(
            !shell.label.contains("sleep"),
            "the label carries no arguments"
        );
        assert_eq!(shell.workspace_path.as_deref(), Some(paths[0].as_str()));
        assert_eq!(shell.cpu_percent, 0.0, "the first sample is a baseline");

        let sleep = usage
            .iter()
            .find(|process| {
                process.label == "sleep"
                    && process.workspace_path.as_deref() == Some(paths[0].as_str())
            })
            .expect("the child sleep is listed");
        assert_eq!(sleep.workspace_path.as_deref(), Some(paths[0].as_str()));
        assert!(sleep.memory_bytes > 0);
        assert!(
            !sleep.label.contains("60"),
            "the label carries no arguments"
        );
        assert_eq!(sleep.ppid, shell.pid, "the sleep names its shell as parent");
        assert_eq!(sleep.terminal_id, None, "no terminal was given");
        assert!(usage.iter().all(|process| process.pid != 1));
    }

    #[test]
    fn plat_14_a_process_that_is_not_there_is_skipped() {
        let mut previous = HashMap::new();
        let usage = collect_usage(u32::MAX, &[], &HashMap::new(), &mut previous, &no_helpers)
            .expect("read the process table");
        assert!(usage.is_empty());
    }

    #[test]
    fn plat_14_cpu_percent_uses_the_time_between_samples() {
        let previous = CpuSample {
            cpu_time_ns: 2_000_000_000,
            taken_at_ns: 10_000_000_000,
        };
        let current = CpuSample {
            cpu_time_ns: 3_000_000_000,
            taken_at_ns: 12_000_000_000,
        };
        assert!((percent_between(previous, current) - 50.0).abs() < f32::EPSILON);
        assert_eq!(
            percent_between(
                previous,
                CpuSample {
                    taken_at_ns: previous.taken_at_ns,
                    ..current
                }
            ),
            0.0
        );
    }

    #[test]
    fn plat_14_a_workspace_path_is_compared_with_its_links_resolved() {
        let workspace = TempWorkspace::new();
        let real = workspace.path().join("real");
        let link = workspace.path().join("link");
        std::fs::create_dir(&real).expect("create the real folder");
        std::os::unix::fs::symlink(&real, &link).expect("link to the real folder");
        let link_path = link.to_string_lossy().into_owned();
        let resolved = std::fs::canonicalize(&real)
            .expect("resolve the real folder")
            .to_string_lossy()
            .into_owned();

        let workspaces = resolve_workspaces(&[
            link_path.clone(),
            "relative".to_string(),
            String::new(),
            workspace
                .path()
                .join("missing")
                .to_string_lossy()
                .into_owned(),
        ]);

        assert_eq!(workspaces.len(), 1, "only the folder that exists is kept");
        assert_eq!(workspaces.get(&resolved), Some(&link_path));
    }

    #[test]
    fn plat_14_a_workspace_is_the_longest_prefix_of_the_working_directory() {
        let paths = vec![
            "/tmp/ws".to_string(),
            "/tmp/ws/nested".to_string(),
            "relative".to_string(),
            String::new(),
        ];
        assert_eq!(
            workspace_for(Some(Path::new("/tmp/ws/nested/src")), &paths),
            Some("/tmp/ws/nested".to_string())
        );
        assert_eq!(
            workspace_for(Some(Path::new("/tmp/ws/other")), &paths),
            Some("/tmp/ws".to_string())
        );
        assert_eq!(workspace_for(Some(Path::new("/tmp/other")), &paths), None);
        assert_eq!(workspace_for(None, &paths), None);
    }

    #[test]
    fn plat_14_labels_the_app_its_sidecar_and_webkit_helpers() {
        assert_eq!(label_for(10, 10, "conducted"), "Main");
        assert_eq!(label_for(11, 10, SIDECAR_PROGRAM_NAME), "Sidecar");
        assert_eq!(label_for(12, 10, "com.apple.WebKit.WebContent"), "Renderer");
        assert_eq!(
            label_for(13, 10, "com.apple.WebKit.Networking"),
            "Networking"
        );
        assert_eq!(label_for(14, 10, "com.apple.WebKit.GPU"), "GPU");
        assert_eq!(label_for(15, 10, "claude"), "claude");
        assert_eq!(label_for(16, 10, "com.apple.WebKit."), "com.apple.WebKit.");
    }

    #[test]
    fn plat_14_lists_the_webkit_helpers_the_app_is_responsible_for() {
        let table = vec![
            listed(10, Some(1), "conducted"),
            listed(11, Some(10), SIDECAR_PROGRAM_NAME),
            listed(20, Some(1), "com.apple.WebKit.WebContent"),
            listed(21, Some(1), "com.apple.WebKit.Networking"),
            listed(22, Some(20), "child-of-helper"),
            listed(30, Some(1), "com.apple.WebKit.WebContent"),
            listed(31, Some(1), "Safari"),
        ];
        let responsible = |pid: u32| match pid {
            20 | 21 => Some(10),
            30 => Some(31),
            _ => None,
        };
        let mut pids = app_pids(10, &table, &responsible);
        pids.sort_unstable();
        assert_eq!(pids, vec![10, 11, 20, 21, 22]);
    }

    #[test]
    fn plat_14_marks_a_terminal_and_everything_it_started() {
        let workspace = TempWorkspace::new();
        let tree = ShellTree::spawn_in(workspace.path());
        let shell_pid = tree.pid();
        let terminals = HashMap::from([(shell_pid, "term-1".to_string())]);

        let usage = wait_for(
            std::process::id(),
            &[],
            &terminals,
            |usage| {
                usage
                    .iter()
                    .any(|process| process.label == "sleep" && process.ppid == shell_pid)
            },
            "the shell's sleep child",
        );

        let shell = usage
            .iter()
            .find(|process| process.pid == shell_pid)
            .expect("the shell is listed");
        let sleep = usage
            .iter()
            .find(|process| process.ppid == shell_pid)
            .expect("the sleep is listed");
        assert_eq!(shell.terminal_id.as_deref(), Some("term-1"));
        assert_eq!(sleep.terminal_id.as_deref(), Some("term-1"));
        let main = usage
            .iter()
            .find(|process| process.pid == std::process::id())
            .expect("the app is listed");
        assert_eq!(main.label, "Main");
        assert_eq!(main.terminal_id, None);
    }

    #[test]
    fn plat_14_skips_a_process_that_ended_and_was_not_collected() {
        let mut child = Command::new("/usr/bin/true")
            .spawn()
            .expect("spawn a program that ends at once");
        let pid = child.id();
        // The kernel's own table is the judge: `ps` prints the state letter only, Z for a zombie.
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let state = Command::new("/bin/ps")
                .args(["-o", "stat=", "-p", &pid.to_string()])
                .output()
                .expect("run ps");
            if String::from_utf8_lossy(&state.stdout)
                .trim_start()
                .starts_with('Z')
            {
                break;
            }
            assert!(Instant::now() < deadline, "the child never became a zombie");
            std::thread::sleep(Duration::from_millis(20));
        }

        let mut previous = HashMap::new();
        let usage = collect_usage(
            std::process::id(),
            &[],
            &HashMap::new(),
            &mut previous,
            &no_helpers,
        )
        .expect("read the process tree");
        let _ = child.wait();
        assert!(
            usage
                .iter()
                .any(|process| process.pid == std::process::id()),
            "the test process itself is listed"
        );
        assert!(usage.iter().all(|process| process.pid != pid));
    }

    #[test]
    fn plat_14_asks_macos_which_app_is_responsible_for_a_process() {
        if cfg!(target_os = "macos") {
            assert!(responsible_pid(std::process::id()).is_some());
        }
        assert_eq!(responsible_pid(u32::MAX), None);
    }
}
