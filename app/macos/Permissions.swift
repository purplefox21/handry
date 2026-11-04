// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// The app's permissions window: every macOS permission it uses, one row each,
// with a live ✅/❌ and a button that brings up macOS's own question or opens
// the right page of System Settings. It opens by itself on the first launch
// and whenever a needed permission is missing; the menu opens it too
// ("İzinler…"). States are checked every second while it is open, so a row
// turns green as soon as the user allows it.
// No check ever runs on the main thread: asking whether we may automate an app
// blocks for over a minute when that app doesn't answer (Spotify while it starts,
// a hung app), and reading a folder blocks while macOS's question is open.
// A running process can't see some permissions it was given later (Screen
// Recording above all), so a new process of this same app is asked as well: when
// only that one is allowed, the row offers a restart. When neither is, although
// System Settings shows it on, the entry belongs to an earlier build of the app:
// the row offers to reset it (the user allows it again; nothing is allowed for them).
// The Handry server runs as the app's child, so what the app is allowed here, the
// server's actions are allowed too.
import SwiftUI
import AVFoundation
import Speech
import ApplicationServices

enum PermissionState { case granted, missing, denied, waiting, restart }

/// start: the app hardly works without it. recommended: asked up front. onDemand: macOS asks when the task comes up, so these rows aren't even checked until the user opens that part of the window.
enum PermissionGroup { case start, recommended, onDemand }

struct PermissionRow: Identifiable {
    let id: String
    let symbol: String
    let title: String
    let why: String
    let group: PermissionGroup
    var needed: Bool { group == .start }
    let check: () -> PermissionState
    let ask: () -> Void
    var tccService: String? = nil     // what `tccutil reset` calls it, for the rows that can be left with an old build's entry
}

/// What a brand-new process of this app sees (`Handry --check-permissions`, the app stays its responsible process). At most one every 3 s.
private final class FreshCheck {
    static let shared = FreshCheck()
    private let lock = NSLock()
    private var at = Date.distantPast
    private var value: (ax: Bool, screen: Bool)?

    func read() -> (ax: Bool, screen: Bool)? {
        lock.lock(); defer { lock.unlock() }
        if Date().timeIntervalSince(at) < 3 { return value }
        at = Date()
        value = run()
        return value
    }

    private func run() -> (ax: Bool, screen: Bool)? {
        guard let exe = Bundle.main.executablePath else { return nil }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: exe)
        p.arguments = ["--check-permissions"]
        let out = Pipe()
        p.standardOutput = out
        p.standardError = FileHandle.nullDevice
        p.standardInput = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return nil }
        let stop = DispatchWorkItem { p.terminate() }
        DispatchQueue.global().asyncAfter(deadline: .now() + 3, execute: stop)
        let data = out.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        stop.cancel()
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Bool], let ax = json["ax"], let screen = json["screen"] else { return nil }
        return (ax, screen)
    }
}

/// `Handry --check-permissions`: prints what this process sees and ends. Run by FreshCheck.
func printPermissionsAndExit() -> Never {
    print("{\"ax\":\(AXIsProcessTrusted()),\"screen\":\(CGPreflightScreenCaptureAccess())}")
    exit(0)
}

private func openSettings(_ pane: String) {
    NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)")!)
}

/// May the app send Apple Events to this one? (askUser: false never shows the question.)
private func automation(_ bundleId: String, askUser: Bool) -> OSStatus {
    var target = AEAddressDesc()
    let bytes = Array(bundleId.utf8)
    AECreateDesc(DescType(typeApplicationBundleID), bytes, bytes.count, &target)
    defer { AEDisposeDesc(&target) }
    return AEDeterminePermissionToAutomateTarget(&target, AEEventClass(typeWildCard), AEEventID(typeWildCard), askUser)
}

