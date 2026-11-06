// The one native bridge for PLAT-12 on-device dictation. It records the microphone with
// AVAudioEngine and transcribes with SFSpeechRecognizer, always requiring on-device recognition.
// Rust owns the state machine and turns these events into Tauri channel messages.
//
// Events cross the C boundary as
//   (context, kind, a, b, level)
// where kind is 0 partial, 1 final, 2 level in dBFS, 3 error, 4 ended. For an error, `a` is the
// code and `b` is the message. All strings are NUL-terminated UTF-8 and valid only for the call.
// Every callback is delivered on the session's own queue, and `shutdown` waits for that queue,
// so the Rust context is never used after `conducted_speech_free` returns.

import AVFoundation
import Foundation
import Speech

public typealias ConductedSpeechCallback = @convention(c) (
    UnsafeMutableRawPointer?, Int32, UnsafePointer<CChar>?, UnsafePointer<CChar>?, Float
) -> Void

private let kindPartial: Int32 = 0
private let kindFinal: Int32 = 1
private let kindLevel: Int32 = 2
private let kindError: Int32 = 3
private let kindEnded: Int32 = 4

private let microphoneDenied = ("microphone_denied", "Microphone access denied.")
private let unavailable = ("unavailable", "Failed to initialize speech-to-text.")
private let recordingFailed = ("recording_failed", "Speech recording failed.")

private func emit(
    _ callback: ConductedSpeechCallback,
    _ context: UnsafeMutableRawPointer?,
    _ kind: Int32,
    _ a: String? = nil,
    _ b: String? = nil,
    _ level: Float = 0
) {
    if let a, let b {
        a.withCString { first in
            b.withCString { second in
                callback(context, kind, first, second, level)
            }
        }
    } else if let a {
        a.withCString { callback(context, kind, $0, nil, level) }
    } else {
        callback(context, kind, nil, nil, level)
    }
}

/// One recording attempt. Every field after `queue` is touched only on `queue`.
private final class SpeechSession {
    private let callback: ConductedSpeechCallback
    private let context: UnsafeMutableRawPointer?
    private let recognizer: SFSpeechRecognizer
    private let queue = DispatchQueue(label: "build.conducted.speech")
    private let engine = AVAudioEngine()

    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var tapInstalled = false
    private var active = true
    private var ended = false
    private var cancelled = false
    private var stopping = false
    private var lastText = ""

    init(
        callback: @escaping ConductedSpeechCallback,
        context: UnsafeMutableRawPointer?,
        recognizer: SFSpeechRecognizer
    ) {
        self.callback = callback
        self.context = context
        self.recognizer = recognizer
    }

    func begin() {
        requestMicrophone { [weak self] granted in
            guard let self else { return }
            self.queue.async {
                guard self.active else { return }
                if !granted {
                    self.fail(microphoneDenied)
                    return
                }
                self.requestSpeech { granted in
                    self.queue.async {
                        guard self.active else { return }
                        if !granted {
                            self.fail(unavailable)
                            return
                        }
                        self.startRecognition()
                    }
                }
            }
        }
    }

    func stop() {
        queue.async {
            guard self.active, !self.ended else { return }
            self.stopping = true
            self.teardownAudio()
            self.request?.endAudio()
            // The recognizer usually finishes before this. If it does not, the text so far is
            // still delivered before Rust's own five second limit.
            self.queue.asyncAfter(deadline: .now() + 4.5) {
                if self.active, !self.ended { self.finish() }
            }
        }
    }

    func cancel() {
        queue.async {
            guard self.active, !self.ended else { return }
            self.cancelled = true
            self.teardownAudio()
            self.task?.cancel()
            self.task = nil
            self.request = nil
            self.sendEnded()
        }
    }

    /// Stops every source of callbacks before the Rust context is freed.
    func shutdown() {
        queue.sync {
            self.active = false
            self.teardownAudio()
            self.task?.cancel()
            self.task = nil
            self.request = nil
            if !self.ended { self.sendEnded() }
        }
    }

    private func startRecognition() {
        if ended || !active { return }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = true
        self.request = request

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        if format.channelCount == 0 {
            fail(unavailable)
            return
        }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
            self.publishLevel(buffer)
        }
        tapInstalled = true

        engine.prepare()
        do {
            try engine.start()
        } catch {
            fail(recordingFailed)
            return
        }

