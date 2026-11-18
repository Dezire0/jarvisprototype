import AVFoundation
import Foundation
import Speech

private func send(_ event: [String: String]) {
    guard let data = try? JSONSerialization.data(withJSONObject: event) else { return }
    FileHandle.standardOutput.write(data + Data([0x0A]))
}

private final class AudioRequestSlot {
    private let lock = NSLock()
    private var request: SFSpeechAudioBufferRecognitionRequest?

    func replace(with next: SFSpeechAudioBufferRecognitionRequest?) {
        lock.lock()
        let old = request
        request = next
        lock.unlock()
        old?.endAudio()
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        defer { lock.unlock() }
        request?.append(buffer)
    }
}

private final class Listener {
    private let recognizer: SFSpeechRecognizer
    private let engine = AVAudioEngine()
    private let input = AudioRequestSlot()
    private var task: SFSpeechRecognitionTask?
    private var quietPeriod: DispatchWorkItem?
    private var segmentLimit: DispatchWorkItem?
    private var generation = 0
    private var hasTap = false
    private var latestText = ""
    private var segmentStarted = Date()

    init(recognizer: SFSpeechRecognizer) { self.recognizer = recognizer }

    func begin() {
        FileHandle.standardInput.readabilityHandler = { [weak self] handle in
            guard handle.availableData.isEmpty else { return }
            handle.readabilityHandler = nil
            DispatchQueue.main.async { self?.finish() }
        }

        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                guard let self else { return }
                guard status == .authorized else { self.finish(reason: "speech-permission"); return }
                AVCaptureDevice.requestAccess(for: .audio) { granted in
                    DispatchQueue.main.async {
                        if granted { self.startAudio() }
                        else { self.finish(reason: "microphone-permission") }
                    }
                }
            }
        }
    }

    private func startAudio() {
        let node = engine.inputNode
        let format = node.outputFormat(forBus: 0)
        guard format.channelCount > 0, format.sampleRate > 0 else {
            finish(reason: "audio-capture")
            return
        }
        node.installTap(onBus: 0, bufferSize: 1024, format: format) { [input] buffer, _ in
            input.append(buffer)
        }
        hasTap = true
        engine.prepare()
        do {
            try engine.start()
        } catch {
            finish(reason: "audio-capture")
            return
        }
        startSegment()
        send(["type": "ready"])
    }

    private func startSegment() {
        guard recognizer.supportsOnDeviceRecognition, recognizer.isAvailable else {
            finish(reason: "language-not-supported")
            return
        }
        generation += 1
        let current = generation
        quietPeriod?.cancel()
        segmentLimit?.cancel()
        task?.cancel()
        latestText = ""
        segmentStarted = Date()

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        request.taskHint = .dictation
        request.contextualStrings = ["Jarvis", "자비스"]
        input.replace(with: request)
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async { self?.received(result, error: error, generation: current) }
        }
        let limit = DispatchWorkItem { [weak self] in self?.completeSegment(generation: current) }
        segmentLimit = limit
        DispatchQueue.main.asyncAfter(deadline: .now() + 35, execute: limit)
    }

    private func received(_ result: SFSpeechRecognitionResult?, error: Error?, generation current: Int) {
        guard current == generation else { return }
        if let result {
            let text = String(result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines).prefix(1600))
            if !text.isEmpty, text != latestText {
                latestText = text
                quietPeriod?.cancel()
                let settled = DispatchWorkItem { [weak self] in self?.completeSegment(generation: current) }
                quietPeriod = settled
                DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(1100), execute: settled)
            }
            if result.isFinal {
                completeSegment(generation: current)
                return
            }
        }
        if error != nil {
            if !latestText.isEmpty || Date().timeIntervalSince(segmentStarted) >= 2 {
                completeSegment(generation: current)
            } else {
                finish(reason: "unavailable")
            }
        }
    }

    private func completeSegment(generation current: Int) {
        guard current == generation else { return }
        if !latestText.isEmpty { send(["type": "transcript", "text": latestText]) }
        startSegment()
    }

    private func finish(reason: String? = nil) {
        generation += 1
        quietPeriod?.cancel()
        segmentLimit?.cancel()
        input.replace(with: nil)
        task?.cancel()
        if hasTap { engine.inputNode.removeTap(onBus: 0) }
        engine.stop()
        if let reason { send(["type": "error", "reason": reason]) }
        exit(reason == nil ? 0 : 1)
    }
}

let args = CommandLine.arguments
guard args.count == 3, ["--probe", "--listen"].contains(args[1]),
      ["ko-KR", "en-US"].contains(args[2]) else { exit(2) }
let recognizer = SFSpeechRecognizer(locale: Locale(identifier: args[2]))
let available = recognizer?.supportsOnDeviceRecognition == true && recognizer?.isAvailable == true
if args[1] == "--probe" {
    send(["status": available ? "available" : "unavailable"])
    exit(0)
}
guard available, let recognizer else {
    send(["type": "error", "reason": "language-not-supported"])
    exit(1)
}
private let listener = Listener(recognizer: recognizer)
listener.begin()
dispatchMain()