private func automationRow(_ bundleId: String, _ title: String, _ why: String, symbol: String) -> PermissionRow? {
    guard NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) != nil else { return nil }
    return PermissionRow(id: bundleId, symbol: symbol, title: title, why: why, group: .onDemand, check: {
        switch automation(bundleId, askUser: false) {
        case noErr: return .granted
        case -1743: return .denied
        default: return .missing   // -1744: macOS will ask; -600: the app is not running yet
        }
    }, ask: {
        // Everything here can wait for the other app or for the user's answer: off the main thread.
        DispatchQueue.global().async {
            if automation(bundleId, askUser: false) == -1743 {
                DispatchQueue.main.async { openSettings("Privacy_Automation") }
                return
            }
            // The question can only be asked while the app runs: start it hidden, then ask.
            if NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).isEmpty,
               let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) {
                let config = NSWorkspace.OpenConfiguration()
                config.activates = false
                config.hides = true
                NSWorkspace.shared.openApplication(at: url, configuration: config) { _, _ in
                    DispatchQueue.global().asyncAfter(deadline: .now() + 1.5) { _ = automation(bundleId, askUser: true) }
                }
            } else {
                _ = automation(bundleId, askUser: true)
            }
        }
    })
}

/// Handry's own files are in this folder of the home folder (a checkout on the Desktop): it can't start without reading it.
func holdsProject(_ folder: String) -> Bool { ROOT.hasPrefix("\(HOME)/\(folder)/") }

/// A folder the app reads (the project may live on the Desktop). Reading it is what
/// makes macOS ask, so it is only read once the user pressed "İzin Ver" (or,
/// for the Desktop, once the server, which lives there, has started).
func folderAsked(_ folder: String) { UserDefaults.standard.set(true, forKey: "asked-folder-\(folder)") }

private func folderRow(_ folder: String, _ title: String, _ why: String) -> PermissionRow {
    let path = "\(HOME)/\(folder)"
    let readable = { (try? FileManager.default.contentsOfDirectory(atPath: path)) != nil }
    return PermissionRow(id: "folder-\(folder)", symbol: "folder", title: title, why: why, group: holdsProject(folder) ? .start : .onDemand, check: {
        guard UserDefaults.standard.bool(forKey: "asked-folder-\(folder)") else { return .missing }
        return readable() ? .granted : .denied
    }, ask: {
        folderAsked(folder)
        DispatchQueue.global().async {
            if !readable() { DispatchQueue.main.async { openSettings("Privacy_FilesAndFolders") } }
        }
    })
}

/// Full Disk Access has no dialog an app could show: the user adds the app in System Settings and opens it
/// again. Whether it is on shows by opening a file only that access opens (the Messages database; TCC's own
/// database when Messages was never used).
private func fullDiskRow() -> PermissionRow {
    let probes = ["\(HOME)/Library/Messages/chat.db", "\(HOME)/Library/Application Support/com.apple.TCC/TCC.db"]
    let readable = {
        guard let file = probes.first(where: { FileManager.default.fileExists(atPath: $0) }) else { return false }
        guard let h = FileHandle(forReadingAtPath: file) else { return false }
        h.closeFile()
        return true
    }
    return PermissionRow(id: "fulldisk", symbol: "externaldrive.badge.checkmark", title: L("Tam Disk Erişimi", "Full Disk Access"),
                         why: L("Telefondan onay ve komut (kendine \"\(APP_NAME), …\" yazmak) ve SMS kodları: Mesajlar'daki mesajlarını okumak. macOS bunu soramaz: Ayarlar'da \(APP_ACC) ekleyip aç, sonra \(APP_ACC) yeniden başlat.",
                                 "Approvals and commands from your phone (texting yourself \"\(APP_NAME), …\") and SMS codes: reading your messages in Messages. macOS can't ask for this one: add \(APP_NAME) in System Settings, turn it on, then restart \(APP_NAME)."), group: .onDemand,
                         check: { readable() ? .granted : .denied },
                         ask: { openSettings("Privacy_AllFiles") })
}

