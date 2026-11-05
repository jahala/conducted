//! @feature PLAT-03 Shell commands: run, start, cancel
//!
//! Owns: signalling a whole process group by its id, without starting a helper program.
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 (`cancel_shell_command` kills
//! the command's whole process group).
//!
//! Our design choice: one `killpg(2)` call instead of spawning `/bin/kill` for every signal and
//! every liveness poll. Children are spawned with `process_group(0)`, so the child's id is also
//! the group id. PLAT-07's terminals will use the same helper for their own kills.

use std::thread;
use std::time::{Duration, Instant};

/// SIGTERM.
pub const SIGTERM: i32 = 15;
/// SIGKILL.
pub const SIGKILL: i32 = 9;

unsafe extern "C" {
    fn killpg(pgrp: i32, signal: i32) -> i32;
}

/// Sends `signal` to the process group `pgrp`. True when the call succeeded. A group id of 0 is
/// refused, because the kernel would read it as the caller's own group.
pub fn signal_group(pgrp: u32, signal: i32) -> bool {
    if pgrp == 0 {
        return false;
    }
    // SAFETY: killpg takes a process group id and a signal number and reads no other memory.
    unsafe { killpg(pgrp as i32, signal) == 0 }
}

/// True when the process group still exists.
pub fn group_exists(pgrp: u32) -> bool {
    signal_group(pgrp, 0)
}

/// Ends a whole process group: SIGTERM, then SIGKILL after `grace`.
pub fn terminate_group(pgrp: u32, grace: Duration) {
    if !signal_group(pgrp, SIGTERM) {
        return;
    }
    let deadline = Instant::now() + grace;
    while Instant::now() < deadline {
        if !group_exists(pgrp) {
            return;
        }
        thread::sleep(Duration::from_millis(20));
    }
    let _ = signal_group(pgrp, SIGKILL);
}