        task = recognizer.recognitionTask(with: request) { result, error in
            self.queue.async { self.handle(result: result, error: error) }
        }
    }

    private func handle(result: SFSpeechRecognitionResult?, error: Error?) {
        guard active, !ended, !cancelled else { return }
        if let result {
            let text = result.bestTranscription.formattedString
            if result.isFinal {
                lastText = text
                finish()
                return
            }
            if !text.isEmpty && text != lastText {
                lastText = text
                emit(callback, context, kindPartial, text)
            }
            return
        }
        if error != nil {
            // A cancelled or stopped task reports an error that is not a failure.
            if cancelled || stopping {
                finish()
                return
            }
            fail(recordingFailed)
        }
    }

    private func publishLevel(_ buffer: AVAudioPCMBuffer) {
        guard let channels = buffer.floatChannelData, buffer.frameLength > 0 else { return }
        let samples = channels[0]
        var sum: Float = 0
        for index in 0..<Int(buffer.frameLength) {
            let value = samples[index]
            sum += value * value
        }
        let rms = (sum / Float(buffer.frameLength)).squareRoot()
        let decibels = rms > 0 ? 20 * log10(rms) : -160
        // The buffer is only valid during the tap, so the value is copied before the dispatch.
        queue.async {
            guard self.active, !self.ended else { return }
            emit(self.callback, self.context, kindLevel, nil, nil, decibels)
        }
    }

    private func finish() {
        if ended { return }
        teardownAudio()
        if !lastText.isEmpty {
            emit(callback, context, kindFinal, lastText)
        }
        sendEnded()
    }

    private func fail(_ failure: (String, String)) {
        if ended { return }
        teardownAudio()
        task?.cancel()
        task = nil
        request = nil
        emit(callback, context, kindError, failure.0, failure.1)
        sendEnded()
    }

    private func sendEnded() {
        if ended { return }
        ended = true
        // Break the retain cycles to the task and the tap before the session is released.
        task?.cancel()
        task = nil
        request = nil
        emit(callback, context, kindEnded)
    }

    private func teardownAudio() {
        if tapInstalled {
            engine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        if engine.isRunning { engine.stop() }
    }

    private func requestMicrophone(_ completion: @escaping (Bool) -> Void) {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            completion(true)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { granted in completion(granted) }
        default:
            completion(false)
        }
    }

    private func requestSpeech(_ completion: @escaping (Bool) -> Void) {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized:
            completion(true)
        case .notDetermined:
            SFSpeechRecognizer.requestAuthorization { status in
                completion(status == .authorized)
            }
        default:
            completion(false)
        }
    }
}

@_cdecl("conducted_speech_available")
public func conductedSpeechAvailable() -> Bool {
    if #available(macOS 10.15, *) {
        guard let recognizer = SFSpeechRecognizer(locale: Locale.current) else { return false }
        return recognizer.supportsOnDeviceRecognition
    }
    return false
}

@_cdecl("conducted_speech_start")
public func conductedSpeechStart(
    _ callback: ConductedSpeechCallback?,
    _ context: UnsafeMutableRawPointer?
) -> UnsafeMutableRawPointer? {
    guard let callback else { return nil }
    guard #available(macOS 10.15, *) else {
        emit(callback, context, kindError, unavailable.0, unavailable.1)
        emit(callback, context, kindEnded)
        return nil
    }
    guard let recognizer = SFSpeechRecognizer(locale: Locale.current),
          recognizer.supportsOnDeviceRecognition
    else {
        emit(callback, context, kindError, unavailable.0, unavailable.1)
        emit(callback, context, kindEnded)
        return nil
    }
    let session = SpeechSession(callback: callback, context: context, recognizer: recognizer)
    session.begin()
    return Unmanaged.passRetained(session).toOpaque()
}

@_cdecl("conducted_speech_stop")
public func conductedSpeechStop(_ raw: UnsafeMutableRawPointer?) {
    guard let raw else { return }
    Unmanaged<SpeechSession>.fromOpaque(raw).takeUnretainedValue().stop()
}

@_cdecl("conducted_speech_cancel")
public func conductedSpeechCancel(_ raw: UnsafeMutableRawPointer?) {
    guard let raw else { return }
    Unmanaged<SpeechSession>.fromOpaque(raw).takeUnretainedValue().cancel()
}

@_cdecl("conducted_speech_free")
public func conductedSpeechFree(_ raw: UnsafeMutableRawPointer?) {
    guard let raw else { return }
    let session = Unmanaged<SpeechSession>.fromOpaque(raw).takeUnretainedValue()
    session.shutdown()
    Unmanaged<SpeechSession>.fromOpaque(raw).release()
}