func allPermissions() -> [PermissionRow] {
    var rows: [PermissionRow] = [
        PermissionRow(id: "accessibility", symbol: "hand.point.up.left", title: L("Erişilebilirlik", "Accessibility"),
                      why: L("Uygulamalarda düğmelere basmak, yazmak, menüleri kullanmak; ekrandaki elin pencerelerin üstünde gezmesi.",
                             "Clicking buttons, typing and using menus in apps; the pet walking on top of windows."), group: .start,
                      check: { AXIsProcessTrusted() ? .granted : FreshCheck.shared.read()?.ax == true ? .restart : .missing },
                      ask: {
                          let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
                          if !AXIsProcessTrustedWithOptions([key: true] as CFDictionary) { openSettings("Privacy_Accessibility") }
                      }, tccService: "Accessibility"),
        PermissionRow(id: "screen", symbol: "rectangle.dashed.badge.record", title: L("Ekran Kaydı", "Screen Recording"),
                      why: L("Gerektiğinde ekrana bakmak (ekran görüntüsü). Verdikten sonra \(APP_ACC) bir kez yeniden aç.",
                             "Looking at the screen when needed (screenshots). After allowing it, open \(APP_NAME) again once."), group: .recommended,
                      check: { CGPreflightScreenCaptureAccess() ? .granted : FreshCheck.shared.read()?.screen == true ? .restart : .missing },
                      ask: { if !CGRequestScreenCaptureAccess() { openSettings("Privacy_ScreenCapture") } }, tccService: "ScreenCapture"),
        PermissionRow(id: "mic", symbol: "mic", title: L("Mikrofon", "Microphone"),
                      why: L("Sesli komutlar ve \"\(WAKE_LABEL)\".", "Voice commands and \"\(WAKE_LABEL)\"."), group: .recommended,
                      check: {
                          switch AVCaptureDevice.authorizationStatus(for: .audio) {
                          case .authorized: return .granted
                          case .notDetermined: return .missing
                          default: return .denied
                          }
                      },
                      ask: {
                          if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined { AVCaptureDevice.requestAccess(for: .audio) { _ in } }
                          else { openSettings("Privacy_Microphone") }
                      }),
        PermissionRow(id: "speech", symbol: "waveform", title: L("Konuşma Tanıma", "Speech Recognition"),
                      why: L("Konuşurken söylediklerini yazmak ve \"\(WAKE_LABEL)\" demeni duymak (bu Mac'te, internetsiz).",
                             "Writing down what you say as you speak, and hearing \"\(WAKE_LABEL)\" (on this Mac, offline)."), group: .recommended,
                      check: {
                          switch SFSpeechRecognizer.authorizationStatus() {
                          case .authorized: return .granted
                          case .notDetermined: return .missing
                          default: return .denied
                          }
                      },
                      ask: {
                          if SFSpeechRecognizer.authorizationStatus() == .notDetermined { SFSpeechRecognizer.requestAuthorization { _ in } }
                          else { openSettings("Privacy_SpeechRecognition") }
                      }),
        folderRow("Desktop", L("Masaüstü klasörü", "Desktop folder"), holdsProject("Desktop")
                  ? L("\(APP_GEN) kendi dosyaları burada (\(ROOT.replacingOccurrences(of: HOME, with: "~"))); dosya işleri.", "\(APP_NAME)'s own files are here (\(ROOT.replacingOccurrences(of: HOME, with: "~"))); file tasks.")
                  : L("Masaüstündeki dosyaları bulmak, taşımak.", "Finding and moving files on your Desktop.")),
        folderRow("Documents", L("Belgeler klasörü", "Documents folder"), L("\"Belgelerimde şunu bul\" gibi dosya işleri.", "File tasks like \"find this in my Documents\".")),
        folderRow("Downloads", L("İndirilenler klasörü", "Downloads folder"), L("İndirilen dosyaları bulmak, taşımak.", "Finding and moving downloaded files.")),
        fullDiskRow()
    ]
    let apps: [(String, String, String, String)] = [
        ("com.apple.systemevents", "System Events", L("Karanlık mod gibi sistem ayarları.", "System settings like Dark Mode."), "gearshape"),
        ("com.spotify.client", "Spotify", L("Şarkı çalmak, durdurmak, ne çaldığını söylemek.", "Playing and pausing songs, saying what's playing."), "music.note"),
        ("com.apple.Music", L("Müzik", "Music"), L("Müzik uygulamasında çalmak.", "Playing in the Music app."), "music.note.list"),
        ("com.apple.Notes", L("Notlar", "Notes"), L("Not almak ve notlarda aramak.", "Taking notes and searching them."), "note.text"),
        ("com.apple.reminders", L("Anımsatıcılar", "Reminders"), L("Anımsatıcı eklemek ve okumak.", "Adding and reading reminders."), "checklist"),
        ("com.apple.iCal", L("Takvim", "Calendar"), L("Takvime bakmak ve etkinlik eklemek.", "Checking your calendar and adding events."), "calendar"),
        ("com.apple.MobileSMS", L("Mesajlar", "Messages"), L("Seni telefonundan iMessage ile haberdar etmek.", "Letting you know on your phone by iMessage."), "message")
    ]
    rows += apps.compactMap { automationRow($0.0, $0.1, $0.2, symbol: $0.3) }
    return rows
}

