// The app's permissions window: every macOS permission it uses, one row each,
// with a live ✅/❌ and a button that brings up macOS's own question or opens
// the right page of System Settings. It opens by itself on the first launch
// and whenever a needed permission is missing; the menu opens it too
// ("İzinler…"). States are checked every second while it is open, so a row
// turns green as soon as the user allows it (no restart needed, except
// Screen Recording, which macOS applies after the app restarts).
// The Handry server runs as the app's child, so what the app is allowed here, the
// server's actions are allowed too.
import SwiftUI
import AVFoundation
import Speech
import ApplicationServices

enum PermissionState { case granted, missing, denied, waiting }

struct PermissionRow: Identifiable {
    let id: String
    let symbol: String
    let title: String
    let why: String
    let needed: Bool                  // the app hardly works without it
    let check: () -> PermissionState
    let ask: () -> Void
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
    return PermissionRow(id: bundleId, symbol: symbol, title: title, why: why, needed: false, check: {
        switch automation(bundleId, askUser: false) {
        case noErr: return .granted
        case -1743: return .denied
        default: return .missing   // -1744: macOS will ask; -600: the app is not running yet
        }
    }, ask: {
        if automation(bundleId, askUser: false) == -1743 { return openSettings("Privacy_Automation") }
        // The question can only be asked while the app runs: start it hidden, then ask (off the main thread: it waits for the answer).
        let start = {
            DispatchQueue.global().async { _ = automation(bundleId, askUser: true) }
        }
        if NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).isEmpty,
           let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) {
            let config = NSWorkspace.OpenConfiguration()
            config.activates = false
            config.hides = true
            NSWorkspace.shared.openApplication(at: url, configuration: config) { _, _ in
                DispatchQueue.global().asyncAfter(deadline: .now() + 1.5) { start() }
            }
        } else {
            start()
        }
    })
}

/// A folder the app reads (the project lives on the Desktop). Reading it is what
/// makes macOS ask, so it is only read once the user pressed "İzin Ver" (or,
/// for the Desktop, once the server, which lives there, has started).
func folderAsked(_ folder: String) { UserDefaults.standard.set(true, forKey: "asked-folder-\(folder)") }

private func folderRow(_ folder: String, _ title: String, _ why: String, needed: Bool) -> PermissionRow {
    let path = "\(HOME)/\(folder)"
    let readable = { (try? FileManager.default.contentsOfDirectory(atPath: path)) != nil }
    return PermissionRow(id: "folder-\(folder)", symbol: "folder", title: title, why: why, needed: needed, check: {
        guard UserDefaults.standard.bool(forKey: "asked-folder-\(folder)") else { return .missing }
        return readable() ? .granted : .denied
    }, ask: {
        folderAsked(folder)
        DispatchQueue.global().async {
            if !readable() { DispatchQueue.main.async { openSettings("Privacy_FilesAndFolders") } }
        }
    })
}

