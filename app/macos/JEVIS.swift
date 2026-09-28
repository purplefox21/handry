// JEVIS app: starts the JEVIS server and shows it two ways:
//   - the bar: a compact field that drops from the top of the screen
//     (app/public/bar.html on a floating panel), and
//   - the big window: the full chat with details and history.
// It also owns the microphone (Listener.swift): push to talk, the bar's mic
// button and "Hey Jev". Built by `node cli.js app build`.
//   ⌥Space        open / close the bar
//   ⌥⇧Space       hold to talk (push to talk)
//   ⌥Esc          emergency stop
// The server runs as this app's child, so macOS permissions (Accessibility,
// Screen Recording, Microphone, Speech Recognition) are granted to JEVIS.
import Cocoa
import WebKit
import Carbon
import AVFoundation

let info = Bundle.main.infoDictionary ?? [:]
let env = ProcessInfo.processInfo.environment
let ROOT = env["JEVIS_ROOT"] ?? info["JEVISRoot"] as? String ?? ""
let NODE = env["JEVIS_NODE"] ?? info["JEVISNode"] as? String ?? "/opt/homebrew/bin/node"
let PORT = env["JEVIS_PORT"] ?? info["JEVISPort"] as? String ?? "3000"
let HOME = FileManager.default.homeDirectoryForCurrentUser.path
let URL_BASE = "http://127.0.0.1:\(PORT)/"
let BAR_WIDTH: CGFloat = 680
let BAR_HEIGHT: CGFloat = 58