final class PermissionsModel: ObservableObject {
    let rows: [PermissionRow]
    @Published var states: [String: PermissionState] = [:]
    @Published var showOnDemand = false { didSet { if showOnDemand { refresh() } } }
    /// Rows the user asked for a while ago that are still not on: System Settings may be showing an old build's entry.
    @Published var stuck: Set<String> = []
    @Published var resetFailed: Set<String> = []
    private var timer: Timer?
    private var checking: [String: Date] = [:]   // what is being checked since when; touched on the main thread only
    private let queue = DispatchQueue(label: "handry.permissions", attributes: .concurrent)

    init(rows: [PermissionRow] = allPermissions()) { self.rows = rows }

    var missingNeeded: Bool { rows.contains { $0.needed && states[$0.id] != .granted } }
    var allGranted: Bool { rows.filter { $0.group != .onDemand }.allSatisfy { states[$0.id] == .granted } }

    private func set(_ id: String, _ state: PermissionState) {
        if states[id] != state { states[id] = state }
    }

    /// Checks the rows in the background, each at most once at a time. One that doesn't answer for 3 s shows
    /// as waiting; the others and the window go on.
    func refresh() {
        let now = Date()
        for row in rows where row.group != .onDemand || showOnDemand {
            if let since = checking[row.id] {
                if now.timeIntervalSince(since) > 3 { set(row.id, .waiting) }
                continue
            }
            checking[row.id] = now
            queue.async { [weak self] in
                let state = row.check()
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.checking[row.id] = nil
                    self.set(row.id, state)
                    self.noteStuck(row, state)
                }
            }
        }
    }

    private func askedKey(_ id: String) -> String { "asked-permission-\(id)" }

    private func noteStuck(_ row: PermissionRow, _ state: PermissionState) {
        guard row.tccService != nil else { return }
        let asked = UserDefaults.standard.double(forKey: askedKey(row.id))
        let isStuck = state == .missing && asked > 0 && Date().timeIntervalSince1970 - asked > 6
        if stuck.contains(row.id) != isStuck {
            if isStuck { stuck.insert(row.id) } else { stuck.remove(row.id) }
        }
    }

    func ask(_ row: PermissionRow) {
        if row.tccService != nil { UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: askedKey(row.id)) }
        row.ask()
    }

    /// Takes this app's old entry out of macOS's list (only that one), then asks again. Allowing it stays the user's job.
    func reset(_ row: PermissionRow) {
        guard let service = row.tccService, let bundle = Bundle.main.bundleIdentifier else { return }
        DispatchQueue.global().async { [weak self] in
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/tccutil")
            p.arguments = ["reset", service, bundle]
            p.standardOutput = FileHandle.nullDevice
            p.standardError = FileHandle.nullDevice
            var ok = false
            if (try? p.run()) != nil { p.waitUntilExit(); ok = p.terminationStatus == 0 }
            DispatchQueue.main.async {
                guard let self else { return }
                if ok { self.resetFailed.remove(row.id) } else { self.resetFailed.insert(row.id) }
                self.stuck.remove(row.id)
                self.ask(row)
            }
        }
    }

    /// At launch: is something the app needs missing? Answers on the main thread, without ever blocking it.
    func checkNeeded(_ done: @escaping (Bool) -> Void) {
        let needed = rows.filter(\.needed)
        queue.async {
            let missing = needed.contains { $0.check() != .granted }
            DispatchQueue.main.async { done(missing) }
        }
    }

    func start() {
        refresh()
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.refresh() }
    }

    func stop() { timer?.invalidate(); timer = nil }
}

