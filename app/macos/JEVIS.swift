// JEVIS app: starts the JEVIS server, shows the chat in a window, and adds a
// Dock icon, a normal menu (Edit menu included, so ⌘C/⌘V work in the page)
// and global keys. The ⚡ menu bar item is extra: on notched MacBooks macOS
// may hide it. Built by `node cli.js app build`.
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
    var quitting = false
    var restarts: [Date] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMainMenu()
        buildMenu()
        buildWindow()
        registerHotKeys()
        showWindow()
        loadWhenReady()
    }

    func applicationWillTerminate(_ notification: Notification) {
        quitting = true
        server?.terminate()
    }

    // Clicking the Dock icon (or opening the app again) brings the window back.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWindow()
        return true
    }

    // Closing the window keeps JEVIS running for the global keys.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    /// Shows a waiting page, then the chat once the server answers. On first
    /// launch macOS may be asking for folder access, so it waits patiently.
    func loadWhenReady() {
        webView.loadHTMLString("""
        <meta name="color-scheme" content="light dark">
        <body style="font:15px -apple-system;display:grid;place-items:center;height:90vh;text-align:center;color:#8e8e93">
        <div><h2 style="color:CanvasText;font-weight:600">JEVIS başlıyor…</h2>
        <p>macOS bir izin soruyorsa (ör. Masaüstü klasörü) <b>İzin Ver</b>'e bas.</p></div></body>
        """, baseURL: nil)
        startServer { [weak self] ok in
            guard let self else { return }
            if ok { self.webView.load(URLRequest(url: URL(string: URL_BASE)!)) }
            else { self.webView.loadHTMLString("<meta name='color-scheme' content='light dark'><body style='font:15px -apple-system;padding:2em'><h2>JEVIS sunucusu başlamadı</h2><p>Kayıt: ~/.jevis/logs/app-server.log</p><p>Menüden JEVIS › Sunucuyu Yeniden Başlat'ı dene.</p></body>", baseURL: nil) }
        }
    }

    // MARK: Main menu (shown at the top of the screen while JEVIS is in front)

    func buildMainMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: "JEVIS")
        appMenu.addItem(NSMenuItem(title: "JEVIS Hakkında", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: ""))
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
        let old = server
        server = nil // not a crash: don't let the termination handler restart it too
        old?.terminate()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
            self?.showWindow()
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

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