func allPermissions() -> [PermissionRow] {
    var rows: [PermissionRow] = [
        PermissionRow(id: "accessibility", symbol: "hand.point.up.left", title: "Erişilebilirlik",
                      why: "Uygulamalarda düğmelere basmak, yazmak, menüleri kullanmak; tilkinin pencerelerin üstünde gezmesi.", needed: true,
                      check: { AXIsProcessTrusted() ? .granted : .missing },
                      ask: {
                          let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
                          if !AXIsProcessTrustedWithOptions([key: true] as CFDictionary) { openSettings("Privacy_Accessibility") }
                      }),
        PermissionRow(id: "screen", symbol: "rectangle.dashed.badge.record", title: "Ekran Kaydı",
                      why: "Gerektiğinde ekrana bakmak (ekran görüntüsü). Verdikten sonra \(APP_ACC) bir kez yeniden aç.", needed: false,
                      check: { CGPreflightScreenCaptureAccess() ? .granted : .missing },
                      ask: { if !CGRequestScreenCaptureAccess() { openSettings("Privacy_ScreenCapture") } }),
        PermissionRow(id: "mic", symbol: "mic", title: "Mikrofon",
                      why: "Sesli komutlar ve \"\(WAKE_LABEL)\".", needed: true,
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
        PermissionRow(id: "speech", symbol: "waveform", title: "Konuşma Tanıma",
                      why: "Konuşurken söylediklerini yazmak ve \"\(WAKE_LABEL)\" demeni duymak (bu Mac'te, internetsiz).", needed: true,
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
        folderRow("Desktop", "Masaüstü klasörü", "\(APP_GEN) kendi dosyaları burada (~/Desktop/jev); dosya işleri.", needed: true),
        folderRow("Documents", "Belgeler klasörü", "\"Belgelerimde şunu bul\" gibi dosya işleri.", needed: false),
        folderRow("Downloads", "İndirilenler klasörü", "İndirilen dosyaları bulmak, taşımak.", needed: false)
    ]
    let apps: [(String, String, String, String)] = [
        ("com.apple.systemevents", "System Events", "Karanlık mod gibi sistem ayarları.", "gearshape"),
        ("com.spotify.client", "Spotify", "Şarkı çalmak, durdurmak, ne çaldığını söylemek.", "music.note"),
        ("com.apple.Music", "Müzik", "Müzik uygulamasında çalmak.", "music.note.list"),
        ("com.apple.Notes", "Notlar", "Not almak ve notlarda aramak.", "note.text"),
        ("com.apple.reminders", "Anımsatıcılar", "Anımsatıcı eklemek ve okumak.", "checklist"),
        ("com.apple.iCal", "Takvim", "Takvime bakmak ve etkinlik eklemek.", "calendar"),
        ("com.apple.MobileSMS", "Mesajlar", "Seni telefonundan iMessage ile haberdar etmek.", "message")
    ]
    rows += apps.compactMap { automationRow($0.0, $0.1, $0.2, symbol: $0.3) }
    return rows
}

final class PermissionsModel: ObservableObject {
    let rows = allPermissions()
    @Published var states: [String: PermissionState] = [:]
    private var timer: Timer?

    var missingNeeded: Bool { rows.contains { $0.needed && states[$0.id] != .granted } }
    var allGranted: Bool { rows.allSatisfy { states[$0.id] == .granted } }

    func refresh() {
        var next: [String: PermissionState] = [:]
        for row in rows { next[row.id] = row.check() }
        if next != states { states = next }
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

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 14) {
                if let icon = NSApp.applicationIconImage {
                    Image(nsImage: icon).resizable().frame(width: 56, height: 56)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(APP_GEN) izinleri").font(.title2.bold())
                    Text("\(APP_GEN) senin yerine çalışabilmesi için macOS bu izinleri soruyor. Her satırda \"İzin Ver\"e bas; izin verince satır kendiliğinden yeşile döner.")
                        .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(model.rows) { row in
                        PermissionRowView(row: row, state: model.states[row.id] ?? .missing)
                        if row.id != model.rows.last?.id { Divider() }
                    }
                }
                .background(RoundedRectangle(cornerRadius: 10).fill(Color(nsColor: .controlBackgroundColor)))
            }
            HStack {
                Text(model.allGranted ? "Hepsi tamam. 🦊" : model.missingNeeded ? "Kırmızı olanlar olmadan \(APP_NAME) düzgün çalışmaz." : "Gerekenler tamam; gerisi isteğe bağlı.")
                    .foregroundStyle(model.missingNeeded ? Color.red : Color.secondary)
                Spacer()
                Button(model.missingNeeded ? "Sonra" : "Bitti", action: close).keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 560, height: 640)
    }
}

struct PermissionRowView: View {
    let row: PermissionRow
    let state: PermissionState

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: row.symbol).frame(width: 24).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(row.title).font(.headline)
                    if row.needed { Text("gerekli").font(.caption2.bold()).padding(.horizontal, 5).padding(.vertical, 1).background(Capsule().fill(Color.orange.opacity(0.2))) }
                }
                Text(row.why).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            switch state {
            case .granted:
                Label("Verildi", systemImage: "checkmark.circle.fill").foregroundStyle(.green).labelStyle(.titleAndIcon)
            case .denied:
                Button("Ayarları Aç", action: row.ask)
            default:
                Button("İzin Ver", action: row.ask).buttonStyle(.borderedProminent)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }
}

/// The window itself; AppDelegate keeps one and shows it when needed.
final class PermissionsWindow: NSObject, NSWindowDelegate {
    let model = PermissionsModel()
    private var window: NSWindow?

    var missingNeeded: Bool { model.refresh(); return model.missingNeeded }

    func show() {
        if window == nil {
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 640), styleMask: [.titled, .closable], backing: .buffered, defer: false)
            w.title = "\(APP_NAME) İzinleri"
            w.isReleasedWhenClosed = false
            w.delegate = self
            w.contentView = NSHostingView(rootView: PermissionsView(model: model, close: { [weak w] in w?.close() }))
            w.center()
            window = w
        }
        model.start()
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }

    func windowWillClose(_ notification: Notification) { model.stop() }
}
