//! @feature PLAT-26 Online and offline events
//!
//! Owns: the network change watcher, the `network_status` command and the `network://changed`
//! event that tells the UI whether the Mac has a network connection.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 (`network_change.rs` watches
//! the system's network state), A4 and A5 (`network-changed` reports a network that came or went;
//! Conductor watches `SCDynamicStore` and logs "Failed to create network change store"),
//! services-map.md 6 (startup starts the network listener so services hear changes).
//!
//! Must handle: a watcher that cannot start is an error, not a silent startup; every change of
//! connectivity is reported once, and a callback that repeats the current state reports nothing;
//! `network_status` reads the live state and stores it, and a read that fails is an error rather
//! than a made-up answer; the watcher reports the answer the command reads because both use the
//! same reachability rule.
//!
//! Our design choice: the watcher asks `SCNetworkReachability` for a public address instead of
//! watching every `SCDynamicStore` key. It gives the same offline/online fact with less to parse.
//! Our design choice: the event payload is the boolean `online` that `SystemFacts.onNetworkChanged`
//! receives, so the UI never decodes an event-shaped object.
//!
//! Test first: a repeated connectivity state emits `network://changed` only once, and a change
//! from offline to online emits the new state.

use std::sync::mpsc::Sender;
use std::sync::{Mutex, MutexGuard, PoisonError};

use core_foundation::runloop::{CFRunLoop, kCFRunLoopCommonModes};
use system_configuration::network_reachability::{ReachabilityFlags, SCNetworkReachability};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::error::{CommandError, CommandResult};

/// Event carrying the new online state after the Mac gains or loses its connection.
pub const EVENT_NETWORK_CHANGED: &str = "network://changed";

/// The host the reachability check asks about. A numeric address needs no DNS lookup.
const PROBE_HOST: &std::ffi::CStr = c"1.1.1.1";

/// The last connectivity answer the app saw.
#[derive(Default)]
pub struct NetworkState {
    online: Mutex<Option<bool>>,
}

impl NetworkState {
    fn get(&self) -> Option<bool> {
        *lock(&self.online)
    }

