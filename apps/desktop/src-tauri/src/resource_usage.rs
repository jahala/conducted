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
//! - Memory is the physical footprint where macOS gives it, otherwise resident size.
//! - Group by workspace: a process belongs to the workspace whose path is a prefix of its working
//!   directory, or whose terminal it descends from. Processes with no match have no workspace.
//! - A process can vanish between listing and reading. Skip it quietly.
//! - Never return command lines or arguments: they can contain tokens. `name` is the program's
//!   base name only.
//! - The call is cheap enough for the UI to poll every few seconds. It runs on the blocking pool.
//!
//! Our design choice: the sidecar's agent children are matched to a workspace by their working
//! directory, because Rust does not track them. Workspace paths come from the UI as an argument.
//! The implementation adds the `sysinfo` crate.
//!
//! Test first: spawn a shell with a child `sleep` under the app's pid in a temp workspace folder;
//! `resource_usage` lists both, grouped under that folder, with no arguments in `name`.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

use crate::error::CommandResult;
use crate::not_implemented;

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
    pub previous: Mutex<HashMap<u32, CpuSample>>,
}

/// Returns usage for the app's process tree. `workspace_paths` lets the shell group processes.
#[tauri::command]
#[allow(unused_variables)]
pub async fn resource_usage(
    state: State<'_, ResourceUsageState>,
    workspace_paths: Vec<String>,
) -> CommandResult<Vec<ProcessUsage>> {
    not_implemented!("PLAT-14")
}
