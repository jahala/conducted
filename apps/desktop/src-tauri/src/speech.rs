//! @feature PLAT-12 On-device dictation
//!
//! Owns: turning microphone audio into text with Apple's on-device speech recognition and
//! streaming partial and final text to the composer.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 (`start_on_device_speech`,
//! `stop_on_device_speech`, `cancel_on_device_speech`, events through a Tauri channel) and A5
//! (Speech: a Swift file, errors such as "microphoneDenied" and "No audio format is compatible
//! with the transcriber", a level meter queue; the API is probably SpeechAnalyzer, which is
//! inferred and unverified).
//!
//! Must handle:
//! - Only one dictation runs at a time. A second `speech_start` fails with `speech_busy`.
//! - Microphone or speech permission denied: send `SpeechEvent::Error` with the code
//!   `speech_mic_denied` or `speech_recognition_denied`, then `Ended`. Do not crash.
//! - Language assets for on-device recognition may be missing: fail with `speech_unavailable`;
//!   `speech_available` returns false in that case so the UI hides the button.
//! - `speech_stop` finishes the current phrase and sends the final text, then `Ended`.
//!   `speech_cancel` drops everything and sends only `Ended`.
//! - Stop or cancel with nothing running succeeds.
//! - The channel is the only way text leaves. When the webview goes away mid-dictation the send
//!   fails, and dictation stops and releases the microphone.
//! - Audio never leaves the machine: recognition must require on-device mode.
//! - Release the audio engine on every path, including errors.
//!
//! Our design choice: the shell bridges to Apple's Speech framework through an objc2 binding or a
//! small Swift static library built from build.rs. Pick one when implementing; both need
//! `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription` in an `Info.plist`
//! next to tauri.conf.json, and the `com.apple.security.device.audio-input` entitlement for a
//! signed build.
//!
//! Test first: with a recorded audio fixture fed in place of the microphone, the channel receives
//! at least one `Partial`, one `Final` with the spoken words, then `Ended`.

use std::sync::Mutex;

use serde::Serialize;
use tauri::State;
use tauri::ipc::Channel;

use crate::error::CommandResult;
use crate::not_implemented;

/// One message on the dictation channel.
#[derive(Debug, Clone, Serialize)]
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

/// Shared state, registered once with `.manage(SpeechState::default())`.
#[derive(Default)]
pub struct SpeechState {
    /// True while a dictation is running. Guards the one-at-a-time rule.
    pub active: Mutex<bool>,
}

/// Whether on-device dictation can run on this Mac.
#[tauri::command]
#[allow(unused_variables)]
pub async fn speech_available() -> CommandResult<bool> {
    not_implemented!("PLAT-12")
}

/// Starts dictation. Text and levels arrive on `on_event`.
#[tauri::command]
#[allow(unused_variables)]
pub async fn speech_start(
    state: State<'_, SpeechState>,
    on_event: Channel<SpeechEvent>,
) -> CommandResult<()> {
    not_implemented!("PLAT-12")
}

/// Ends dictation and delivers the final text.
#[tauri::command]
#[allow(unused_variables)]
pub async fn speech_stop(state: State<'_, SpeechState>) -> CommandResult<()> {
    not_implemented!("PLAT-12")
}

/// Ends dictation and throws the text away.
#[tauri::command]
#[allow(unused_variables)]
pub async fn speech_cancel(state: State<'_, SpeechState>) -> CommandResult<()> {
    not_implemented!("PLAT-12")
}