    fn set(&self, online: bool) {
        *lock(&self.online) = Some(online);
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Whether reachability flags mean the Mac can reach the network. A connection that still has to
/// be brought up, or that needs the user to intervene, is offline for our purpose.
pub fn online_from_flags(flags: ReachabilityFlags) -> bool {
    flags.contains(ReachabilityFlags::REACHABLE)
        && !flags.contains(ReachabilityFlags::CONNECTION_REQUIRED)
        && !flags.contains(ReachabilityFlags::INTERVENTION_REQUIRED)
}

fn reachability() -> CommandResult<SCNetworkReachability> {
    SCNetworkReachability::from_host(PROBE_HOST).ok_or_else(|| CommandError::Failed {
        code: "network_status_failed",
        message: "Could not watch the Mac's network connection.".to_string(),
    })
}

/// Reads the Mac's current connectivity. The watcher and the command both use this answer.
pub fn read_online() -> CommandResult<bool> {
    let reachability = reachability()?;
    let flags = reachability
        .reachability()
        .map_err(|error| CommandError::Failed {
            code: "network_status_failed",
            message: format!("Could not read the Mac's network state: {error}"),
        })?;
    Ok(online_from_flags(flags))
}

/// The current connectivity, for `SystemFacts.isOnline`. Stores the answer so a later event and
/// the command agree.
#[tauri::command]
pub fn network_status(state: State<'_, NetworkState>) -> CommandResult<bool> {
    let online = read_online()?;
    state.set(online);
    Ok(online)
}

/// Records a connectivity answer and tells the UI when it differs from the last one. Returns
/// whether the event was sent.
pub fn publish_change<R: Runtime>(app: &AppHandle<R>, online: bool) -> bool {
    let state = app.state::<NetworkState>();
    if state.get() == Some(online) {
        return false;
    }
    state.set(online);
    if let Err(error) = app.emit(EVENT_NETWORK_CHANGED, online) {
        // The event only wakes a window that is listening. `network_status` reads the same stored
        // answer, so a failed emit loses no fact the UI can ask for.
        eprintln!("network watcher: could not report the network change: {error}");
    }
    true
}

/// Starts the watcher on a worker thread with its own run loop. Called once from `setup`.
/// Returns after the watcher is registered, so a watcher that cannot start fails startup.
pub fn start_watcher(app: AppHandle) -> CommandResult<()> {
    let (sender, started) = std::sync::mpsc::channel::<CommandResult<()>>();
    let _watcher = std::thread::Builder::new()
        .name("network-watch".to_string())
        .spawn(move || watch(app, sender))
        .map_err(|error| CommandError::Failed {
            code: "network_watch_failed",
            message: format!("Could not start the network watcher: {error}"),
        })?;
    started.recv().unwrap_or_else(|_| {
        Err(CommandError::Failed {
            code: "network_watch_failed",
            message: "The network watcher stopped before it started.".to_string(),
        })
    })
}

fn watch(app: AppHandle, started: Sender<CommandResult<()>>) {
    let reachability = match prepare(&app) {
        Ok(reachability) => reachability,
        Err(error) => {
            report_start_error(&started, error);
            return;
        }
    };
    if started.send(Ok(())).is_err() {
        // The caller stopped waiting for the watcher.
        return;
    }
    let _reachability = reachability;
    CFRunLoop::run_current();
}

fn report_start_error(started: &Sender<CommandResult<()>>, error: CommandError) {
    if started.send(Err(error)).is_err() {
        eprintln!("network watcher: the startup result could not be delivered");
    }
}

fn prepare(app: &AppHandle) -> CommandResult<SCNetworkReachability> {
    let mut reachability = reachability()?;
    let initial = reachability
        .reachability()
        .map_err(|error| CommandError::Failed {
            code: "network_watch_failed",
            message: format!("Could not read the Mac's network state: {error}"),
        })?;
    app.state::<NetworkState>().set(online_from_flags(initial));

    let callback_app = app.clone();
    reachability
        .set_callback(move |flags| {
            publish_change(&callback_app, online_from_flags(flags));
        })
        .map_err(|error| CommandError::Failed {
            code: "network_watch_failed",
            message: format!("Could not set the network watcher callback: {error}"),
        })?;
    let run_loop = CFRunLoop::get_current();
    // SAFETY: the run loop mode is the Apple-provided common mode, as the crate documents.
    unsafe { reachability.schedule_with_runloop(&run_loop, kCFRunLoopCommonModes) }.map_err(
        |error| CommandError::Failed {
            code: "network_watch_failed",
            message: format!("Could not schedule the network watcher: {error}"),
        },
    )?;
    Ok(reachability)
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc::Receiver;
    use std::time::Duration;

    use tauri::Listener;
    use tauri::test::{MockRuntime, mock_app};

    use super::*;

    fn app_listening() -> (tauri::App<MockRuntime>, Receiver<bool>) {
        let app = mock_app();
        app.manage(NetworkState::default());
        let (sender, events) = std::sync::mpsc::channel::<bool>();
        app.handle().listen(EVENT_NETWORK_CHANGED, move |event| {
            if let Ok(online) = serde_json::from_str::<bool>(event.payload()) {
                if sender.send(online).is_err() {
                    return;
                }
            }
        });
        (app, events)
    }

    #[test]
    fn plat_26_a_connectivity_change_is_reported_once() {
        let (app, events) = app_listening();

        assert!(publish_change(app.handle(), false));
        let offline = events
            .recv_timeout(Duration::from_secs(5))
            .expect("going offline is reported");
        assert!(!offline, "the event carried online");

        assert!(!publish_change(app.handle(), false));
        assert!(publish_change(app.handle(), true));
        let online = events
            .recv_timeout(Duration::from_secs(5))
            .expect("coming online is reported");
        assert!(
            online,
            "a repeated state must not be reported before the real change"
        );
    }

    #[test]
    fn plat_26_reachability_flags_decide_online() {
        assert!(online_from_flags(ReachabilityFlags::REACHABLE));
        assert!(!online_from_flags(ReachabilityFlags::empty()));
        assert!(!online_from_flags(
            ReachabilityFlags::REACHABLE | ReachabilityFlags::CONNECTION_REQUIRED
        ));
        assert!(!online_from_flags(
            ReachabilityFlags::REACHABLE | ReachabilityFlags::INTERVENTION_REQUIRED
        ));
    }

    #[test]
    fn plat_26_network_status_reads_the_live_state_and_stores_it() {
        let app = mock_app();
        app.manage(NetworkState::default());

        let online = network_status(app.state::<NetworkState>())
            .expect("the Mac should report its network state");
        assert_eq!(app.state::<NetworkState>().get(), Some(online));
    }
}
