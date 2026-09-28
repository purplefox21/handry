// JEVIS menu bar app: starts the JEVIS server, shows the chat in a window and
// adds global keys. Built by `node cli.js app build`.
//   ⌥Space        open / close the chat window
//   ⌥⇧Space       hold to talk (push to talk)
//   ⌥Esc          emergency stop
// The server runs as this app's child, so macOS permissions (Accessibility,
// Screen Recording, Microphone) are granted once, to JEVIS.
import Cocoa
import WebKit
import Carbon

let info = Bundle.main.infoDictionary ?? [:]
let env = ProcessInfo.processInfo.environment
let ROOT = env["JEVIS_ROOT"] ?? info["JEVISRoot"] as? String ?? ""
let NODE = env["JEVIS_NODE"] ?? info["JEVISNode"] as? String ?? "/opt/homebrew/bin/node"
let PORT = env["JEVIS_PORT"] ?? info["JEVISPort"] as? String ?? "3000"
let HOME = FileManager.default.homeDirectoryForCurrentUser.path
let URL_BASE = "http://127.0.0.1:\(PORT)/"

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, NSWindowDelegate {
    var statusItem: NSStatusItem!
    var window: NSWindow!
    var webView: WKWebView!
    var server: Process?
    var hotKeys: [EventHotKeyRef?] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        buildWindow()
        registerHotKeys()
        startServer { [weak self] ok in
            guard let self else { return }
            if ok { self.webView.load(URLRequest(url: URL(string: URL_BASE)!)) }
            else { self.webView.loadHTMLString("<body style='font:15px -apple-system;padding:2em;background:#0a0c10;color:#f8fafc'><h2>JEVIS sunucusu başlamadı</h2><p>Kayıt: ~/.jevis/logs/app-server.log</p></body>", baseURL: nil) }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        server?.terminate()
    }

    // MARK: Menu bar

    func buildMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "⚡"
        statusItem.button?.toolTip = "JEVIS"
        let menu = NSMenu()
        menu.addItem(item("JEVIS'i Aç / Kapat   ⌥Space", #selector(toggleWindow)))
        menu.addItem(item("Bas-Konuş   ⌥⇧Space (basılı tut)", #selector(toggleWindow)))
        menu.addItem(item("⛔ Acil Durdur   ⌥Esc", #selector(emergencyStop)))
        menu.addItem(.separator())
        menu.addItem(item("Tarayıcıda Aç", #selector(openInBrowser)))
        menu.addItem(item("İzinleri Kontrol Et…", #selector(checkPermissions)))
        menu.addItem(item("Sunucuyu Yeniden Başlat", #selector(restartServer)))
        menu.addItem(.separator())
        menu.addItem(item("JEVIS'ten Çık", #selector(quit)))
        statusItem.menu = menu
    }

    func item(_ title: String, _ action: Selector) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: "")
        i.target = self
        return i
    }

    // MARK: Window

    func buildWindow() {
        let config = WKWebViewConfiguration()
        webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 920, height: 760),
                          styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "JEVIS"
        window.contentView = webView
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.center()
        window.setFrameAutosaveName("JEVISWindow")
    }

    func showWindow() {
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    @objc func toggleWindow() {
        if window.isVisible && NSApp.isActive { window.orderOut(nil) } else { showWindow() }
    }

    // Closing only hides: the server and the keys keep working.
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        window.orderOut(nil)
        return false
    }

    // The chat page asks for the microphone for push to talk.
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(["127.0.0.1", "localhost"].contains(origin.host) ? .grant : .deny)
    }

    // window.prompt() (recipe names and values) needs a native panel in WKWebView.
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = prompt
        alert.addButton(withTitle: "Tamam")
        alert.addButton(withTitle: "Vazgeç")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.window.initialFirstResponder = field
        completionHandler(alert.runModal() == .alertFirstButtonReturn ? field.stringValue : nil)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.runModal()
        completionHandler()
    }

    // MARK: Global keys

    func registerHotKeys() {
        var events = [EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed)),
                      EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyReleased))]
        InstallEventHandler(GetApplicationEventTarget(), { _, event, userData -> OSStatus in
            var id = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
                              MemoryLayout<EventHotKeyID>.size, nil, &id)
            let app = Unmanaged<AppDelegate>.fromOpaque(userData!).takeUnretainedValue()
            app.hotKey(id.id, pressed: GetEventKind(event) == UInt32(kEventHotKeyPressed))
            return noErr
        }, 2, &events, Unmanaged.passUnretained(self).toOpaque(), nil)
        register(1, keyCode: UInt32(kVK_Space), modifiers: optionKey)
        register(2, keyCode: UInt32(kVK_Space), modifiers: optionKey | shiftKey)
        register(3, keyCode: UInt32(kVK_Escape), modifiers: optionKey)
    }

    func register(_ id: UInt32, keyCode: UInt32, modifiers: Int) {
        var ref: EventHotKeyRef?
        RegisterEventHotKey(keyCode, UInt32(modifiers), EventHotKeyID(signature: OSType(0x4A45_5653), id: id), GetApplicationEventTarget(), 0, &ref)
        hotKeys.append(ref)
    }

    func hotKey(_ id: UInt32, pressed: Bool) {
        switch (id, pressed) {
        case (1, true): toggleWindow()
        case (2, true):
            showWindow()
            webView.evaluateJavaScript("window.jevisVoice && window.jevisVoice.start()")
        case (2, false): webView.evaluateJavaScript("window.jevisVoice && window.jevisVoice.stop()")
        case (3, true): emergencyStop()
        default: break
        }
    }

    // MARK: Actions

    @objc func emergencyStop() {
        // The flag file stops every tool at once (also in other Claude Code sessions);
        // the page's button also aborts a running brain.
        let dir = "\(HOME)/.jevis"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let stamp = Int(Date().timeIntervalSince1970 * 1000)
        try? "{\"at\":\(stamp),\"reason\":\"kısayol\"}".write(toFile: "\(dir)/STOP", atomically: true, encoding: .utf8)
        webView.evaluateJavaScript("(() => { const b = document.getElementById('stopBtn'); if (b && !b.hidden) b.click(); })()")
        statusItem.button?.title = "⛔"
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.statusItem.button?.title = "⚡" }
    }

    @objc func openInBrowser() {
        NSWorkspace.shared.open(URL(string: URL_BASE)!)
    }

    @objc func checkPermissions() {
        let trusted = AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
        let screen = CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess()
        let alert = NSAlert()
        alert.messageText = "JEVIS izinleri"
        alert.informativeText = "Erişilebilirlik: \(trusted ? "✅" : "❌ Sistem Ayarları › Gizlilik ve Güvenlik › Erişilebilirlik")\nEkran Kaydı: \(screen ? "✅" : "❌ Sistem Ayarları › Gizlilik ve Güvenlik › Ekran Kaydı")\nMikrofon: ilk bas-konuşta sorulur."
        alert.runModal()
    }

    @objc func restartServer() {
        server?.terminate()
        server = nil
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
            self?.startServer { ok in if ok { self?.webView.reload() } }
        }
    }

    @objc func quit() {
        NSApp.terminate(nil)
    }

    // MARK: Server

    func serverUp(_ done: @escaping (Bool) -> Void) {
        var req = URLRequest(url: URL(string: URL_BASE)!)
        req.timeoutInterval = 1
        URLSession.shared.dataTask(with: req) { _, res, _ in done((res as? HTTPURLResponse)?.statusCode == 200) }.resume()
    }

    /// Reuses a server that is already running (e.g. `npm start`), otherwise starts one.
    func startServer(_ completion: @escaping (Bool) -> Void) {
        serverUp { [weak self] up in
            DispatchQueue.main.async {
                guard let self else { return }
                if up { return completion(true) }
                let p = Process()
                p.executableURL = URL(fileURLWithPath: NODE)
                p.arguments = ["\(ROOT)/app/server.js"]
                p.currentDirectoryURL = URL(fileURLWithPath: ROOT)
                var e = ProcessInfo.processInfo.environment
                e["PORT"] = PORT
                e["PATH"] = "/opt/homebrew/bin:/usr/local/bin:\(HOME)/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
                p.environment = e
                let logDir = "\(HOME)/.jevis/logs"
                try? FileManager.default.createDirectory(atPath: logDir, withIntermediateDirectories: true)
                FileManager.default.createFile(atPath: "\(logDir)/app-server.log", contents: nil)
                let log = FileHandle(forWritingAtPath: "\(logDir)/app-server.log")
                p.standardOutput = log
                p.standardError = log
                do { try p.run() } catch { return completion(false) }
                self.server = p
                self.waitForServer(tries: 40, completion)
            }
        }
    }

    func waitForServer(tries: Int, _ completion: @escaping (Bool) -> Void) {
        serverUp { up in
            DispatchQueue.main.asyncAfter(deadline: .now() + (up ? 0 : 0.25)) { [weak self] in
                if up { completion(true) } else if tries <= 0 { completion(false) } else { self?.waitForServer(tries: tries - 1, completion) }
            }
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
