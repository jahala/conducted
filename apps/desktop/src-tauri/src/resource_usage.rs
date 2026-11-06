//! @feature PLAT-14 CPU and memory per process, grouped by workspace
//!
//! Owns: reading the process table and reporting CPU and memory for the app's own processes:
//! the shell itself, the sidecar, terminals, and the agent programs the sidecar runs.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 (`resource_usage.rs`: process
//! table with memory footprint per terminal and sidecar, command lines redacted). ui-map.md lists
//! the "Resources" popover that shows the result.
//!
//! Must handle:
//! - Report only processes in the app's own tree: the app pid and all its descendants. Never list
//!   other users' or unrelated processes.
//! - CPU percent needs two samples. The first call takes a baseline and returns 0.0 for CPU;
//!   later calls use the time since the previous sample. Samples are kept in shared state.
//! - Memory is the resident size the process table reports. macOS's physical footprint is not
//!   read here.
//! - Group by workspace: a process belongs to the longest workspace path that is a prefix of its
//!   working directory. Processes with no match have no workspace.
//! - A process can vanish between listing and reading. Skip it quietly.
//! - Never return command lines or arguments: they can contain tokens. `name` is the program's
//!   base name only.
//! - The call is cheap enough for the UI to poll every few seconds. It runs on the blocking pool.
//!
//! Our design choice: workspace paths come from the UI as an argument. The `sysinfo` crate reads
//! the process table; we keep our own CPU samples so the command returns the percentage from the
//! time between two calls.
//!
//! Test first: spawn a shell with a child `sleep` under the app's pid in a temp workspace folder;
//! `resource_usage` lists both, grouped under that folder, with no arguments in `name`.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, RefreshKind, System, UpdateKind};
use tauri::State;

use crate::error::{CommandError, CommandResult, blocking};

/// One process. Mirrors `ProcessUsage` in platform.ts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessUsage {
    pub pid: u32,
    /// Program base name without arguments.
    pub name: String,
    /// Share of one core, so 100.0 is one full core and values above 100 are possible.
    pub cpu_percent: f32,
    pub memory_bytes: u64,
    /// The workspace folder this process belongs to, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
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

/// Returns usage for the app's process tree. `workspace_paths` lets the shell group processes.
#[tauri::command]
pub async fn resource_usage(
    state: State<'_, ResourceUsageState>,
    workspace_paths: Vec<String>,
) -> CommandResult<Vec<ProcessUsage>> {
    let previous = Arc::clone(&state.previous);
    let root_pid = std::process::id();
    blocking("resource_usage_failed", move || {
        let mut samples = previous.lock().map_err(|error| CommandError::Failed {
            code: "resource_usage_failed",
            message: format!("The CPU samples could not be read: {error}"),
        })?;
        collect_usage(root_pid, &workspace_paths, &mut samples)
    })
    .await
}

/// Reads the process tree below `root_pid` and turns it into one row per process.
fn collect_usage(
    root_pid: u32,
    workspace_paths: &[String],
    previous: &mut HashMap<u32, CpuSample>,
) -> CommandResult<Vec<ProcessUsage>> {
    let taken_at_ns = now_ns()?;
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
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for process in processes.values() {
        if let Some(parent) = process.parent() {
            children
                .entry(parent.as_u32())
                .or_default()
                .push(process.pid().as_u32());
        }
    }

    let mut seen = HashSet::from([root_pid]);
    let mut queue = VecDeque::from([root_pid]);
    let mut tree = Vec::new();
    while let Some(pid) = queue.pop_front() {
        let Some(process) = processes.get(&Pid::from_u32(pid)) else {
            continue;
        };
        tree.push(process);
        if let Some(kids) = children.get(&pid) {
            for &kid in kids {
                if seen.insert(kid) {
                    queue.push_back(kid);
                }
            }
        }
    }

    let mut next = HashMap::with_capacity(tree.len());
    let mut usage = Vec::with_capacity(tree.len());
    for process in tree {
        let pid = process.pid().as_u32();
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
            name: process.name().to_string_lossy().into_owned(),
            cpu_percent,
            memory_bytes: process.memory(),
            workspace_path: workspace_for(process.cwd(), workspace_paths),
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

    /// Polls until the process table satisfies `ready`, then returns that snapshot.
    fn wait_for(
        root_pid: u32,
        workspace_paths: &[String],
        ready: impl Fn(&[ProcessUsage]) -> bool,
        what: &str,
    ) -> Vec<ProcessUsage> {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let mut previous = HashMap::new();
            let usage = collect_usage(root_pid, workspace_paths, &mut previous)
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
            |usage| {
                usage.iter().any(|process| process.pid == shell_pid)
                    && usage.iter().any(|process| {
                        process.name == "sleep"
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
        assert!(!shell.name.is_empty());
        assert!(!shell.name.contains(' '), "the name carries no arguments");
        assert!(
            !shell.name.contains("sleep"),
            "the name carries no arguments"
        );
        assert_eq!(shell.workspace_path.as_deref(), Some(paths[0].as_str()));
        assert_eq!(shell.cpu_percent, 0.0, "the first sample is a baseline");

        let sleep = usage
            .iter()
            .find(|process| {
                process.name == "sleep"
                    && process.workspace_path.as_deref() == Some(paths[0].as_str())
            })
            .expect("the child sleep is listed");
        assert_eq!(sleep.workspace_path.as_deref(), Some(paths[0].as_str()));
        assert!(sleep.memory_bytes > 0);
        assert!(!sleep.name.contains("60"), "the name carries no arguments");
        assert!(usage.iter().all(|process| process.pid != 1));
    }

    #[test]
    fn plat_14_a_process_that_is_not_there_is_skipped() {
        let mut previous = HashMap::new();
        let usage = collect_usage(u32::MAX, &[], &mut previous).expect("read the process table");
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
}
