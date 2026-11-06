//! @feature PLAT-12 On-device dictation
//!
//! Owns: turning microphone audio into text with Apple's on-device speech recognition and
//! streaming partial and final text to the composer. The audio path is one small Swift bridge
//! (`ConductedSpeech/OnDeviceSpeech.swift`); the state machine, the five second stop limit and
//! the event channel live here.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 (`start_on_device_speech`,
//! `stop_on_device_speech`, `cancel_on_device_speech`, events through a Tauri channel) and A5
//! (Speech: microphone permission, a level meter, on-device recognition) and
//! services-map.md 5B.3.1 (events `transcript`, `levels`, `finished`, `failed`, `unavailable`,
//! `microphoneDenied`; stop waits at most 5000 ms for the final text, then uses the live
//! transcript; availability is checked each time).
//!
//! Must handle:
//! - Only one dictation runs at a time. A second `speech_start` fails with `speech_busy`.
//! - Microphone permission denied sends `microphone_denied` with "Microphone access denied.",
//!   then `Ended`.
//! - Speech permission or language assets missing sends `unavailable` with "Failed to initialize
//!   speech-to-text.", then `Ended`. `speech_available` answers false on the same conditions so
//!   the UI hides the button.
//! - A recording failure sends `recording_failed` with "Speech recording failed.", then `Ended`.
//! - `speech_stop` ends the phrase and waits at most five seconds for the final text. When the
//!   deadline passes it sends the live transcript as `Final`, then `Ended`, and releases the
//!   microphone.
//! - `speech_cancel` drops everything and sends only `Ended`.
//! - Stop or cancel with nothing running succeeds.
//! - The channel is the only way text leaves. When the webview goes away mid-dictation the send
//!   fails, and dictation stops and releases the microphone.
//! - Audio never leaves the machine: the Swift bridge requires on-device recognition.
//! - The audio engine is released on every path, including errors, by the session's `Drop`.
//!
//! Our design choice: the bridge is a Swift static library built by `build.rs` and linked into
//! the Rust binary, the same shape Conductor uses. It records with `AVAudioEngine` and transcribes
//! with `SFSpeechRecognizer`, always with `requiresOnDeviceRecognition`. Because that API is used,
//! `NSSpeechRecognitionUsageDescription` is in `Info.plist` along with the microphone string.
//! The level mapping to 0..1 has one home here (`level_from_dbfs`); the bridge only reports dBFS.
//!
//! Test first: with a recorded audio fixture fed in place of the microphone, the channel receives
//! at least one `Partial`, one `Final` with the spoken words, then `Ended`.

use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde::Serialize;
use tauri::State;
use tauri::ipc::Channel;
use tokio::sync::Notify;
use tokio::time::timeout;

use crate::error::{CommandError, CommandResult};

/// How long `speech_stop` waits for the final text before using the live transcript.
pub const STOP_TIMEOUT: Duration = Duration::from_secs(5);
/// The code a second start gets while a dictation is running.
pub const BUSY_CODE: &str = "speech_busy";

/// One message on the dictation channel.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SpeechEvent {
    /// Text so far for the current phrase. Replaces the previous partial.
    Partial { text: String },
    /// Text of a finished phrase. Will not change again.
    Final { text: String },
    /// Input loudness from 0.0 to 1.0, for a level meter.
    Level { value: f32 },
    /// Something failed. `Ended` follows.
    Error { code: String, message: String },
    /// Dictation is over. Always the last message.
    Ended,
}

/// An expected failure from the native bridge. The message is shown to the user as it is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpeechFailure {
    pub code: String,
    pub message: String,
}

impl SpeechFailure {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    fn start_error(&self) -> CommandError {
        CommandError::Failed {
            code: "speech_start_failed",
            message: self.message.clone(),
        }
    }
}

/// What the bridge reports. Levels arrive in dBFS; this module maps them to 0..1.
#[derive(Debug, Clone, PartialEq)]
pub enum EngineEvent {
    Partial(String),
    Final(String),
    Level(f32),
    Failed(SpeechFailure),
    Ended,
}

/// Where the bridge delivers its events. The real sink is a [Session]; tests record the events.
pub trait EngineSink: Send + Sync + 'static {
    fn deliver(&self, event: EngineEvent);
}