struct PermissionsView: View {
    @ObservedObject var model: PermissionsModel
    let close: () -> Void
    let restart: () -> Void

    private func rows(_ group: PermissionGroup) -> [PermissionRow] { model.rows.filter { $0.group == group } }

    @ViewBuilder private func list(_ rows: [PermissionRow]) -> some View {
        VStack(spacing: 0) {
            ForEach(rows) { row in
                PermissionRowView(row: row, state: model.states[row.id] ?? .waiting, stuck: model.stuck.contains(row.id), resetFailed: model.resetFailed.contains(row.id),
                                  ask: { model.ask(row) }, reset: { model.reset(row) }, restart: restart)
                if row.id != rows.last?.id { Divider() }
            }
        }
        .background(RoundedRectangle(cornerRadius: 10).fill(Color(nsColor: .controlBackgroundColor)))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 14) {
                if let icon = NSApp.applicationIconImage {
                    Image(nsImage: icon).resizable().frame(width: 56, height: 56)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(L("\(APP_GEN) izinleri", "\(APP_NAME) Permissions")).font(.title2.bold())
                    Text(L("\(APP_GEN) senin yerine çalışabilmesi için macOS bu izinleri soruyor. Her satırda \"İzin Ver\"e bas; izin verince satır kendiliğinden yeşile döner.",
                            "macOS asks for these so \(APP_NAME) can work for you. Click \"Allow\" on each row; a row turns green by itself once it's allowed."))
                        .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    Text(L("Başlamak için", "To get started")).font(.subheadline.bold()).foregroundStyle(.secondary)
                    list(rows(.start))
                    Text(L("Önerilen", "Recommended")).font(.subheadline.bold()).foregroundStyle(.secondary).padding(.top, 6)
                    list(rows(.recommended))
                    DisclosureGroup(isExpanded: $model.showOnDemand) {
                        list(rows(.onDemand)).padding(.top, 6)
                    } label: {
                        Text(L("Sadece bazı işler için (o iş gelince macOS kendisi sorar)", "Only for certain tasks (macOS asks when it comes up)"))
                            .font(.subheadline.bold()).foregroundStyle(.secondary)
                    }
                    .padding(.top, 6)
                }
            }
            HStack {
                Text(model.allGranted ? L("Hepsi tamam. 🦊", "All set. 🦊") : model.missingNeeded ? L("Kırmızı olanlar olmadan \(APP_NAME) düzgün çalışmaz.", "\(APP_NAME) won't work properly without the red ones.") : L("Gerekenler tamam; gerisi isteğe bağlı.", "The needed ones are done; the rest are optional."))
                    .foregroundStyle(model.missingNeeded ? Color.red : Color.secondary)
                Spacer()
                Button(model.missingNeeded ? L("Sonra", "Later") : L("Bitti", "Done"), action: close).keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 560, height: 640)
    }
}

struct PermissionRowView: View {
    let row: PermissionRow
    let state: PermissionState
    let stuck: Bool
    let resetFailed: Bool
    let ask: () -> Void
    let reset: () -> Void
    let restart: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Image(systemName: row.symbol).frame(width: 24).foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(row.title).font(.headline)
                        if row.needed { Text(L("gerekli", "needed")).font(.caption2.bold()).padding(.horizontal, 5).padding(.vertical, 1).background(Capsule().fill(Color.orange.opacity(0.2))) }
                    }
                    Text(row.why).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                switch state {
                case .granted:
                    Label(L("Verildi", "Allowed"), systemImage: "checkmark.circle.fill").foregroundStyle(.green).labelStyle(.titleAndIcon)
                case .restart:
                    Button(L("Yeniden Başlat", "Restart"), action: restart).buttonStyle(.borderedProminent)
                case .waiting:
                    Text(L("Cevap bekleniyor…", "Waiting for an answer…")).font(.callout).foregroundStyle(.secondary)
                case .denied:
                    Button(L("Ayarları Aç", "Open Settings"), action: ask)
                case .missing:
                    Button(L("İzin Ver", "Allow"), action: ask).buttonStyle(.borderedProminent)
                }
            }
            if state == .restart {
                Text(L("İzin verilmiş. macOS bunu \(APP_ACC) yeniden başlatınca uygular.", "It's allowed. macOS applies it when \(APP_NAME) restarts."))
                    .font(.callout).foregroundStyle(.secondary).padding(.leading, 36).fixedSize(horizontal: false, vertical: true)
            } else if stuck {
                HStack(spacing: 10) {
                    Text(resetFailed
                         ? L("Sıfırlanamadı. Ayarlar'da \(APP_ACC) seçip − ile sil, sonra İzin Ver'e bas.", "Couldn't reset it. In System Settings select \(APP_NAME), remove it with −, then click Allow.")
                         : L("Ayarlar'da açık görünüp burada verilmemiş diyorsa, \(APP_GEN) eski bir kopyasının kaydı kalmıştır. Kaydı sıfırla, sonra yeniden izin ver.",
                             "If System Settings shows it on but it isn't allowed here, the entry belongs to an old copy of \(APP_NAME). Reset it, then allow it again."))
                        .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 4)
                    Button(L("Kaydı Sıfırla", "Reset Entry"), action: reset)
                }
                .padding(.leading, 36)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }
}