/// A panel that can take typing without making JEVIS the active app, so the
/// app the user was in stays "in front" for commands like "bunu kapat".
final class BarPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, NSWindowDelegate, WKScriptMessageHandler {
    var statusItem: NSStatusItem!
    var window: NSWindow!
    var webView: WKWebView!
    var bar: BarPanel!
    var barWeb: WKWebView!
    var barBusy = false
    var barReady = false
    var wakeItems: [NSMenuItem] = []
    let listener = Listener()
    var server: Process?
    var hotKeys: [EventHotKeyRef?] = []
    var quitting = false
    var restarts: [Date] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        UserDefaults.standard.register(defaults: ["heyJev": true])
        buildMainMenu()
        buildMenu()
        buildWindow()
        buildBar()
        setUpListener()
        registerHotKeys()
        showBar(mode: "type")
        loadWhenReady()
    }

    func applicationWillTerminate(_ notification: Notification) {
        quitting = true
        server?.terminate()
    }

    // Clicking the Dock icon (or opening the app again) shows the big window.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWindow()
        return true
    }

    // Closing the window keeps JEVIS running for the bar and the keys.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    /// Shows a waiting page, then the chat once the server answers. On first
    /// launch macOS may be asking for folder access, so it waits patiently.
    func loadWhenReady() {
        let waiting = """
        <meta name="color-scheme" content="light dark">
        <body style="font:15px -apple-system;margin:0;display:flex;align-items:center;gap:10px;height:\(Int(BAR_HEIGHT))px;padding:0 18px;color:#8e8e93;background:transparent">
        <b style="color:CanvasText;font-weight:600">JEVIS başlıyor…</b> macOS bir izin soruyorsa <b>İzin Ver</b>'e bas.</body>
        """
        barReady = false
        barWeb.loadHTMLString(waiting, baseURL: nil)
        webView.loadHTMLString("""
        <meta name="color-scheme" content="light dark">
        <body style="font:15px -apple-system;display:grid;place-items:center;height:90vh;text-align:center;color:#8e8e93">
        <div><h2 style="color:CanvasText;font-weight:600">JEVIS başlıyor…</h2>
        <p>macOS bir izin soruyorsa (ör. Masaüstü klasörü) <b>İzin Ver</b>'e bas.</p></div></body>
        """, baseURL: nil)
        startServer { [weak self] ok in
            guard let self else { return }
            if ok {
                self.webView.load(URLRequest(url: URL(string: URL_BASE)!))
                self.barWeb.load(URLRequest(url: URL(string: URL_BASE + "bar.html")!))
            } else {
                self.webView.loadHTMLString("<meta name='color-scheme' content='light dark'><body style='font:15px -apple-system;padding:2em'><h2>JEVIS sunucusu başlamadı</h2><p>Kayıt: ~/.jevis/logs/app-server.log</p><p>Menüden JEVIS › Sunucuyu Yeniden Başlat'ı dene.</p></body>", baseURL: nil)
                self.barWeb.loadHTMLString("<meta name='color-scheme' content='light dark'><body style='font:14px -apple-system;margin:0;padding:18px;color:#e5383b;background:transparent'>JEVIS sunucusu başlamadı. Menüden “Sunucuyu Yeniden Başlat”ı dene.</body>", baseURL: nil)
            }
        }
    }

    // MARK: Main menu (shown at the top of the screen while JEVIS is in front)

    func buildMainMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: "JEVIS")
        appMenu.addItem(NSMenuItem(title: "JEVIS Hakkında", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: ""))
        appMenu.addItem(.separator())
        appMenu.addItem(item("JEVIS Çubuğu   ⌥Space", #selector(toggleBar)))
        appMenu.addItem(item("Büyük Pencere", #selector(openWindow)))
        appMenu.addItem(wakeItem())
        appMenu.addItem(.separator())
        appMenu.addItem(item("İzinleri Kontrol Et…", #selector(checkPermissions)))
        appMenu.addItem(item("Sunucuyu Yeniden Başlat", #selector(restartServer)))
        appMenu.addItem(item("Tarayıcıda Aç", #selector(openInBrowser)))
        appMenu.addItem(.separator())
        appMenu.addItem(item("⛔ Acil Durdur   ⌥Esc", #selector(emergencyStop)))
        appMenu.addItem(.separator())
        appMenu.addItem(NSMenuItem(title: "JEVIS'i Gizle", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"))
        appMenu.addItem(NSMenuItem(title: "JEVIS'ten Çık", action: #selector(quit), keyEquivalent: "q"))
        appItem.submenu = appMenu
        main.addItem(appItem)

        let editItem = NSMenuItem()
        let edit = NSMenu(title: "Düzen")
        edit.addItem(NSMenuItem(title: "Geri Al", action: Selector(("undo:")), keyEquivalent: "z"))
        let redo = NSMenuItem(title: "Yinele", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(redo)
        edit.addItem(.separator())
        edit.addItem(NSMenuItem(title: "Kes", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
        edit.addItem(NSMenuItem(title: "Kopyala", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        edit.addItem(NSMenuItem(title: "Yapıştır", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
        edit.addItem(NSMenuItem(title: "Tümünü Seç", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
        editItem.submenu = edit
        main.addItem(editItem)

        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Pencere")
        windowMenu.addItem(NSMenuItem(title: "Küçült", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"))
        windowMenu.addItem(NSMenuItem(title: "Kapat", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"))
        windowItem.submenu = windowMenu
        main.addItem(windowItem)
        NSApp.mainMenu = main
        NSApp.windowsMenu = windowMenu
    }

    // MARK: Menu bar

    func buildMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "⚡"
        statusItem.button?.toolTip = "JEVIS"
        let menu = NSMenu()
        menu.addItem(item("JEVIS Çubuğu   ⌥Space", #selector(toggleBar)))
        menu.addItem(item("Büyük Pencere", #selector(openWindow)))
        menu.addItem(wakeItem())
        menu.addItem(item("Bas-Konuş   ⌥⇧Space (basılı tut)", #selector(toggleBar)))
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

    func wakeItem() -> NSMenuItem {
        let i = item("“Hey Jev” ile Dinle", #selector(toggleWake))
        i.state = UserDefaults.standard.bool(forKey: "heyJev") ? .on : .off
        wakeItems.append(i)
        return i
    }

    // MARK: Big window

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
        hideBar()
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    @objc func openWindow() { showWindow() }

    // Closing only hides: the server and the keys keep working.
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil)
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

    // MARK: Bar

    func buildBar() {
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "bar")
        let frame = NSRect(x: 0, y: 0, width: BAR_WIDTH, height: BAR_HEIGHT)
        barWeb = WKWebView(frame: frame, configuration: config)
        barWeb.setValue(false, forKey: "drawsBackground")
        barWeb.autoresizingMask = [.width, .height]
        barWeb.uiDelegate = self
        let glass = NSVisualEffectView(frame: frame)
        glass.material = .popover
        glass.blendingMode = .behindWindow
        glass.state = .active
        glass.wantsLayer = true
        glass.layer?.cornerRadius = 16
        glass.layer?.cornerCurve = .continuous
        glass.layer?.masksToBounds = true
        glass.addSubview(barWeb)
        bar = BarPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        bar.contentView = glass
        bar.isOpaque = false
        bar.backgroundColor = .clear
        bar.hasShadow = true
        bar.level = .floating
        bar.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        bar.hidesOnDeactivate = false
        bar.isReleasedWhenClosed = false
        bar.isMovable = false
        bar.delegate = self
    }

    /// Top middle of the screen the mouse is on, just under the menu bar.
    func placeBar(height: CGFloat) {
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main ?? NSScreen.screens[0]
        let area = screen.visibleFrame
        bar.setFrame(NSRect(x: area.midX - BAR_WIDTH / 2, y: area.maxY - 10 - height, width: BAR_WIDTH, height: height), display: true)
    }

    func showBar(mode: String) {
        if !bar.isVisible { placeBar(height: max(bar.frame.height, BAR_HEIGHT)) }
        bar.orderFrontRegardless()
        bar.makeKey()
        bar.makeFirstResponder(barWeb)
        barWeb.evaluateJavaScript("window.jevisBar && window.jevisBar.show('\(mode)')")
    }

    func hideBar() {
        guard bar.isVisible else { return }
        bar.orderOut(nil)
        barWeb.evaluateJavaScript("window.jevisBar && window.jevisBar.hidden()")
    }

    @objc func toggleBar() {
        if bar.isVisible && bar.isKeyWindow { hideBar() } else { showBar(mode: "type") }
    }

    // Clicking elsewhere hides the bar, unless it is working or listening.
    func windowDidResignKey(_ notification: Notification) {
        guard (notification.object as? NSWindow) === bar, !barBusy, !listener.isActive else { return }
        hideBar()
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "height":
            guard let h = body["value"] as? Double, h > 20 else { return }
            let height = min(CGFloat(h), 520)
            let top = bar.frame.maxY
            bar.setFrame(NSRect(x: bar.frame.minX, y: top - height, width: BAR_WIDTH, height: height), display: true)
            bar.invalidateShadow()
        case "hide":
            hideBar()
        case "openMain":
            showWindow()
        case "busy":
            barBusy = body["value"] as? Bool ?? false
        case "mic":
            if listener.isActive { listener.finish() } else { startListening(pushToTalk: false) }
        case "stopVoice":
            listener.cancel()
        default:
            break
        }
    }

    // MARK: Voice

    func setUpListener() {
        listener.onWake = { [weak self] in
            NSSound(named: "Tink")?.play()
            self?.showBar(mode: "voice")
        }
        listener.onStart = { [weak self] in self?.sendVoice(["type": "start"]) }
        listener.onPartial = { [weak self] text in self?.sendVoice(["type": "partial", "text": text]) }
        listener.onFinal = { [weak self] text, wav, woke in
            NSSound(named: "Pop")?.play()
            self?.sendVoice(["type": "final", "text": text, "file": wav?.path ?? "", "wake": woke])
        }
        listener.onCancel = { [weak self] in self?.sendVoice(["type": "cancel"]) }
        listener.onError = { [weak self] message in self?.sendVoice(["type": "error", "message": message]) }
        NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: nil, queue: .main) { [weak self] _ in
            self?.listener.restartEngine()
        }
        if UserDefaults.standard.bool(forKey: "heyJev") { enableWake(true) }
    }

    func sendVoice(_ event: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: event), let json = String(data: data, encoding: .utf8) else { return }
        barWeb.evaluateJavaScript("window.jevisBar && window.jevisBar.voice(\(json))")
    }

    func startListening(pushToTalk: Bool) {
        Listener.requestPermissions { [weak self] mic, _ in
            guard let self else { return }
            guard mic else {
                self.showBar(mode: "voice")
                self.sendVoice(["type": "error", "message": "Mikrofon izni yok: Sistem Ayarları › Gizlilik ve Güvenlik › Mikrofon'da JEVIS'i aç."])
                return
            }
            self.showBar(mode: "voice")
            self.listener.startActive(pushToTalk: pushToTalk)
        }
    }

    func enableWake(_ on: Bool) {
        UserDefaults.standard.set(on, forKey: "heyJev")
        wakeItems.forEach { $0.state = on ? .on : .off }
        guard on else { listener.setWake(false); return }
        Listener.requestPermissions { [weak self] mic, speech in
            guard let self else { return }
            // "Hey Jev" is found by the speech recognizer: it needs both permissions.
            self.listener.setWake(mic && speech)
            if !(mic && speech) { self.wakeItems.forEach { $0.state = .mixed } }
        }
    }

    @objc func toggleWake() {
        enableWake(!UserDefaults.standard.bool(forKey: "heyJev"))
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
        case (1, true): toggleBar()
        case (2, true): startListening(pushToTalk: true)
        case (2, false): listener.finish()
        case (3, true): emergencyStop()
        default: break
        }
    }

    // MARK: Actions

    @objc func emergencyStop() {
        // The flag file stops every tool at once (also in other Claude Code sessions);
        // the pages' buttons also abort a running brain.
        let dir = "\(HOME)/.jevis"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let stamp = Int(Date().timeIntervalSince1970 * 1000)
        try? "{\"at\":\(stamp),\"reason\":\"kısayol\"}".write(toFile: "\(dir)/STOP", atomically: true, encoding: .utf8)
        let click = "(() => { const b = document.getElementById('stopBtn'); if (b && !b.hidden && !b.closest('[hidden]')) b.click(); })()"
        webView.evaluateJavaScript(click)
        barWeb.evaluateJavaScript(click)
        listener.cancel()
        statusItem.button?.title = "⛔"
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.statusItem.button?.title = "⚡" }
    }

    @objc func openInBrowser() {
        NSWorkspace.shared.open(URL(string: URL_BASE)!)
    }

    @objc func checkPermissions() {
        let trusted = AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
        let screen = CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess()
        Listener.requestPermissions { mic, speech in
            let alert = NSAlert()
            alert.messageText = "JEVIS izinleri"
            alert.informativeText = """
            Erişilebilirlik: \(trusted ? "✅" : "❌ Sistem Ayarları › Gizlilik ve Güvenlik › Erişilebilirlik")
            Ekran Kaydı: \(screen ? "✅" : "❌ Sistem Ayarları › Gizlilik ve Güvenlik › Ekran ve Sistem Sesi Kaydı")
            Mikrofon: \(mic ? "✅" : "❌ Sistem Ayarları › Gizlilik ve Güvenlik › Mikrofon")
            Konuşma Tanıma: \(speech ? "✅" : "❌ Sistem Ayarları › Gizlilik ve Güvenlik › Konuşma Tanıma")
            """
            alert.runModal()
        }
    }

    @objc func restartServer() {
        let old = server
        server = nil // not a crash: don't let the termination handler restart it too
        old?.terminate()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
            self?.showBar(mode: "type")
            self?.loadWhenReady()
        }
    }

    @objc func quit() {
        quitting = true
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
                // If the server dies on its own, start it again (at most 3 times a minute).
                p.terminationHandler = { [weak self] proc in
                    DispatchQueue.main.async {
                        guard let self, !self.quitting, self.server === proc else { return }
                        self.server = nil
                        self.restarts = self.restarts.filter { $0.timeIntervalSinceNow > -60 } + [Date()]
                        if self.restarts.count <= 3 { self.loadWhenReady() }
                    }
                }
                do { try p.run() } catch { return completion(false) }
                self.server = p
                self.waitForServer(tries: 240, completion)
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

@main
struct JEVISApp {
    static func main() {
        let args = CommandLine.arguments
        // JEVIS --test-listener in.wav --out out.json [--active]: runs a recording
        // through the listener (uses JEVIS's own speech permission), then quits.
        if let i = args.firstIndex(of: "--test-listener"), i + 1 < args.count,
           let o = args.firstIndex(of: "--out"), o + 1 < args.count {
            Listener.runFileTest(input: args[i + 1], output: args[o + 1], active: args.contains("--active"))
            RunLoop.main.run()
            return
        }
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}