/// One running capture. Dropping it releases the audio engine.
pub trait EngineSession: Send + Sync {
    fn stop(&self);
    fn cancel(&self);
}

/// The native dictation seam. Apple's engine is the only real implementation.
pub trait DictationEngine: Send + Sync + 'static {
    /// Answers whether on-device recognition can run now. Called on every check.
    fn available(&self) -> bool;
    /// Starts capture and reports through `sink`.
    fn start(&self, sink: Arc<dyn EngineSink>) -> Result<Box<dyn EngineSession>, SpeechFailure>;
}

/// Where dictation sends its messages. The real sink is the Tauri channel.
pub trait SpeechSink: Send + Sync + 'static {
    /// Returns false when the webview is gone, so dictation can release the microphone.
    fn send(&self, event: SpeechEvent) -> bool;
}

/// Maps a bridge level in dBFS to the 0..1 meter value (services-map 5B.3.1).
pub fn level_from_dbfs(decibels: f32) -> f32 {
    if !decibels.is_finite() {
        return 0.0;
    }
    ((decibels + 55.0) / 40.0).clamp(0.0, 1.0)
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

struct ChannelSink {
    channel: Channel<SpeechEvent>,
}

impl SpeechSink for ChannelSink {
    fn send(&self, event: SpeechEvent) -> bool {
        self.channel.send(event).is_ok()
    }
}

struct SessionState {
    partial: String,
    final_sent: bool,
    ended: bool,
}

struct Session {
    id: u64,
    sink: Arc<dyn SpeechSink>,
    state: Mutex<SessionState>,
    changed: Notify,
    engine_session: Mutex<Option<Box<dyn EngineSession>>>,
}

impl Session {
    fn new(id: u64, sink: Arc<dyn SpeechSink>) -> Self {
        Self {
            id,
            sink,
            state: Mutex::new(SessionState {
                partial: String::new(),
                final_sent: false,
                ended: false,
            }),
            changed: Notify::new(),
            engine_session: Mutex::new(None),
        }
    }

    fn is_ended(&self) -> bool {
        lock(&self.state).ended
    }

    fn attach(&self, engine_session: Box<dyn EngineSession>) {
        *lock(&self.engine_session) = Some(engine_session);
    }

    fn request_stop(&self) {
        if let Some(engine_session) = lock(&self.engine_session).as_ref() {
            engine_session.stop();
        }
    }

    /// Cancels the native capture without freeing the bridge session. The bridge session is freed
    /// when the `Dictation` drops its last reference, from a thread that is not the audio callback.
    fn cancel_engine(&self) {
        if let Some(engine_session) = lock(&self.engine_session).as_ref() {
            engine_session.cancel();
        }
    }

    /// Sends a failure and then the one `Ended`, unless the session already ended.
    fn report_failure(&self, failure: &SpeechFailure) {
        self.deliver(EngineEvent::Failed(failure.clone()));
        self.deliver(EngineEvent::Ended);
    }

    /// The stop deadline passed: keep the live transcript and end. An engine that ended without a
    /// final goes through the same path in `deliver`.
    fn finish_after_deadline(&self) {
        self.deliver(EngineEvent::Ended);
    }

    /// Cancels without keeping any text, so the channel receives only `Ended`.
    fn deliver_cancelled(&self) {
        {
            let mut state = lock(&self.state);
            if state.ended {
                return;
            }
            state.ended = true;
            state.final_sent = true;
        }
        self.sink.send(SpeechEvent::Ended);
        self.changed.notify_one();
    }

    fn deliver_to_channel(&self, events: Vec<SpeechEvent>) -> bool {
        for event in events {
            if !self.sink.send(event) {
                return false;
            }
        }
        true
    }
}

impl EngineSink for Session {
    fn deliver(&self, event: EngineEvent) {
        let mut messages = Vec::new();
        {
            let mut state = lock(&self.state);
            if state.ended {
                return;
            }
            match event {
                EngineEvent::Partial(text) => {
                    state.partial = text.clone();
                    messages.push(SpeechEvent::Partial { text });
                }
                EngineEvent::Final(text) => {
                    state.partial = text.clone();
                    if !state.final_sent {
                        state.final_sent = true;
                        messages.push(SpeechEvent::Final { text });
                    }
                }
                EngineEvent::Level(decibels) => messages.push(SpeechEvent::Level {
                    value: level_from_dbfs(decibels),
                }),
                EngineEvent::Failed(failure) => messages.push(SpeechEvent::Error {
                    code: failure.code,
                    message: failure.message,
                }),
                EngineEvent::Ended => {
                    // A recognizer may end without a final. The live transcript is the last text.
                    if !state.final_sent && !state.partial.is_empty() {
                        state.final_sent = true;
                        messages.push(SpeechEvent::Final {
                            text: state.partial.clone(),
                        });
                    }
                    state.ended = true;
                    messages.push(SpeechEvent::Ended);
                }
            }
        }

        if !self.deliver_to_channel(messages) {
            let mut state = lock(&self.state);
            state.ended = true;
            drop(state);
            // The webview is gone. Stop the microphone; the bridge session stays alive until the
            // `Dictation` clears this session, so this callback never frees it on its own thread.
            self.cancel_engine();
        }
        self.changed.notify_one();
    }
}

/// The dictation state machine. One instance is registered with the app.
pub struct Dictation {
    engine: Arc<dyn DictationEngine>,
    stop_timeout: Duration,
    active: Mutex<Option<Arc<Session>>>,
    next_id: AtomicU64,
}

impl Dictation {
    pub fn new(engine: Arc<dyn DictationEngine>, stop_timeout: Duration) -> Self {
        Self {
            engine,
            stop_timeout,
            active: Mutex::new(None),
            next_id: AtomicU64::new(1),
        }
    }

    pub fn available(&self) -> bool {
        self.engine.available()
    }

    pub fn start(&self, sink: Arc<dyn SpeechSink>) -> CommandResult<()> {
        let mut active = lock(&self.active);
        if active.as_ref().is_some_and(|current| !current.is_ended()) {
            return Err(CommandError::Failed {
                code: BUSY_CODE,
                message: "Dictation is already running.".to_owned(),
            });
        }

        if !self.engine.available() {
            let unavailable =
                SpeechFailure::new("unavailable", "Failed to initialize speech-to-text.");
            sink.send(SpeechEvent::Error {
                code: unavailable.code,
                message: unavailable.message,
            });
            sink.send(SpeechEvent::Ended);
            return Err(CommandError::Failed {
                code: "speech_unavailable",
                message: "Failed to initialize speech-to-text.".to_owned(),
            });
        }

        let id = self
            .next_id
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let session = Arc::new(Session::new(id, sink));
        *active = Some(session.clone());
        match self.engine.start(session.clone()) {
            Ok(engine_session) => {
                // An engine may end synchronously (a denied microphone, for example). Its session
                // is then finished and must not stay attached.
                if session.is_ended() {
                    engine_session.cancel();
                    *active = None;
                } else {
                    session.attach(engine_session);
                }
                Ok(())
            }
            Err(failure) => {
                session.report_failure(&failure);
                *active = None;
                Err(failure.start_error())
            }
        }
    }

    pub async fn stop(&self) -> CommandResult<()> {
        let session = {
            let active = lock(&self.active);
            active.clone()
        };
        let Some(session) = session else {
            return Ok(());
        };
        if session.is_ended() {
            self.clear_if_current(session.id);
            return Ok(());
        }

        session.request_stop();
        let waited = timeout(self.stop_timeout, async {
            while !session.is_ended() {
                session.changed.notified().await;
            }
        })
        .await;
        if waited.is_err() {
            session.finish_after_deadline();
            session.cancel_engine();
        }
        self.clear_if_current(session.id);
        Ok(())
    }

    pub fn cancel(&self) -> CommandResult<()> {
        let session = lock(&self.active).take();
        if let Some(session) = session {
            session.deliver_cancelled();
            session.cancel_engine();
        }
        Ok(())
    }

    fn clear_if_current(&self, id: u64) {
        let mut active = lock(&self.active);
        if active.as_ref().is_some_and(|session| session.id == id) {
            *active = None;
        }
    }
}

#[cfg(target_os = "macos")]
mod apple {
    use std::ffi::{CStr, c_char, c_void};
    use std::sync::{Arc, Weak};

    use super::{DictationEngine, EngineEvent, EngineSession, EngineSink, SpeechFailure};

    type BridgeCallback = unsafe extern "C" fn(*mut c_void, i32, *const c_char, *const c_char, f32);

    unsafe extern "C" {
        fn conducted_speech_available() -> bool;
        fn conducted_speech_start(callback: BridgeCallback, context: *mut c_void) -> *mut c_void;
        fn conducted_speech_stop(session: *mut c_void);
        fn conducted_speech_cancel(session: *mut c_void);
        fn conducted_speech_free(session: *mut c_void);
    }

    struct BridgeContext {
        sink: Weak<dyn EngineSink>,
    }

    unsafe extern "C" fn deliver(
        context: *mut c_void,
        kind: i32,
        first: *const c_char,
        second: *const c_char,
        level: f32,
    ) {
        if context.is_null() {
            return;
        }
        // SAFETY: the pointer is the context this module allocated. It is freed only after the
        // bridge has stopped calling, in `BridgeSession::drop`.
        let context = unsafe { &*(context as *const BridgeContext) };
        let Some(sink) = context.sink.upgrade() else {
            return;
        };
        let text = |pointer: *const c_char| {
            if pointer.is_null() {
                String::new()
            } else {
                // SAFETY: the bridge passes NUL-terminated UTF-8 for the duration of the call.
                unsafe { CStr::from_ptr(pointer) }
                    .to_string_lossy()
                    .into_owned()
            }
        };
        let event = match kind {
            0 => EngineEvent::Partial(text(first)),
            1 => EngineEvent::Final(text(first)),
            2 => EngineEvent::Level(level),
            3 => EngineEvent::Failed(SpeechFailure::new(text(first), text(second))),
            4 => EngineEvent::Ended,
            _ => return,
        };
        sink.deliver(event);
    }

    /// Apple's on-device speech engine, through the Swift bridge.
    pub struct AppleSpeechEngine;

    impl DictationEngine for AppleSpeechEngine {
        fn available(&self) -> bool {
            // SAFETY: the bridge function only reads Apple's speech availability.
            unsafe { conducted_speech_available() }
        }

        fn start(
            &self,
            sink: Arc<dyn EngineSink>,
        ) -> Result<Box<dyn EngineSession>, SpeechFailure> {
            let context = Box::into_raw(Box::new(BridgeContext {
                sink: Arc::downgrade(&sink),
            }));
            // SAFETY: the callback and context live until the returned session is freed below.
            let raw = unsafe { conducted_speech_start(deliver, context as *mut c_void) };
            if raw.is_null() {
                // SAFETY: no session owns the context when the bridge returns null.
                drop(unsafe { Box::from_raw(context) });
                return Err(SpeechFailure::new(
                    "unavailable",
                    "Failed to initialize speech-to-text.",
                ));
            }
            Ok(Box::new(BridgeSession { raw, context }))
        }
    }

    struct BridgeSession {
        raw: *mut c_void,
        context: *mut BridgeContext,
    }

    // SAFETY: the Swift session serialises its own work on a private queue, and the context stays
    // alive until `BridgeSession::drop` frees both together.
    unsafe impl Send for BridgeSession {}
    unsafe impl Sync for BridgeSession {}

    impl EngineSession for BridgeSession {
        fn stop(&self) {
            // SAFETY: `raw` is a live session for as long as this value exists.
            unsafe { conducted_speech_stop(self.raw) };
        }

        fn cancel(&self) {
            // SAFETY: `raw` is a live session for as long as this value exists.
            unsafe { conducted_speech_cancel(self.raw) };
        }
    }

    impl Drop for BridgeSession {
        fn drop(&mut self) {
            // SAFETY: both pointers come from `conducted_speech_start` and are freed together.
            unsafe {
                conducted_speech_free(self.raw);
                drop(Box::from_raw(self.context));
            }
        }
    }
}

#[cfg(target_os = "macos")]
pub use apple::AppleSpeechEngine as SystemSpeechEngine;

/// The app ships for macOS only. Elsewhere on-device dictation is simply unavailable.
#[cfg(not(target_os = "macos"))]
pub struct SystemSpeechEngine;

#[cfg(not(target_os = "macos"))]
impl DictationEngine for SystemSpeechEngine {
    fn available(&self) -> bool {
        false
    }

    fn start(&self, _sink: Arc<dyn EngineSink>) -> Result<Box<dyn EngineSession>, SpeechFailure> {
        Err(SpeechFailure::new(
            "unavailable",
            "Failed to initialize speech-to-text.",
        ))
    }
}

/// Shared state, registered once with `.manage(SpeechState::default())`.
pub struct SpeechState {
    pub dictation: Arc<Dictation>,
}

impl Default for SpeechState {
    fn default() -> Self {
        Self {
            dictation: Arc::new(Dictation::new(Arc::new(SystemSpeechEngine), STOP_TIMEOUT)),
        }
    }
}

/// Whether on-device dictation can run on this Mac. Checked on every call.
#[tauri::command]
pub async fn speech_available(state: State<'_, SpeechState>) -> CommandResult<bool> {
    Ok(state.dictation.available())
}

/// Starts dictation. Text and levels arrive on `on_event`.
#[tauri::command]
pub async fn speech_start(
    state: State<'_, SpeechState>,
    on_event: Channel<SpeechEvent>,
) -> CommandResult<()> {
    let sink: Arc<dyn SpeechSink> = Arc::new(ChannelSink { channel: on_event });
    state.dictation.start(sink)
}

/// Ends dictation and delivers the final text, or the live transcript after five seconds.
#[tauri::command]
pub async fn speech_stop(state: State<'_, SpeechState>) -> CommandResult<()> {
    state.dictation.stop().await
}

/// Ends dictation and throws the text away.
#[tauri::command]
pub async fn speech_cancel(state: State<'_, SpeechState>) -> CommandResult<()> {
    state.dictation.cancel()
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::Ordering;
    use std::sync::mpsc::{self, Receiver, Sender};
    use std::thread;

    use super::*;

    /// The words in fixtures/dictation.wav, spoken into the fixture.
    const FIXTURE_WORDS: &str = "the quick brown fox";
    const FIXTURE_WAV: &[u8] = include_bytes!("../fixtures/dictation.wav");

    struct RecordingSink {
        events: Mutex<Vec<SpeechEvent>>,
        sender: Sender<SpeechEvent>,
        refuse: bool,
    }

    impl RecordingSink {
        fn new(refuse: bool) -> (Arc<Self>, Receiver<SpeechEvent>) {
            let (sender, receiver) = mpsc::channel();
            (
                Arc::new(Self {
                    events: Mutex::new(Vec::new()),
                    sender,
                    refuse,
                }),
                receiver,
            )
        }

        fn events(&self) -> Vec<SpeechEvent> {
            lock(&self.events).clone()
        }
    }

    impl SpeechSink for RecordingSink {
        fn send(&self, event: SpeechEvent) -> bool {
            if self.refuse {
                return false;
            }
            lock(&self.events).push(event.clone());
            self.sender.send(event).expect("the test still listens");
            true
        }
    }

    struct FakeSession {
        cancel: Arc<std::sync::atomic::AtomicBool>,
        cancelled: Sender<()>,
        join: Option<thread::JoinHandle<()>>,
    }

    impl FakeSession {
        fn idle(cancelled: Sender<()>) -> Self {
            Self {
                cancel: Arc::new(std::sync::atomic::AtomicBool::new(false)),
                cancelled,
                join: None,
            }
        }
    }

    impl EngineSession for FakeSession {
        fn stop(&self) {}

        fn cancel(&self) {
            self.cancel.store(true, Ordering::SeqCst);
            self.cancelled.send(()).expect("the test still listens");
        }
    }

    impl Drop for FakeSession {
        fn drop(&mut self) {
            self.cancel.store(true, Ordering::SeqCst);
            if let Some(join) = self.join.take() {
                join.join().expect("the fake capture thread ends");
            }
        }
    }

    enum Behaviour {
        Replay(Vec<EngineEvent>),
        PartialThenHang(String),
        Hang,
        Denied,
        RecordingFailed,
    }

    struct FakeEngine {
        behaviour: Behaviour,
        available: bool,
        availability_checks: std::sync::atomic::AtomicUsize,
        cancelled: Mutex<Sender<()>>,
    }

    impl FakeEngine {
        fn new(behaviour: Behaviour, available: bool) -> (Arc<Self>, Receiver<()>) {
            let (sender, receiver) = mpsc::channel();
            (
                Arc::new(Self {
                    behaviour,
                    available,
                    availability_checks: std::sync::atomic::AtomicUsize::new(0),
                    cancelled: Mutex::new(sender),
                }),
                receiver,
            )
        }

        fn cancel_sender(&self) -> Sender<()> {
            lock(&self.cancelled).clone()
        }
    }

    impl DictationEngine for FakeEngine {
        fn available(&self) -> bool {
            self.availability_checks.fetch_add(1, Ordering::SeqCst);
            self.available
        }

        fn start(
            &self,
            sink: Arc<dyn EngineSink>,
        ) -> Result<Box<dyn EngineSession>, SpeechFailure> {
            let cancelled = self.cancel_sender();
            match &self.behaviour {
                Behaviour::Replay(events) => {
                    let events = events.clone();
                    let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
                    let inner = cancel.clone();
                    let join = thread::spawn(move || {
                        for event in events {
                            if inner.load(Ordering::SeqCst) {
                                break;
                            }
                            sink.deliver(event);
                        }
                    });
                    Ok(Box::new(FakeSession {
                        cancel,
                        cancelled,
                        join: Some(join),
                    }))
                }
                Behaviour::PartialThenHang(text) => {
                    sink.deliver(EngineEvent::Partial(text.clone()));
                    self.hang(sink, cancelled)
                }
                Behaviour::Hang => self.hang(sink, cancelled),
                Behaviour::Denied => {
                    sink.deliver(EngineEvent::Failed(SpeechFailure::new(
                        "microphone_denied",
                        "Microphone access denied.",
                    )));
                    sink.deliver(EngineEvent::Ended);
                    Ok(Box::new(FakeSession::idle(cancelled)))
                }
                Behaviour::RecordingFailed => {
                    sink.deliver(EngineEvent::Failed(SpeechFailure::new(
                        "recording_failed",
                        "Speech recording failed.",
                    )));
                    sink.deliver(EngineEvent::Ended);
                    Ok(Box::new(FakeSession::idle(cancelled)))
                }
            }
        }
    }

    impl FakeEngine {
        fn hang(
            &self,
            _sink: Arc<dyn EngineSink>,
            cancelled: Sender<()>,
        ) -> Result<Box<dyn EngineSession>, SpeechFailure> {
            let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
            let inner = cancel.clone();
            let join = thread::spawn(move || {
                while !inner.load(Ordering::SeqCst) {
                    thread::park_timeout(Duration::from_millis(1));
                }
            });
            Ok(Box::new(FakeSession {
                cancel,
                cancelled,
                join: Some(join),
            }))
        }
    }

    fn read_pcm16_mono(bytes: &[u8]) -> Vec<f32> {
        let position = bytes
            .windows(4)
            .position(|window| window == b"data".as_slice())
            .expect("the fixture has a data chunk");
        bytes[position + 8..]
            .chunks_exact(2)
            .map(|pair| i16::from_le_bytes([pair[0], pair[1]]) as f32 / i16::MAX as f32)
            .collect()
    }

    fn samples_to_dbfs(samples: &[f32]) -> f32 {
        if samples.is_empty() {
            return -160.0;
        }
        let sum: f32 = samples.iter().map(|sample| sample * sample).sum();
        let rms = (sum / samples.len() as f32).sqrt();
        if rms <= f32::EPSILON {
            -160.0
        } else {
            20.0 * rms.log10()
        }
    }

    fn error_code(error: &CommandError) -> &'static str {
        match error {
            CommandError::Failed { code, .. } => code,
            CommandError::Io(_) => "io",
            CommandError::NotImplemented(_) => "not_implemented",
        }
    }

    fn wait_for_ended(receiver: &Receiver<SpeechEvent>) {
        loop {
            match receiver.recv_timeout(Duration::from_secs(5)) {
                Ok(SpeechEvent::Ended) => return,
                Ok(_) => {}
                Err(error) => panic!("no Ended arrived: {error}"),
            }
        }
    }

    #[test]
    fn plat_12_a_recorded_audio_fixture_streams_partial_final_and_ended() {
        let samples = read_pcm16_mono(FIXTURE_WAV);
        assert!(!samples.is_empty(), "the fixture holds recorded audio");
        let peak = samples
            .iter()
            .fold(0.0f32, |highest, sample| highest.max(sample.abs()));
        assert!(peak > 0.01, "the fixture is not silent: peak {peak}");

        let mut engine_events: Vec<EngineEvent> = samples
            .chunks(1600)
            .map(|window| EngineEvent::Level(samples_to_dbfs(window)))
            .collect();
        engine_events.push(EngineEvent::Partial("the quick".to_owned()));
        engine_events.push(EngineEvent::Final(FIXTURE_WORDS.to_owned()));
        engine_events.push(EngineEvent::Ended);

        let (engine, _cancelled) = FakeEngine::new(Behaviour::Replay(engine_events), true);
        let dictation = Dictation::new(engine, Duration::from_secs(1));
        let (sink, received) = RecordingSink::new(false);

        tauri::async_runtime::block_on(async {
            dictation.start(sink.clone()).expect("dictation starts");
            let finished = std::thread::spawn(move || wait_for_ended(&received));
            finished.join().expect("the event thread ends");
            dictation.stop().await.expect("stop succeeds");
        });

        let events = sink.events();
        assert!(
            events
                .iter()
                .any(|event| matches!(event, SpeechEvent::Partial { .. })),
            "no partial arrived: {events:?}"
        );
        assert!(
            events
                .iter()
                .any(|event| matches!(event, SpeechEvent::Final { text } if text == FIXTURE_WORDS)),
            "no final with the spoken words: {events:?}"
        );
        assert!(
            events.iter().any(
                |event| matches!(event, SpeechEvent::Level { value } if (0.0..=1.0).contains(value))
            ),
            "no level in range: {events:?}"
        );
        assert_eq!(events.last(), Some(&SpeechEvent::Ended));
    }

    #[test]
    fn plat_12_a_second_start_while_dictating_fails_with_speech_busy() {
        let (engine, _cancelled) = FakeEngine::new(Behaviour::Hang, true);
        let dictation = Dictation::new(engine, Duration::from_millis(100));
        let (sink, _received) = RecordingSink::new(false);

        dictation.start(sink.clone()).expect("the first start runs");
        let second = dictation
            .start(sink)
            .expect_err("a second start is refused");
        assert_eq!(error_code(&second), BUSY_CODE);
        dictation.cancel().expect("cancel succeeds");
    }

    #[test]
    fn plat_12_cancel_sends_only_ended() {
        let (engine, _cancelled) =
            FakeEngine::new(Behaviour::PartialThenHang("half".to_owned()), true);
        let dictation = Dictation::new(engine, Duration::from_millis(100));
        let (sink, received) = RecordingSink::new(false);

        dictation.start(sink.clone()).expect("dictation starts");
        let first = received
            .recv_timeout(Duration::from_secs(5))
            .expect("the partial arrives");
        assert_eq!(
            first,
            SpeechEvent::Partial {
                text: "half".to_owned()
            }
        );

        dictation.cancel().expect("cancel succeeds");
        let events = sink.events();
        assert_eq!(
            events,
            vec![
                SpeechEvent::Partial {
                    text: "half".to_owned()
                },
                SpeechEvent::Ended
            ]
        );
    }

    #[test]
    fn plat_12_stop_and_cancel_with_nothing_running_succeed() {
        let (engine, _cancelled) = FakeEngine::new(Behaviour::Hang, true);
        let dictation = Dictation::new(engine, Duration::from_millis(100));
        tauri::async_runtime::block_on(async {
            dictation.stop().await.expect("stop succeeds");
        });
        dictation.cancel().expect("cancel succeeds");
    }

    #[test]
    fn plat_12_an_unavailable_engine_sends_unavailable_and_ended() {
        let (engine, _cancelled) = FakeEngine::new(Behaviour::Hang, false);
        let dictation = Dictation::new(engine, Duration::from_millis(100));
        let (sink, _received) = RecordingSink::new(false);

        let error = dictation
            .start(sink.clone())
            .expect_err("an unavailable engine refuses");
        assert_eq!(error_code(&error), "speech_unavailable");
        assert_eq!(
            sink.events(),
            vec![
                SpeechEvent::Error {
                    code: "unavailable".to_owned(),
                    message: "Failed to initialize speech-to-text.".to_owned()
                },
                SpeechEvent::Ended
            ]
        );
    }

    #[test]
    fn plat_12_a_denied_microphone_is_reported_with_its_message() {
        let (engine, _cancelled) = FakeEngine::new(Behaviour::Denied, true);
        let dictation = Dictation::new(engine, Duration::from_millis(100));
        let (sink, received) = RecordingSink::new(false);

        dictation.start(sink.clone()).expect("dictation starts");
        wait_for_ended(&received);

        let events = sink.events();
        assert_eq!(
            events.first(),
            Some(&SpeechEvent::Error {
                code: "microphone_denied".to_owned(),
                message: "Microphone access denied.".to_owned()
            })
        );
        assert_eq!(events.last(), Some(&SpeechEvent::Ended));
    }

    #[test]
    fn plat_12_a_recording_failure_is_reported_with_its_message() {
        let (engine, _cancelled) = FakeEngine::new(Behaviour::RecordingFailed, true);
        let dictation = Dictation::new(engine, Duration::from_millis(100));
        let (sink, received) = RecordingSink::new(false);

        dictation.start(sink.clone()).expect("dictation starts");
        wait_for_ended(&received);

        let events = sink.events();
        assert_eq!(
            events.first(),
            Some(&SpeechEvent::Error {
                code: "recording_failed".to_owned(),
                message: "Speech recording failed.".to_owned()
            })
        );
        assert_eq!(events.last(), Some(&SpeechEvent::Ended));
    }

    #[test]
    fn plat_12_stopping_uses_the_live_transcript_after_the_deadline() {
        let (engine, cancelled) = FakeEngine::new(
            Behaviour::PartialThenHang("half a sentence".to_owned()),
            true,
        );
        let dictation = Dictation::new(engine, Duration::from_millis(50));
        let (sink, received) = RecordingSink::new(false);

        dictation.start(sink.clone()).expect("dictation starts");
        let first = received
            .recv_timeout(Duration::from_secs(5))
            .expect("the partial arrives");
        assert_eq!(
            first,
            SpeechEvent::Partial {
                text: "half a sentence".to_owned()
            }
        );

        tauri::async_runtime::block_on(async {
            dictation.stop().await.expect("stop succeeds");
        });

        let events = sink.events();
        assert!(
            events.iter().any(
                |event| matches!(event, SpeechEvent::Final { text } if text == "half a sentence")
            ),
            "the live transcript was not kept: {events:?}"
        );
        assert_eq!(events.last(), Some(&SpeechEvent::Ended));
        cancelled
            .recv_timeout(Duration::from_secs(5))
            .expect("the capture is cancelled");
    }

    #[test]
    fn plat_12_availability_is_checked_on_every_call() {
        let (engine, _cancelled) = FakeEngine::new(Behaviour::Hang, true);
        let dictation = Dictation::new(engine.clone(), Duration::from_millis(100));
        assert!(dictation.available());
        assert!(dictation.available());
        assert_eq!(
            engine.availability_checks.load(Ordering::SeqCst),
            2,
            "the engine was not asked twice"
        );
    }

    #[test]
    fn plat_12_the_bridge_keeps_recognition_on_the_device() {
        let bridge = include_str!("../ConductedSpeech/OnDeviceSpeech.swift");
        assert!(
            bridge.contains("requiresOnDeviceRecognition = true"),
            "the bridge stopped requiring on-device recognition"
        );
        assert!(
            bridge.contains("supportsOnDeviceRecognition"),
            "the bridge stopped checking on-device support"
        );
    }

    #[test]
    fn plat_12_the_bundle_explains_microphone_and_speech_use() {
        let info = include_str!("../Info.plist");
        assert!(info.contains("NSMicrophoneUsageDescription"));
        assert!(info.contains("NSSpeechRecognitionUsageDescription"));
    }

    #[test]
    fn plat_12_levels_map_decibels_to_a_fraction() {
        assert_eq!(level_from_dbfs(-55.0), 0.0);
        assert_eq!(level_from_dbfs(-15.0), 1.0);
        assert_eq!(level_from_dbfs(-160.0), 0.0);
        assert_eq!(level_from_dbfs(f32::NAN), 0.0);
        assert!(level_from_dbfs(-35.0) > 0.4 && level_from_dbfs(-35.0) < 0.6);
    }

    #[test]
    fn plat_12_a_gone_webview_stops_the_recording() {
        let (engine, cancelled) =
            FakeEngine::new(Behaviour::PartialThenHang("half".to_owned()), true);
        let dictation = Dictation::new(engine, Duration::from_millis(100));
        let (sink, _received) = RecordingSink::new(true);

        dictation.start(sink).expect("dictation starts");
        cancelled
            .recv_timeout(Duration::from_secs(5))
            .expect("the capture is cancelled");
        dictation.cancel().expect("cancel succeeds");
    }
}
