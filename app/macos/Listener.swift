// Handry's ears. Listener turns speech into text while it is spoken (Apple's
// on-device recognizer, Turkish or English by the app's language), notices
// when a phrase has ended (a short silence), keeps the phrase as a 16 kHz WAV
// for whisper, and can wait for "Hey Handry" in the background.
//
// Waiting for "Hey Handry" is cheap: only a loudness check runs all the time.
// When someone starts speaking after a pause, the recognizer listens to the
// first three seconds; if they don't start with "Hey Handry" it stops again.
// Timing uses the audio itself (frames heard), so a WAV file can be run
// through exactly the same steps as the microphone (see runFileTest).
import AVFoundation
import Speech
import CoreAudio

final class Listener {
    enum Mode { case off, waiting, candidate, active }

    // Called on the main thread.
    var onWake: () -> Void = {}
    var onStart: () -> Void = {}
    var onPartial: (String) -> Void = { _ in }
    var onFinal: (_ text: String, _ wav: URL?, _ woke: Bool) -> Void = { _, _, _ in }
    var onCancel: () -> Void = {}
    var onError: (String) -> Void = { _ in }

    /// Seconds of silence that end a phrase.
    var endSilence = 0.9
    var preferBuiltInMic = true

    private let q = DispatchQueue(label: "jevis.listener")
    private let engine = AVAudioEngine()
    private var engineRunning = false
    private var fileMode = false
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: L("tr-TR", "en-US")))
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var generation = 0
    private var converter: AVAudioConverter?
    private let small = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!

    private(set) var mode = Mode.off
    private var wake = false
    private var clock = 0.0           // seconds of audio heard
    private var noiseFloor: Float = -55
    private var lastVoice = -100.0
    private var phraseStart = 0.0
    private var preroll: [(buffer: AVAudioPCMBuffer, samples: [Float], seconds: Double)] = []
    private var samples: [Float] = []
    private var text = ""
    private var heard = false          // words of the command have been recognized
    private var woke = false
    private var pushToTalk = false
    private var finishing = false
    private var wakeEnd: Double?       // where "Hey Foxie" ends in the phrase audio (seconds)
    private var wakeWords = 2          // how many words "Hey Foxie" took in the text

    /// "Hey Foxie" and how the recognizer may write it (core/brand.js, via Info.plist).
    static let wakePattern = try! NSRegularExpression(
        pattern: Bundle.main.infoDictionary?["WakePattern"] as? String
            ?? "^\\s*(?:hey|hei|hay|hi|ey|ay|he)[\\s,.!]*(?:foxie|foxy|foxi|foksi|foksy|foksie|fogsi|fuksi|focsi|fox|foks)(?![\\p{L}\\p{N}])[\\s,.!?:;-]*",
        options: [.caseInsensitive])

    /// The command after "Hey Foxie" / "Hey Handry", or nil when the text doesn't start with it.
    static func afterWake(_ text: String) -> String? {
        let ns = text as NSString
        guard let m = wakePattern.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)) else { return nil }
        return ns.substring(from: m.range.upperBound).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: Switching

    var wakeEnabled: Bool { q.sync { wake } }

    func setWake(_ on: Bool) {
        q.async {
            self.wake = on
            if on, self.mode == .off { self.mode = .waiting }
            if !on, self.mode == .waiting || self.mode == .candidate { self.cancelRecognition(); self.mode = .off }
            self.updateEngine()
        }
    }

    /// Push to talk (ends when finish() is called) or the mic button (ends on silence).
    func startActive(pushToTalk: Bool) {
        q.async {
            if self.mode == .active { return }
            self.pushToTalk = pushToTalk
            self.woke = false
            if self.mode == .candidate {
                self.mode = .active
            } else {
                self.beginRecognition(keepSeconds: 0.3)
                self.mode = .active
            }
            self.updateEngine()
            DispatchQueue.main.async { self.onStart() }
        }
    }

    /// Ends the phrase now (push to talk released).
    func finish() {
        q.async { if self.mode == .active { self.finishPhrase() } }
    }

    /// Drops the phrase without sending anything.
    func cancel() {
        q.async {
            guard self.mode == .active || self.mode == .candidate else { return }
            self.cancelRecognition()
            self.mode = self.wake ? .waiting : .off
            self.updateEngine()
            DispatchQueue.main.async { self.onCancel() }
        }
    }

    var isActive: Bool { q.sync { mode == .active } }

    // MARK: Microphone

    static func requestPermissions(_ done: @escaping (_ mic: Bool, _ speech: Bool) -> Void) {
        AVCaptureDevice.requestAccess(for: .audio) { mic in
            SFSpeechRecognizer.requestAuthorization { status in
                DispatchQueue.main.async { done(mic, status == .authorized) }
            }
        }
    }

    private func updateEngine() {
        guard !fileMode else { return }
        let needed = wake || mode == .active
        if needed && !engineRunning { startEngine() }
        if !needed && engineRunning { stopEngine() }
    }

    private func startEngine() {
        let input = engine.inputNode
        if preferBuiltInMic, let id = Listener.builtInMicrophone(), let unit = input.audioUnit {
            // Bluetooth headphones switch to low-quality "call" audio while their mic is open.
            var device = id
            AudioUnitSetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &device, UInt32(MemoryLayout<AudioDeviceID>.size))
        }
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0 else {
            DispatchQueue.main.async { self.onError(L("Mikrofon bulunamadı.", "No microphone found.")) }
            return
        }
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self, let copy = Listener.copy(buffer) else { return }
            self.q.async { self.process(copy) }
        }
        do {
            try engine.start()
            engineRunning = true
        } catch {
            DispatchQueue.main.async { self.onError(L("Mikrofon açılamadı: \(error.localizedDescription)", "Couldn't open the microphone: \(error.localizedDescription)")) }
        }
    }

    private func stopEngine() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        engineRunning = false
    }

    /// After a device change (headphones plugged in…) the tap has to be set up again.
    func restartEngine() {
        q.async {
            guard self.engineRunning else { return }
            self.stopEngine()
            self.converter = nil
            self.startEngine()
        }
    }

    static func builtInMicrophone() -> AudioDeviceID? {
        var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr else { return nil }
        var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &ids) == noErr else { return nil }
        for id in ids {
            var transport: UInt32 = 0
            var tsize = UInt32(MemoryLayout<UInt32>.size)
            var taddr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyTransportType, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
            guard AudioObjectGetPropertyData(id, &taddr, 0, nil, &tsize, &transport) == noErr, transport == kAudioDeviceTransportTypeBuiltIn else { continue }
            var saddr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreams, mScope: kAudioDevicePropertyScopeInput, mElement: kAudioObjectPropertyElementMain)
            var ssize: UInt32 = 0
            if AudioObjectGetPropertyDataSize(id, &saddr, 0, nil, &ssize) == noErr, ssize > 0 { return id }
        }
        return nil
    }

    // MARK: Audio

    private static func copy(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let out = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength) else { return nil }
        out.frameLength = buffer.frameLength
        let channels = Int(buffer.format.channelCount)
        if let src = buffer.floatChannelData, let dst = out.floatChannelData {
            for c in 0..<channels { dst[c].update(from: src[c], count: Int(buffer.frameLength)) }
        } else if let src = buffer.int16ChannelData, let dst = out.int16ChannelData {
            for c in 0..<channels { dst[c].update(from: src[c], count: Int(buffer.frameLength)) }
        } else {
            return nil
        }
        return out
    }

    private func level(_ buffer: AVAudioPCMBuffer) -> Float {
        let n = Int(buffer.frameLength)
        guard n > 0 else { return -100 }
        var sum: Float = 0
        if let data = buffer.floatChannelData?[0] {
            for i in 0..<n { sum += data[i] * data[i] }
        } else if let data = buffer.int16ChannelData?[0] {
            for i in 0..<n { let v = Float(data[i]) / 32768; sum += v * v }
        }
        let rms = sqrt(sum / Float(n))
        return rms > 0 ? 20 * log10(rms) : -100
    }

    private func toSmall(_ buffer: AVAudioPCMBuffer) -> [Float] {
        if converter == nil || converter?.inputFormat != buffer.format { converter = AVAudioConverter(from: buffer.format, to: small) }
        guard let converter else { return [] }
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * 16000 / buffer.format.sampleRate) + 64
        guard let out = AVAudioPCMBuffer(pcmFormat: small, frameCapacity: capacity) else { return [] }
        var given = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if given { status.pointee = .noDataNow; return nil }
            given = true
            status.pointee = .haveData
            return buffer
        }
        guard let data = out.floatChannelData?[0] else { return [] }
        return Array(UnsafeBufferPointer(start: data, count: Int(out.frameLength)))
    }

    private func jevisSpeaking() -> Bool {
        let flag = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".jevis/speaking").path
        guard let date = (try? FileManager.default.attributesOfItem(atPath: flag))?[.modificationDate] as? Date else { return false }
        return Date().timeIntervalSince(date) < 120
    }

    private func process(_ buffer: AVAudioPCMBuffer) {
        guard mode != .off else { return }
        let seconds = Double(buffer.frameLength) / buffer.format.sampleRate
        clock += seconds
        let db = level(buffer)
        let voiced = db > max(noiseFloor + 12, -50)
        if !voiced { noiseFloor = noiseFloor * 0.97 + min(db, -25) * 0.03 }
        let quietFor = clock - lastVoice
        if voiced { lastVoice = clock }
        let pcm = toSmall(buffer)

        switch mode {
        case .off:
            return
        case .waiting:
            preroll.append((buffer, pcm, seconds))
            var kept = preroll.reduce(0) { $0 + $1.seconds }
            while kept > 1.0, !preroll.isEmpty { kept -= preroll.removeFirst().seconds }
            // Someone starts speaking after a pause: is it "Hey Handry"?
            if voiced && quietFor > 0.25 && !jevisSpeaking() {
                beginRecognition(keepSeconds: 1.0)
                mode = .candidate
            }
        case .candidate:
            feed(buffer, pcm)
            if clock - phraseStart > 3.5 || clock - lastVoice > 1.0 {
                cancelRecognition()
                mode = wake ? .waiting : .off
            }
        case .active:
            feed(buffer, pcm)
            if finishing { return }
            let elapsed = clock - phraseStart
            if pushToTalk {
                if elapsed > 60 { finishPhrase() }
            } else if heard && clock - lastVoice > endSilence {
                finishPhrase()
            } else if !heard && elapsed > (woke ? 7 : 8) {
                cancelRecognition()
                mode = wake ? .waiting : .off
                updateEngine()
                DispatchQueue.main.async { self.onCancel() }
            } else if elapsed > 30 {
                finishPhrase()
            }
        }
    }

    private func feed(_ buffer: AVAudioPCMBuffer, _ pcm: [Float]) {
        request?.append(buffer)
        samples.append(contentsOf: pcm)
    }

    // MARK: Recognition

    private func beginRecognition(keepSeconds: Double) {
        cancelRecognition()
        generation += 1
        let gen = generation
        text = ""
        heard = false
        finishing = false
        wakeEnd = nil
        samples = []
        // The moment before the voice started (the "H" of "Hey") is kept.
        var total = 0.0
        var chosen: [(buffer: AVAudioPCMBuffer, samples: [Float], seconds: Double)] = []
        for item in preroll.reversed() {
            if total >= keepSeconds { break }
            chosen.insert(item, at: 0)
            total += item.seconds
        }
        phraseStart = clock - total
        preroll = []

        guard let recognizer, recognizer.isAvailable, SFSpeechRecognizer.authorizationStatus() == .authorized else {
            // No live words: the phrase still goes to whisper as a WAV.
            for item in chosen { samples.append(contentsOf: item.samples) }
            return
        }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        // The wake word as written and as said ("Hendri"), so the recognizer expects them.
        req.contextualStrings = [WAKE_LABEL, APP_NAME, "Hey Hendri", "Hendri", "Hey Foxie", "Foxie", "Hey Fox", "VS Code", "Claude", "Spotify", "Chrome", "Safari", "Xcode", "App Store"]
        req.taskHint = .dictation
        req.addsPunctuation = true
        request = req
        for item in chosen {
            req.append(item.buffer)
            samples.append(contentsOf: item.samples)
        }
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            guard let self else { return }
            self.q.async {
                guard gen == self.generation else { return }
                if let result {
                    if self.woke || self.mode == .candidate, let end = Listener.wakeEnd(result.bestTranscription.segments) { self.wakeEnd = end }
                    self.recognized(result.bestTranscription.formattedString, final: result.isFinal)
                }
                else if error != nil, self.finishing { self.deliver() }
            }
        }
    }

    private func recognized(_ full: String, final: Bool) {
        switch mode {
        case .candidate:
            if let command = Listener.afterWake(full) {
                let prefix = String(full.prefix(max(0, full.count - command.count)))
                wakeWords = max(1, prefix.split(whereSeparator: { $0.isWhitespace }).count)
                mode = .active
                woke = true
                pushToTalk = false
                DispatchQueue.main.async { self.onWake(); self.onStart() }
                update(command)
            }
        case .active:
            // The recognizer sometimes rewrites "Hey Handry" later ("Hey J"): drop as many words.
            update(woke ? (Listener.afterWake(full) ?? full.split(separator: " ").dropFirst(wakeWords).joined(separator: " ")) : full)
        default:
            break
        }
        if final && finishing { deliver() }
    }

    /// When the words "Hey Handry" end, from the recognizer's word timings.
    /// whisper hears the rest badly when it starts with them, so they are cut off.
    static func wakeEnd(_ segments: [SFTranscriptionSegment]) -> Double? {
        var head = ""
        for (i, segment) in segments.prefix(5).enumerated() {
            head += (i == 0 ? "" : " ") + segment.substring
            if afterWake(head) == "" {
                let end = segment.timestamp + segment.duration
                return end > 0 ? end : nil
            }
        }
        return nil
    }

    private func update(_ command: String) {
        text = command
        if !command.isEmpty { heard = true }
        DispatchQueue.main.async { self.onPartial(command) }
    }

    private func finishPhrase() {
        finishing = true
        request?.endAudio()
        let gen = generation
        if request == nil { deliver(); return }
        // The recognizer's last word can take a moment.
        q.asyncAfter(deadline: .now() + 0.8) { if gen == self.generation, self.finishing { self.deliver() } }
    }

    private func deliver() {
        guard finishing else { return }
        finishing = false
        let said = text
        let wasWoken = woke
        var audio = samples
        if wasWoken, let end = wakeEnd {
            let cut = max(0, min(audio.count, Int((end + 0.05) * 16000)))
            audio.removeFirst(cut)
        }
        let wav = audio.count > 16000 / 4 ? writeWav(audio) : nil
        cancelRecognition()
        mode = wake ? .waiting : .off
        updateEngine()
        DispatchQueue.main.async { self.onFinal(said, wav, wasWoken) }
    }

    private func cancelRecognition() {
        generation += 1
        task?.cancel()
        task = nil
        request = nil
        finishing = false
    }

    private func writeWav(_ pcm: [Float]) -> URL? {
        let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".jevis/tmp")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("voice-\(UUID().uuidString.prefix(8).lowercased()).wav")
        var data = Data()
        func u32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { data.append(contentsOf: $0) } }
        func u16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { data.append(contentsOf: $0) } }
        data.append(contentsOf: Array("RIFF".utf8)); u32(UInt32(36 + pcm.count * 2))
        data.append(contentsOf: Array("WAVEfmt ".utf8)); u32(16); u16(1); u16(1); u32(16000); u32(32000); u16(2); u16(16)
        data.append(contentsOf: Array("data".utf8)); u32(UInt32(pcm.count * 2))
        for s in pcm { u16(UInt16(bitPattern: Int16(max(-1, min(1, s)) * 32767))) }
        return (try? data.write(to: url)) != nil ? url : nil
    }

    // MARK: Test with a WAV file (same steps as the microphone)

    /// Handry --test-listener <in.wav> --out <out.json> [--active]
    static func runFileTest(input: String, output: String, active: Bool) {
        let listener = Listener()
        listener.fileMode = true
        var events: [[String: Any]] = []
        let t0 = Date()
        func log(_ e: [String: Any]) { var e = e; e["t"] = Date().timeIntervalSince(t0); events.append(e) }
        listener.onWake = { log(["type": "wake"]) }
        listener.onStart = { log(["type": "start"]) }
        listener.onPartial = { log(["type": "partial", "text": $0]) }
        listener.onFinal = { text, wav, woke in log(["type": "final", "text": text, "wav": wav?.path ?? "", "woke": woke]) }
        listener.onCancel = { log(["type": "cancel"]) }
        listener.onError = { log(["type": "error", "message": $0]) }

        // A file needs no microphone, only the speech recognizer.
        SFSpeechRecognizer.requestAuthorization { status in
            log(["type": "permissions", "speech": status == .authorized])
            DispatchQueue.global().async {
                if active { listener.startActive(pushToTalk: false) } else { listener.setWake(true) }
                guard let file = try? AVAudioFile(forReading: URL(fileURLWithPath: input)) else {
                    DispatchQueue.main.async { log(["type": "error", "message": "dosya okunamadı"]) }
                    return
                }
                let format = file.processingFormat
                let chunk: AVAudioFrameCount = 1024
                // The file, then two seconds of silence, fed in real time.
                while let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: chunk), (try? file.read(into: buffer, frameCount: chunk)) != nil, buffer.frameLength > 0 {
                    listener.q.async { listener.process(buffer) }
                    Thread.sleep(forTimeInterval: Double(buffer.frameLength) / format.sampleRate)
                }
                for _ in 0..<Int(2.5 * format.sampleRate / Double(chunk)) {
                    guard let silence = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: chunk) else { break }
                    silence.frameLength = chunk
                    if let c = silence.floatChannelData { for ch in 0..<Int(format.channelCount) { c[ch].update(repeating: 0, count: Int(chunk)) } }
                    listener.q.async { listener.process(silence) }
                    Thread.sleep(forTimeInterval: Double(chunk) / format.sampleRate)
                }
                Thread.sleep(forTimeInterval: 1.5)
                DispatchQueue.main.async {
                    let data = (try? JSONSerialization.data(withJSONObject: ["events": events], options: [.prettyPrinted])) ?? Data()
                    try? data.write(to: URL(fileURLWithPath: output))
                    exit(0)
                }
            }
        }
    }
}