/// The window itself; AppDelegate keeps one and shows it when needed.
final class PermissionsWindow: NSObject, NSWindowDelegate {
    let model = PermissionsModel()
    var restart: () -> Void = {}
    private var window: NSWindow?

    func checkNeeded(_ done: @escaping (Bool) -> Void) { model.checkNeeded(done) }

    func show() {
        if window == nil {
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 640), styleMask: [.titled, .closable], backing: .buffered, defer: false)
            w.title = L("\(APP_NAME) İzinleri", "\(APP_NAME) Permissions")
            w.isReleasedWhenClosed = false
            w.delegate = self
            w.contentView = NSHostingView(rootView: PermissionsView(model: model, close: { [weak w] in w?.close() }, restart: { [weak self] in self?.restart() }))
            w.center()
            window = w
        }
        model.start()
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }

    func windowWillClose(_ notification: Notification) { model.stop() }
}

// MARK: Tests (tests/permissions-e2e.mjs)

/// `Handry --test-permissions <bundle id> --out file`: checks one app's automation row for 6 s while a main
/// thread timer measures the longest gap between its ticks, so a check that blocks the main thread shows.
func runPermissionsTest(bundleId: String, output: String) {
    guard let row = automationRow(bundleId, bundleId, "", symbol: "app") else { exit(3) }
    let model = PermissionsModel(rows: [row])
    model.showOnDemand = true
    model.start()
    var last = Date(), worst = 0.0
    Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
        let now = Date()
        worst = max(worst, now.timeIntervalSince(last))
        last = now
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 6) {
        let state = model.states[bundleId].map { "\($0)" } ?? "none"
        let json = "{\"worstGapMs\":\(Int(worst * 1000)),\"state\":\"\(state)\"}"
        try? json.write(toFile: output, atomically: true, encoding: .utf8)
        exit(0)
    }
}

/// `Handry --render-permissions file.png`: draws the window into a picture, without showing anything on screen.
func renderPermissions(to output: String, onDemand: Bool) {
    _ = NSApplication.shared
    NSApp.setActivationPolicy(.prohibited)
    let model = PermissionsModel()
    model.showOnDemand = onDemand
    model.start()
    let view = NSHostingView(rootView: PermissionsView(model: model, close: {}, restart: {}))
    view.frame = NSRect(x: 0, y: 0, width: 560, height: 640)
    let window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
    window.contentView = view
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
        view.layoutSubtreeIfNeeded()
        guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { exit(4) }
        view.cacheDisplay(in: view.bounds, to: rep)
        // the window's own background isn't part of the view: without it light text is lost on a white viewer
        let image = NSImage(size: view.bounds.size)
        image.lockFocus()
        NSColor.windowBackgroundColor.setFill()
        view.bounds.fill()
        rep.draw(in: view.bounds, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
        image.unlockFocus()
        guard let tiff = image.tiffRepresentation, let flat = NSBitmapImageRep(data: tiff) else { exit(4) }
        try? flat.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: output))
        exit(0)
    }
}
