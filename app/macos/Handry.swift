// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Handry, Handry's app (the name comes from core/brand.js): starts the Handry
// server and shows it three ways:
//   - the bar: a compact field that drops from the top of the screen
//     (app/public/bar.html on a floating panel), and
//   - the big window: the full chat with details and history,
//   - the pet on the screen (Fox.swift): the hand that walks on its fingers,
//     or Foxie the fox; it shows what the assistant is doing.
// The permissions window (Permissions.swift) asks for everything in one place.
// It also owns the microphone (Listener.swift): push to talk, the bar's mic
// button and the wake word ("Hey Handry"). Built by `node cli.js app build`.
//   ⌥Space        open / close the bar
//   ⌥⇧Space       hold to talk (push to talk)
//   ⌥Esc          emergency stop
// The server runs as this app's child, so macOS permissions (Accessibility,
// Screen Recording, Microphone, Speech Recognition) are granted to Handry.
import Cocoa
import WebKit
import Carbon
import AVFoundation

let info = Bundle.main.infoDictionary ?? [:]
let env = ProcessInfo.processInfo.environment
let ROOT = env["JEVIS_ROOT"] ?? info["JEVISRoot"] as? String ?? ""
let NODE = env["JEVIS_NODE"] ?? info["JEVISNode"] as? String ?? "/opt/homebrew/bin/node"
let PORT = env["JEVIS_PORT"] ?? info["JEVISPort"] as? String ?? "4263"
let HOME = FileManager.default.homeDirectoryForCurrentUser.path
/// Links that lead to the current node and survive a Homebrew upgrade (the versioned folder NODE was built with does not).
let NODE_FALLBACKS = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "\(HOME)/.local/bin/node"]
func findNode() -> String? {
    ([NODE] + NODE_FALLBACKS).first { FileManager.default.isExecutableFile(atPath: $0) }
}
let URL_BASE = "http://127.0.0.1:\(PORT)/"

// The language the app speaks, by the same rule as core/i18n.js: config "language" ("tr", "en" or "auto")
// in ~/.jevis/config.json, else in the project's handry.config.json; "auto" (the default) is Turkish when
// the Mac's first language is Turkish, English otherwise; JEVIS_LANG=tr|en overrides it. Fixed at launch:
// when it changes (the Dil / Language menu or the window's Settings) the app opens itself again (watchLanguage).
func languageSetting() -> String {
    let project = ["handry.config.json", "jevis.config.json"].map { "\(ROOT)/\($0)" }.first { FileManager.default.fileExists(atPath: $0) }
    for file in ["\(HOME)/.jevis/config.json", project].compactMap({ $0 }) {
        guard let data = FileManager.default.contents(atPath: file),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let value = json["language"], !(value is NSNull) else { continue }
        if let s = value as? String, s == "tr" || s == "en" { return s }
        return "auto"
    }
    return "auto"
}

/// "tr" or "en": what the setting gives now.
func currentLanguage() -> String {
    if let forced = env["JEVIS_LANG"], forced == "tr" || forced == "en" { return forced }
    let setting = languageSetting()
    if setting != "auto" { return setting }
    return (Locale.preferredLanguages.first ?? "").lowercased().hasPrefix("tr") ? "tr" : "en"
}

let LANG = currentLanguage()
/// The Turkish or the English text, by the language the app started in: L("\(APP_NAME) başlıyor…", "\(APP_NAME) is starting…")
func L(_ tr: String, _ en: String) -> String { LANG == "en" ? en : tr }

// The app's name and its Turkish endings, the fox's name and the wake word (core/brand.js, via Info.plist).
// In English only the plain name is used.
let APP_NAME = info["CFBundleDisplayName"] as? String ?? "Handry"
let APP_ACC = info["AppAccusative"] as? String ?? "\(APP_NAME)'yu"
let APP_ABL = info["AppAblative"] as? String ?? "\(APP_NAME)'dan"
let APP_GEN = info["AppGenitive"] as? String ?? "\(APP_NAME)'nun"
let WAKE_LABEL = info["WakeLabel"] as? String ?? "Hey Handry"
// Who made it (core/brand.js, via Info.plist).
let CREDIT = info["HandryAuthor"] as? String ?? "Berat Olekli (purplefox)"
let AUTHOR_URL = info["HandryAuthorURL"] as? String ?? "https://github.com/purplefox21"
let REPO_URL = info["HandryRepoURL"] as? String ?? "https://github.com/purplefox21/handry"
let LINKEDIN_URL = info["HandryLinkedInURL"] as? String ?? ""
let BAR_WIDTH: CGFloat = 640
let BAR_HEIGHT: CGFloat = 54
let BAR_EAR: CGFloat = 10

/// A panel that can take typing without making Handry the active app, so the
/// app the user was in stays "in front" for commands like "bunu kapat".
/// It may sit over the menu bar (it hangs from the top edge of the screen).
final class BarPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

/// The bar's shape: it hangs from the top edge of the screen like the camera
/// notch and grows out of it. Dark frosted glass, so the page behind shows
/// through; black at the top, where it meets the notch. The page sits under
/// the notch; while the shape grows or shrinks the page keeps its size and is cut.
final class IslandView: NSView {
    var top: CGFloat = 0 { didSet { relayout() } }        // the notch's height (0 without one)
    var pageHeight: CGFloat = BAR_HEIGHT { didSet { relayout() } }
    let page: NSView
    private let shape = CAShapeLayer()
    private let glass = NSVisualEffectView()
    private let shade = NSView()      // black at the notch, fading into the glass
    private let fade = CAGradientLayer()

    init(page: NSView) {
        self.page = page
        super.init(frame: NSRect(x: 0, y: 0, width: BAR_WIDTH + 2 * BAR_EAR, height: BAR_HEIGHT))
        wantsLayer = true
        layer?.mask = shape
        glass.material = .hudWindow
        glass.blendingMode = .behindWindow
        glass.state = .active
        glass.appearance = NSAppearance(named: .darkAqua)
        glass.autoresizingMask = [.width, .height]
        glass.frame = bounds
        addSubview(glass)
        shade.wantsLayer = true
        fade.colors = [NSColor.black.cgColor, NSColor.black.cgColor, NSColor.black.withAlphaComponent(0).cgColor]
        fade.startPoint = CGPoint(x: 0.5, y: 1)
        fade.endPoint = CGPoint(x: 0.5, y: 0)
        shade.layer = fade
        addSubview(shade)
        addSubview(page)
        relayout()
    }
    required init?(coder: NSCoder) { fatalError() }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        relayout()
    }

    private func relayout() {
        let outline = islandPath(width: bounds.width, height: bounds.height, ear: BAR_EAR, radius: min(22, bounds.height / 2))
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        shape.frame = bounds
        shape.path = outline
        // The blur behind the window is cut by its own mask, not by the layer's.
        if bounds.width > 0, bounds.height > 0 {
            glass.maskImage = NSImage(size: bounds.size, flipped: false) { _ in
                NSColor.black.setFill()
                NSBezierPath(cgPath: outline).fill()
                return true
            }
        }
        // (only under a notch: without one there is nothing black to meet)
        let fadeHeight = top + 16
        shade.isHidden = top == 0
        shade.frame = NSRect(x: 0, y: bounds.height - fadeHeight, width: bounds.width, height: fadeHeight)
        fade.locations = [0, NSNumber(value: Double(top / fadeHeight)), 1]
        CATransaction.commit()
        page.frame = NSRect(x: (bounds.width - BAR_WIDTH) / 2, y: bounds.height - top - pageHeight, width: BAR_WIDTH, height: pageHeight)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, NSWindowDelegate, WKScriptMessageHandler, NSMenuDelegate {
    var statusItem: NSStatusItem!
    var flashUntil = Date.distantPast // the ⛔ after an emergency stop stays a moment
    var fox: FoxPet?
    var overlay: Overlay?
    let permissions = PermissionsWindow()
    var activitySeen: Double = 0
    var window: NSWindow!
    var webView: WKWebView!
    var bar: BarPanel!
    var barWeb: WKWebView!
    var island: IslandView!
    var barScreen: NSScreen?
    var barClosing = false
    var barClosingAt = Date.distantPast
    var barBusy = false
    var barReady = false
    var wakeItems: [NSMenuItem] = []
    let listener = Listener()
    var server: Process?
    var hotKeys: [EventHotKeyRef?] = []
    var quitting = false
    var relaunching = false
    var restarts: [Date] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        UserDefaults.standard.register(defaults: ["heyJev": true])
        buildMainMenu()
        buildMenu()
        buildWindow()
        buildBar()
        setUpListener()
        watchAttention()
        watchTimers()
        watchLanguage()
        registerHotKeys()
        makeFox()
        overlay = Overlay()
        overlay?.onNotchClick = { [weak self] in self?.notchClicked() }
        watchActivity()
        // Not over a full-screen app (a game): the bar would take its keyboard.
        if !NSScreen.screens.contains(where: { s in visibleWindows().contains { $0.frame.equalTo(s.frame) && $0.pid == NSWorkspace.shared.frontmostApplication?.processIdentifier } }) {
            showBar(mode: "type")
        }
        loadWhenReady()
        // First launch, or something the app needs is missing: the permissions window.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            guard let self else { return }
            if !UserDefaults.standard.bool(forKey: "permissionsShown") || self.permissions.missingNeeded {
                UserDefaults.standard.set(true, forKey: "permissionsShown")
                self.permissions.show()
            }
        }
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

    // Closing the window keeps Handry running for the bar and the keys.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    /// Shows a waiting page, then the chat once the server answers. On first
    /// launch macOS may be asking for folder access, so it waits patiently.
    func loadWhenReady() {
        let waiting = """
        <meta name="color-scheme" content="dark">
        <body style="font:14px -apple-system;margin:0;display:flex;align-items:center;gap:10px;height:\(Int(BAR_HEIGHT))px;padding:0 20px;color:rgba(255,255,255,.5);background:transparent">
        <b style="color:#f5f5f7;font-weight:500">\(L("\(APP_NAME) başlıyor…", "\(APP_NAME) is starting…"))</b> \(L("macOS bir izin soruyorsa <b>İzin Ver</b>'e bas.", "If macOS asks for a permission, click <b>Allow</b>."))</body>
        """
        barReady = false
        barWeb.loadHTMLString(waiting, baseURL: nil)
        webView.loadHTMLString("""
        <meta name="color-scheme" content="light dark">
        <body style="font:15px -apple-system;display:grid;place-items:center;height:90vh;text-align:center;color:#8e8e93">
        <div><h2 style="color:CanvasText;font-weight:600">\(L("\(APP_NAME) başlıyor…", "\(APP_NAME) is starting…"))</h2>
        <p>\(L("macOS bir izin soruyorsa (ör. Masaüstü klasörü) <b>İzin Ver</b>'e bas.", "If macOS asks for a permission (the Desktop folder, for example), click <b>Allow</b>."))</p></div></body>
        """, baseURL: nil)
        startServer { [weak self] ok in
            guard let self else { return }
            if ok {
                folderAsked("Desktop")
                self.webView.load(URLRequest(url: URL(string: URL_BASE)!))
                self.barWeb.load(URLRequest(url: URL(string: URL_BASE + "bar.html")!))
            } else {
                self.webView.loadHTMLString("<meta name='color-scheme' content='light dark'><body style='font:15px -apple-system;padding:2em'>" + L(
                    "<h2>\(APP_NAME) sunucusu başlamadı</h2><p>Kayıt: ~/.jevis/logs/app-server.log</p><p>Menüden \(APP_NAME) › Sunucuyu Yeniden Başlat'ı dene.</p>",
                    "<h2>\(APP_NAME)'s server didn't start</h2><p>Log: ~/.jevis/logs/app-server.log</p><p>Try \(APP_NAME) › Restart Server in the menu.</p>") + "</body>", baseURL: nil)
                self.barWeb.loadHTMLString("<meta name='color-scheme' content='light dark'><body style='font:14px -apple-system;margin:0;padding:18px;color:#e5383b;background:transparent'>" + L(
                    "\(APP_NAME) sunucusu başlamadı. Menüden “Sunucuyu Yeniden Başlat”ı dene.",
                    "\(APP_NAME)'s server didn't start. Try “Restart Server” in the menu.") + "</body>", baseURL: nil)
            }
        }
    }

    // MARK: Main menu (shown at the top of the screen while Handry is in front)

    func buildMainMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: APP_NAME)
        appMenu.addItem(item(L("\(APP_NAME) Hakkında", "About \(APP_NAME)"), #selector(showAbout)))
        if !LINKEDIN_URL.isEmpty { appMenu.addItem(item(L("purplefox'u LinkedIn'de Takip Et", "Follow purplefox on LinkedIn"), #selector(openLinkedIn))) }
        appMenu.addItem(.separator())
        appMenu.addItem(item(L("\(APP_NAME) Çubuğu   ⌥Space", "\(APP_NAME) Bar   ⌥Space"), #selector(toggleBar)))
        appMenu.addItem(item(L("Büyük Pencere", "\(APP_NAME) Window"), #selector(openWindow)))
        appMenu.addItem(wakeItem())
        appMenu.addItem(.separator())
        appMenu.addItem(item(L("İzinler…", "Permissions…"), #selector(checkPermissions)))
        appMenu.addItem(languageMenuItem())
        appMenu.addItem(item(L("Sunucuyu Yeniden Başlat", "Restart Server"), #selector(restartServer)))
        appMenu.addItem(item(L("Tarayıcıda Aç", "Open in Browser"), #selector(openInBrowser)))
        appMenu.addItem(.separator())
        appMenu.addItem(item(L("⛔ Acil Durdur   ⌥Esc", "⛔ Emergency Stop   ⌥Esc"), #selector(emergencyStop)))
        appMenu.addItem(.separator())
        appMenu.addItem(NSMenuItem(title: L("\(APP_ACC) Gizle", "Hide \(APP_NAME)"), action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"))
        appMenu.addItem(NSMenuItem(title: L("\(APP_ABL) Çık", "Quit \(APP_NAME)"), action: #selector(quit), keyEquivalent: "q"))
        appItem.submenu = appMenu
        main.addItem(appItem)

        let editItem = NSMenuItem()
        let edit = NSMenu(title: L("Düzen", "Edit"))
        edit.addItem(NSMenuItem(title: L("Geri Al", "Undo"), action: Selector(("undo:")), keyEquivalent: "z"))
        let redo = NSMenuItem(title: L("Yinele", "Redo"), action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(redo)
        edit.addItem(.separator())
        edit.addItem(NSMenuItem(title: L("Kes", "Cut"), action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
        edit.addItem(NSMenuItem(title: L("Kopyala", "Copy"), action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        edit.addItem(NSMenuItem(title: L("Yapıştır", "Paste"), action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
        edit.addItem(NSMenuItem(title: L("Tümünü Seç", "Select All"), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
        editItem.submenu = edit
        main.addItem(editItem)

        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: L("Pencere", "Window"))
        windowMenu.addItem(NSMenuItem(title: L("Küçült", "Minimize"), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"))
        windowMenu.addItem(NSMenuItem(title: L("Kapat", "Close"), action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"))
        windowItem.submenu = windowMenu
        main.addItem(windowItem)
        NSApp.mainMenu = main
        NSApp.windowsMenu = windowMenu
    }

    // MARK: Menu bar

    func buildMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let url = Bundle.main.url(forResource: "menubar", withExtension: "png"), let glyph = NSImage(contentsOf: url) {
            glyph.size = NSSize(width: 18, height: 18)
            glyph.isTemplate = true // macOS colours it for light and dark menu bars
            statusItem.button?.image = glyph
            statusItem.button?.imagePosition = .imageLeading
            statusItem.button?.title = ""
        } else {
            statusItem.button?.title = "✋"
        }
        statusItem.button?.toolTip = APP_NAME
        statusItem.button?.font = NSFont.monospacedDigitSystemFont(ofSize: NSFont.systemFontSize, weight: .regular)
        let menu = NSMenu()
        menu.delegate = self // the timers are put at the top each time it opens
        menu.addItem(item(L("\(APP_NAME) Çubuğu   ⌥Space", "\(APP_NAME) Bar   ⌥Space"), #selector(toggleBar)))
        menu.addItem(item(L("Büyük Pencere", "\(APP_NAME) Window"), #selector(openWindow)))
        menu.addItem(wakeItem())
        menu.addItem(item(L("Bas-Konuş   ⌥⇧Space (basılı tut)", "Push to Talk   ⌥⇧Space (hold)"), #selector(toggleBar)))
        menu.addItem(item(L("⛔ Acil Durdur   ⌥Esc", "⛔ Emergency Stop   ⌥Esc"), #selector(emergencyStop)))
        menu.addItem(.separator())
        menu.addItem(foxMenuItem())
        menu.addItem(islandMenuItem())
        menu.addItem(.separator())
        menu.addItem(item(L("Tarayıcıda Aç", "Open in Browser"), #selector(openInBrowser)))
        menu.addItem(item(L("İzinler…", "Permissions…"), #selector(checkPermissions)))
        menu.addItem(languageMenuItem())
        menu.addItem(item(L("Sunucuyu Yeniden Başlat", "Restart Server"), #selector(restartServer)))
        menu.addItem(.separator())
        if !LINKEDIN_URL.isEmpty { menu.addItem(item(L("purplefox'u LinkedIn'de Takip Et", "Follow purplefox on LinkedIn"), #selector(openLinkedIn))) }
        menu.addItem(item(L("\(APP_NAME) Hakkında", "About \(APP_NAME)"), #selector(showAbout)))
        menu.addItem(item(L("\(APP_ABL) Çık", "Quit \(APP_NAME)"), #selector(quit)))
        statusItem.menu = menu
    }

    func item(_ title: String, _ action: Selector) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: "")
        i.target = self
        return i
    }

    func wakeItem() -> NSMenuItem {
        let i = item(L("“\(WAKE_LABEL)” ile Dinle", "Listen for “\(WAKE_LABEL)”"), #selector(toggleWake))
        i.state = UserDefaults.standard.bool(forKey: "heyJev") ? .on : .off
        wakeItems.append(i)
        return i
    }

    // MARK: The pet on the screen (the hand or the fox)

    /// The pets: their sprites in the app (Resources/pets/<id>) or in the project, and their names in the menu.
    static let pets: [(id: String, name: String, acc: String, project: String)] = [
        ("hand", L("El", "Hand"), L("Eli", "Hand"), "app/hand/sprites"),
        ("fox", L("Tilki", "Fox"), L("Tilkiyi", "Fox"), "app/foxie/sprites")
    ]
    var pet: (id: String, name: String, acc: String, project: String) {
        let id = UserDefaults.standard.string(forKey: "pet") ?? "hand"
        return Self.pets.first { $0.id == id } ?? Self.pets[0]
    }
    var petMenuTitle: String { L("Ekrandaki \(pet.name)", "\(pet.name) on Screen") }
    var petToggleTitle: String {
        fox?.visible == false ? L("\(pet.acc) Göster", "Show \(pet.name)") : L("\(pet.acc) Gizle", "Hide \(pet.name)")
    }

    func makeFox() {
        let bundled = Bundle.main.resourceURL?.appendingPathComponent("pets/\(pet.id)")
        let fallback = URL(fileURLWithPath: "\(ROOT)/\(pet.project)")
        fox = FoxPet(spritesDir: bundled.flatMap { FileManager.default.fileExists(atPath: $0.path) ? $0 : nil } ?? fallback)
        fox?.menuProvider = { [weak self] in self?.foxMenuItem().submenu ?? NSMenu() }
    }

    /// "Ekrandaki El ▸": show or hide it, put it to sleep, its size, which one.
    func foxMenuItem() -> NSMenuItem {
        let root = NSMenuItem(title: petMenuTitle, action: nil, keyEquivalent: "")
        root.tag = 913
        let menu = NSMenu()
        menu.delegate = self
        let toggle = item(petToggleTitle, #selector(toggleFox))
        toggle.tag = 910
        menu.addItem(toggle)
        menu.addItem(item(L("Uyut", "Sleep"), #selector(foxSleep)))
        menu.addItem(.separator())
        for (title, value) in [(L("Küçük", "Small"), 0.5), (L("Orta", "Medium"), 1.0), (L("Büyük", "Large"), 1.5)] {
            let size = item(title, #selector(foxSize(_:)))
            size.representedObject = value
            size.tag = 911
            size.state = abs(Double(fox?.scale ?? 0) - value) < 0.01 ? .on : .off
            menu.addItem(size)
        }
        menu.addItem(.separator())
        for p in Self.pets {
            let choice = item(p.name, #selector(choosePet(_:)))
            choice.representedObject = p.id
            choice.tag = 912
            choice.state = p.id == pet.id ? .on : .off
            menu.addItem(choice)
        }
        root.submenu = menu
        return root
    }

    @objc func toggleFox() {
        guard let fox else { return }
        if fox.visible { fox.hide() } else { fox.show() }
    }

    @objc func foxSleep() { fox?.sleepNow() }

    /// The island at the notch that shows what Handry is doing: always there, only while it works, or never.
    /// Drawings stay either way.
    func islandMenuItem() -> NSMenuItem {
        let root = NSMenuItem(title: L("Çentikteki Ada", "Island at the Notch"), action: nil, keyEquivalent: "")
        let menu = NSMenu()
        menu.delegate = self
        let mode = overlay?.islandMode ?? "always"
        for (value, title) in [("always", L("Hep", "Always")), ("working", L("Sadece çalışırken", "Only while working")), ("never", L("Hiç", "Never"))] {
            let choice = item(title, #selector(chooseIsland(_:)))
            choice.representedObject = value
            choice.tag = 915
            choice.state = value == mode ? .on : .off
            menu.addItem(choice)
        }
        root.submenu = menu
        return root
    }

    @objc func chooseIsland(_ sender: NSMenuItem) {
        guard let value = sender.representedObject as? String else { return }
        overlay?.islandMode = value
    }

    /// The other pet: the old one leaves the screen, the new one comes out where the old one was.
    @objc func choosePet(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String, id != pet.id else { return }
        fox?.retire()
        UserDefaults.standard.set(id, forKey: "pet")
        UserDefaults.standard.set(false, forKey: "foxHidden")
        makeFox()
    }

    @objc func foxSize(_ sender: NSMenuItem) {
        guard let value = sender.representedObject as? Double else { return }
        fox?.scale = CGFloat(value)
    }

    /// ~/.jevis/activity.json: what the assistant is doing (written by the server and the Handry tools, also in other Claude sessions).
    func watchActivity() {
        Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in
            guard let self, let data = FileManager.default.contents(atPath: "\(HOME)/.jevis/activity.json"),
                  let entry = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let at = entry["at"] as? Double, at > self.activitySeen, let kind = entry["kind"] as? String else { return }
            let fresh = self.activitySeen > 0 && Date().timeIntervalSince1970 * 1000 - at < 10000
            self.activitySeen = at
            if fresh { self.fox?.react(kind: kind, app: entry["app"] as? String) }
        }
    }

    // MARK: Timers in the menu bar

    /// One waiting timer or watch from ~/.jevis/timers.json (Handry writes its wording into "label").
    struct TimerJob {
        let id: String, what: String, when: String, note: String
        let at: Double?, watch: Bool, firingEnd: Double?, chatId: String?
    }

    func readTimers() -> [TimerJob] {
        guard let data = FileManager.default.contents(atPath: "\(HOME)/.jevis/timers.json"),
              let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return list.compactMap { j in
            guard let id = j["id"] as? String else { return nil }
            let label = j["label"] as? [String: Any]
            let countdown = j["countdown"] as? Double ?? 0
            return TimerJob(id: id,
                            what: label?["what"] as? String ?? j["text"] as? String ?? L("Zamanlanmış iş", "Timer"),
                            when: label?["when"] as? String ?? "",
                            note: j["lastNote"] as? String ?? "",
                            at: j["at"] as? Double,
                            watch: j["until"] is [String: Any],
                            firingEnd: (j["firing"] as? Double).map { $0 + countdown * 1000 },
                            chatId: j["chatId"] as? String)
        }
    }

    /// "8:12" under an hour, "2 sa 14 dk" ("2 h 14 min") above.
    func timeLeft(_ ms: Double) -> String {
        let s = max(0, Int((ms / 1000).rounded()))
        return s >= 3600 ? L("\(s / 3600) sa \((s % 3600) / 60) dk", "\(s / 3600) h \((s % 3600) / 60) min") : String(format: "%d:%02d", s / 60, s % 60)
    }

    /// The hand in the menu bar widens to the left while something waits: the nearest time, how many there are, a shutdown countdown.
    func watchTimers() {
        Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self, Date() > self.flashUntil else { return }
            let jobs = self.readTimers()
            let now = Date().timeIntervalSince1970 * 1000
            let mark = self.statusItem.button?.image == nil ? "🦊" : ""
            var title = mark
            if let end = jobs.compactMap({ $0.firingEnd }).min() {
                title = "\(mark) ⏻ \(max(0, Int(((end - now) / 1000).rounded(.up)))) \(L("sn", "s"))"
            } else if let next = jobs.compactMap({ $0.at }).filter({ $0 > now - 60000 }).min() {
                title = "\(mark) ⏰ \(self.timeLeft(next - now))" + (jobs.count > 1 ? " · \(jobs.count)" : "")
            } else if !jobs.isEmpty {
                title = "\(mark) 👀 \(jobs.count)"
            }
            if self.statusItem.button?.title != title { self.statusItem.button?.title = title }
            self.statusItem.button?.toolTip = jobs.isEmpty ? APP_NAME : "\(APP_NAME) · \(jobs.count) \(L("zamanlanmış iş", "scheduled"))"
        }
    }

    /// Before the menu opens: the timers at the top, each with "Sohbeti Aç" / "İptal Et".
    func menuNeedsUpdate(_ menu: NSMenu) {
        for entry in menu.items where entry.tag == 910 { entry.title = petToggleTitle }
        for entry in menu.items where entry.tag == 912 { entry.state = entry.representedObject as? String == pet.id ? .on : .off }
        for entry in menu.items where entry.tag == 913 { entry.title = petMenuTitle }
        for entry in menu.items where entry.tag == 911 { entry.state = abs(Double(fox?.scale ?? 0) - (entry.representedObject as? Double ?? -1)) < 0.01 ? .on : .off }
        // the language can also have been changed in the window's Settings
        for entry in menu.items where entry.tag == 915 { entry.state = entry.representedObject as? String == overlay?.islandMode ? .on : .off }
        if menu.items.contains(where: { $0.tag == 914 }) {
            let setting = languageSetting()
            for entry in menu.items where entry.tag == 914 { entry.state = entry.representedObject as? String == setting ? .on : .off }
        }
        guard menu === statusItem.menu else { return }
        for old in menu.items where old.tag == 900 { menu.removeItem(old) }
        let jobs = readTimers()
        guard !jobs.isEmpty else { return }
        let now = Date().timeIntervalSince1970 * 1000
        var added: [NSMenuItem] = []
        let header = NSMenuItem(title: L("Zamanlayıcılar", "Scheduled"), action: nil, keyEquivalent: "")
        header.isEnabled = false
        added.append(header)
        for job in jobs {
            let icon = job.firingEnd != nil ? "⏻" : job.watch && job.at == nil ? "👀" : "⏰"
            let row = NSMenuItem(title: "\(icon) \(job.what)", action: nil, keyEquivalent: "")
            if let end = job.firingEnd {
                row.subtitle = L("\(timeLeft(end - now)) sonra", "in \(timeLeft(end - now))")
            } else if let at = job.at, !job.watch {
                row.subtitle = L("\(job.when) · \(timeLeft(at - now)) kaldı", "\(job.when) · \(timeLeft(at - now)) left")
            } else {
                row.subtitle = job.note.isEmpty ? job.when : "\(job.when) · \(job.note)"
            }
            let sub = NSMenu()
            if let chat = job.chatId {
                let open = item(L("Kurulduğu Sohbeti Aç", "Open Its Chat"), #selector(openTimerChat(_:)))
                open.representedObject = chat
                sub.addItem(open)
            }
            let cancel = item(L("İptal Et", "Cancel"), #selector(cancelTimerItem(_:)))
            cancel.representedObject = job.id
            sub.addItem(cancel)
            row.submenu = sub
            added.append(row)
        }
        if jobs.count > 1 {
            let all = item(L("Hepsini İptal Et", "Cancel All"), #selector(cancelTimerItem(_:)))
            all.representedObject = "all"
            added.append(all)
        }
        added.append(.separator())
        for (i, entry) in added.enumerated() {
            entry.tag = 900
            menu.insertItem(entry, at: i)
        }
    }

    /// Ids are Handry's own ("t…", "c…"); anything else is not passed to a page.
    func safeId(_ id: String) -> Bool {
        !id.isEmpty && id.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }
    }

    @objc func cancelTimerItem(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String, safeId(id) else { return }
        barWeb.evaluateJavaScript("cancelTimer('\(id)').then(() => refreshTimers())")
    }

    @objc func openTimerChat(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String, safeId(id) else { return }
        showWindow()
        webView.evaluateJavaScript("openChatById('\(id)')")
    }

    // MARK: Big window

    /// The chat window: frosted glass (the desktop shows through, blurred) with the page on it. The title bar
    /// is see-through too; the page starts under it, so that strip stays the window's handle.
    func buildWindow() {
        let config = WKWebViewConfiguration()
        // the page's own background goes, so the glass shows (style.css: html.native)
        config.userContentController.addUserScript(WKUserScript(source: "document.documentElement.classList.add('native')", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let frame = NSRect(x: 0, y: 0, width: 920, height: 760)
        let titleBar: CGFloat = 28
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: frame.width, height: frame.height - titleBar), configuration: config)
        webView.setValue(false, forKey: "drawsBackground")
        webView.autoresizingMask = [.width, .height]
        webView.uiDelegate = self
        let glass = NSVisualEffectView(frame: frame)
        glass.material = .sidebar
        glass.blendingMode = .behindWindow
        glass.state = .followsWindowActiveState
        glass.addSubview(webView)
        window = NSWindow(contentRect: frame,
                          styleMask: [.titled, .closable, .resizable, .miniaturizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.title = APP_NAME
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.contentView = glass
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
        alert.addButton(withTitle: L("Tamam", "OK"))
        alert.addButton(withTitle: L("Vazgeç", "Cancel"))
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
        barWeb = WKWebView(frame: NSRect(x: 0, y: 0, width: BAR_WIDTH, height: BAR_HEIGHT), configuration: config)
        barWeb.setValue(false, forKey: "drawsBackground")
        barWeb.uiDelegate = self
        island = IslandView(page: barWeb)
        bar = BarPanel(contentRect: island.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        bar.contentView = island
        bar.isOpaque = false
        bar.backgroundColor = .clear
        bar.hasShadow = true
        // over the menu bar, which it hangs across
        bar.level = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 1)
        bar.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        bar.hidesOnDeactivate = false
        bar.isReleasedWhenClosed = false
        bar.isMovable = false
        bar.delegate = self
    }

    /// Where the bar is, open or closed into the notch, on the screen it was opened on: hanging from the
    /// top edge, under the notch's middle (the middle of the screen when there is no notch).
    func barFrame(open: Bool) -> NSRect {
        let screen = barScreen ?? NSScreen.main ?? NSScreen.screens[0]
        let notch = notchOf(screen)
        let width = open ? BAR_WIDTH + 2 * BAR_EAR : max(notch.width, 120) + 2 * BAR_EAR
        let height = open ? island.top + island.pageHeight : max(notch.height, 1)
        return NSRect(x: screen.frame.minX + notch.mid - width / 2, y: screen.frame.maxY - height, width: width, height: height)
    }

    /// The screen the mouse is on; the bar comes out of its notch.
    func pickBarScreen() {
        let mouse = NSEvent.mouseLocation
        barScreen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main ?? NSScreen.screens[0]
        island.top = barScreen.map { notchOf($0).height } ?? 0
    }

    /// Grows the bar out of the notch (or just puts it in front when it is already out).
    func openBar() {
        if bar.isVisible && !barClosing { return }
        if !bar.isVisible {
            pickBarScreen()
            bar.setFrame(barFrame(open: false), display: false)
            barWeb.alphaValue = 0
        }
        barClosing = false
        overlay?.barOpen = true
        bar.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.34
            ctx.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.25, 1)
            bar.animator().setFrame(barFrame(open: true), display: true)
            barWeb.animator().alphaValue = 1
        }, completionHandler: { [weak self] in
            self?.bar.invalidateShadow()
            self?.writeBarState()
        })
    }

    func showBar(mode: String) {
        openBar()
        bar.makeKey()
        bar.makeFirstResponder(barWeb)
        barWeb.evaluateJavaScript("window.jevisBar && window.jevisBar.show('\(mode)')")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in self?.writeBarState() }
    }

    /// ~/.jevis/bar.json: whether the bar is up and takes the keyboard (tests read it).
    func writeBarState() {
        let state: [String: Any] = ["visible": bar.isVisible && !barClosing, "key": bar.isKeyWindow, "appActive": NSApp.isActive, "busy": barBusy, "at": Date().timeIntervalSince1970]
        if let data = try? JSONSerialization.data(withJSONObject: state) {
            try? data.write(to: URL(fileURLWithPath: "\(HOME)/.jevis/bar.json"))
        }
    }

    /// Shrinks the bar back into the notch, then takes it away.
    func hideBar() {
        guard bar.isVisible, !barClosing else { return }
        barClosing = true
        barClosingAt = Date()
        barWeb.evaluateJavaScript("window.jevisBar && window.jevisBar.hidden()")
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.24
            ctx.timingFunction = CAMediaTimingFunction(controlPoints: 0.4, 0, 0.8, 0.6)
            bar.animator().setFrame(barFrame(open: false), display: true)
            barWeb.animator().alphaValue = 0
        }, completionHandler: { [weak self] in
            guard let self, self.barClosing else { return }
            self.barClosing = false
            self.overlay?.barOpen = false
            self.bar.orderOut(nil)
            self.writeBarState()
        })
    }

    @objc func toggleBar() {
        if bar.isVisible && !barClosing { hideBar() } else { showBar(mode: "type") }
    }


    /// A click on the notch opens the bar, or closes it. The click itself first takes the keyboard from the
    /// bar, which starts closing it; a bar that began closing just now was open when the click came.
    func notchClicked() {
        if bar.isVisible && (!barClosing || Date().timeIntervalSince(barClosingAt) < 0.3) { hideBar() } else { showBar(mode: "type") }
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
            island.pageHeight = min(CGFloat(h), 520)
            guard bar.isVisible, !barClosing else { return }
            NSAnimationContext.runAnimationGroup({ ctx in
                ctx.duration = 0.2
                ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
                bar.animator().setFrame(barFrame(open: true), display: true)
            }, completionHandler: { [weak self] in self?.bar.invalidateShadow() })
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

    // MARK: Attention (Handry needs the user: a login, a 2FA code…)

    var attentionId = ""
    var attentionHide: DispatchWorkItem?

    /// Tools write ~/.jevis/attention.json when they need the user; the bar
    /// shows it without taking the keyboard (the user may be typing a password).
    func watchAttention() {
        Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self, let data = FileManager.default.contents(atPath: "\(HOME)/.jevis/attention.json"),
                  let entry = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let id = entry["id"] as? String else { return }
            let resolved = entry["resolved"] as? Bool ?? false
            if id != self.attentionId, !resolved, let at = entry["at"] as? Double, Date().timeIntervalSince1970 * 1000 - at < 15000 {
                self.attentionId = id
                self.showBarPassive()
                self.sendAttention(["type": "show", "title": entry["title"] ?? APP_NAME, "message": entry["message"] ?? ""])
            } else if id == self.attentionId, resolved {
                self.attentionId = ""
                self.sendAttention(["type": "resolved"])
                self.hideBarLater(2.5)
            }
        }
    }

    func showBarPassive() {
        openBar()
        hideBarLater(30)
    }

    func hideBarLater(_ seconds: Double) {
        attentionHide?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, !self.barBusy, !self.bar.isKeyWindow, !self.listener.isActive else { return }
            self.hideBar()
        }
        attentionHide = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    func sendAttention(_ event: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: event), let json = String(data: data, encoding: .utf8) else { return }
        barWeb.evaluateJavaScript("window.jevisBar && window.jevisBar.attention(\(json))")
    }

    // MARK: Voice

    func setUpListener() {
        listener.onWake = { [weak self] in
            NSSound(named: "Tink")?.play()
            self?.showBar(mode: "voice")
        }
        listener.onStart = { [weak self] in
            // a small tap on the trackpad (felt only with a finger on it)
            NSHapticFeedbackManager.defaultPerformer.perform(.levelChange, performanceTime: .now)
            self?.sendVoice(["type": "start"])
        }
        listener.onLevel = { [weak self] v in
            self?.barWeb.evaluateJavaScript("window.jevisBar && window.jevisBar.level(\(v))")
        }
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
        switch event["type"] as? String {
        case "start": fox?.setListening(true)
        case "final", "cancel", "error": fox?.setListening(false)
        default: break
        }
        guard let data = try? JSONSerialization.data(withJSONObject: event), let json = String(data: data, encoding: .utf8) else { return }
        barWeb.evaluateJavaScript("window.jevisBar && window.jevisBar.voice(\(json))")
    }

    func startListening(pushToTalk: Bool) {
        Listener.requestPermissions { [weak self] mic, _ in
            guard let self else { return }
            guard mic else {
                self.showBar(mode: "voice")
                self.sendVoice(["type": "error", "message": L("Mikrofon izni yok: Sistem Ayarları › Gizlilik ve Güvenlik › Mikrofon'da \(APP_ACC) aç.",
                                                              "No microphone permission: turn on \(APP_NAME) in System Settings › Privacy & Security › Microphone.")])
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
            // "Hey Handry" is found by the speech recognizer: it needs both permissions.
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
        statusItem.button?.title = " ⛔"
        flashUntil = Date().addingTimeInterval(3)
    }

    @objc func openInBrowser() {
        NSWorkspace.shared.open(URL(string: URL_BASE)!)
    }

    @objc func checkPermissions() { permissions.show() }

    /// The About window: the name, who made it (Berat Olekli, purplefox) and where it lives; the copyright line
    /// comes from Info.plist.
    @objc func showAbout() {
        let center = NSMutableParagraphStyle()
        center.alignment = .center
        let credits = NSMutableAttributedString(string: "\(L("Yapan", "Made by")) \(CREDIT)\n", attributes: [.font: NSFont.systemFont(ofSize: 11, weight: .medium), .foregroundColor: NSColor.labelColor, .paragraphStyle: center])
        credits.append(NSAttributedString(string: AUTHOR_URL.replacingOccurrences(of: "https://", with: ""), attributes: [.font: NSFont.systemFont(ofSize: 11), .link: URL(string: AUTHOR_URL) as Any, .paragraphStyle: center]))
        // Liked it? A star, a share that tags the author, a follow.
        let quiet: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 11), .foregroundColor: NSColor.secondaryLabelColor, .paragraphStyle: center]
        credits.append(NSAttributedString(string: "\n\n" + L("Beğendiysen: ", "Like it? "), attributes: quiet))
        credits.append(NSAttributedString(string: L("GitHub'da ⭐ ver", "⭐ it on GitHub"), attributes: [.font: NSFont.systemFont(ofSize: 11), .link: URL(string: REPO_URL) as Any, .paragraphStyle: center]))
        if !LINKEDIN_URL.isEmpty {
            credits.append(NSAttributedString(string: " · ", attributes: quiet))
            credits.append(NSAttributedString(string: L("LinkedIn'de takip et", "follow me on LinkedIn"), attributes: [.font: NSFont.systemFont(ofSize: 11), .link: URL(string: LINKEDIN_URL) as Any, .paragraphStyle: center]))
        }
        credits.append(NSAttributedString(string: L("\npaylaşırken @purplefox'u etiketle 💜", "\nand tag @purplefox when you share it 💜"), attributes: quiet))
        NSApp.activate(ignoringOtherApps: true)
        NSApp.orderFrontStandardAboutPanel(options: [.applicationName: APP_NAME, .credits: credits])
    }

    @objc func openLinkedIn() {
        if let url = URL(string: LINKEDIN_URL) { NSWorkspace.shared.open(url) }
    }

    /// A link that wants a new window (the credit in Settings) opens in the default browser.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, ["http", "https"].contains(url.scheme) { NSWorkspace.shared.open(url) }
        return nil
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

    // MARK: Language (the same setting as core/i18n.js)

    /// "Dil / Language ▸": Türkçe, English, or the Mac's own language; the check is on the current setting.
    func languageMenuItem() -> NSMenuItem {
        let root = NSMenuItem(title: "Dil / Language", action: nil, keyEquivalent: "")
        let menu = NSMenu()
        menu.delegate = self
        let setting = languageSetting()
        for (value, title) in [("tr", "Türkçe"), ("en", "English"), ("auto", L("Mac'in dili", "Same as the Mac"))] {
            let choice = item(title, #selector(chooseLanguage(_:)))
            choice.representedObject = value
            choice.tag = 914
            choice.state = value == setting ? .on : .off
            menu.addItem(choice)
        }
        root.submenu = menu
        return root
    }

    /// Saves the choice as "language" in ~/.jevis/config.json, keeping everything else there (the server
    /// reads it from there too). A file that isn't JSON is left alone rather than written over.
    @objc func chooseLanguage(_ sender: NSMenuItem) {
        guard let value = sender.representedObject as? String else { return }
        let dir = "\(HOME)/.jevis", file = "\(dir)/config.json"
        var json: [String: Any] = [:]
        if let data = FileManager.default.contents(atPath: file), !data.isEmpty {
            guard let saved = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                let alert = NSAlert()
                alert.messageText = L("Dil kaydedilemedi", "Couldn't save the language")
                alert.informativeText = L("~/.jevis/config.json okunamadı (geçerli JSON değil).", "~/.jevis/config.json couldn't be read (it isn't valid JSON).")
                alert.runModal()
                return
            }
            json = saved
        }
        json["language"] = value
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        guard let out = try? JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]) else { return }
        try? (out + Data("\n".utf8)).write(to: URL(fileURLWithPath: file))
        for entry in sender.menu?.items ?? [] { entry.state = entry === sender ? .on : .off }
        if currentLanguage() != LANG { relaunch() }
    }

    /// Every second: when the setting now gives another language than the one the app started in (this
    /// menu, or the window's Settings through the server), the app opens itself again in it.
    func watchLanguage() {
        Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self, !self.relaunching, currentLanguage() != LANG else { return }
            self.relaunch()
        }
    }

    /// A shell outside the app waits until this app and its server have quit, then opens the app again
    /// (which starts the server again; one started by `npm start` is not ours and keeps running). The new
    /// app starts in the language the setting gives, so it has no reason to relaunch; still, at most once
    /// in 10 s, so nothing can make it spin.
    func relaunch() {
        let now = Date().timeIntervalSince1970
        guard !relaunching, now - UserDefaults.standard.double(forKey: "relaunchedAt") > 10 else { return }
        relaunching = true
        UserDefaults.standard.set(now, forKey: "relaunchedAt")
        let pids = ([ProcessInfo.processInfo.processIdentifier] + [server?.processIdentifier].compactMap { $0 }).map { String($0) }.joined(separator: " ")
        let bundle = Bundle.main.bundlePath.replacingOccurrences(of: "'", with: "'\\''")
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        p.arguments = ["-c", "sleep 1; for pid in \(pids); do i=0; while kill -0 $pid 2>/dev/null && [ $i -lt 50 ]; do sleep 0.2; i=$((i+1)); done; done; open '\(bundle)'"]
        p.standardInput = FileHandle.nullDevice
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return } // no shell: stays as it is, in the old language
        quit()
    }

    // MARK: Server

    /// Our own server answers /api/ping with {"jevis": true}; anything else on the port (another dev server) does not count.
    func serverUp(_ done: @escaping (Bool) -> Void) {
        var req = URLRequest(url: URL(string: "\(URL_BASE)api/ping")!)
        req.timeoutInterval = 1
        URLSession.shared.dataTask(with: req) { data, res, _ in
            guard (res as? HTTPURLResponse)?.statusCode == 200, let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return done(false) }
            done(json["jevis"] as? Bool == true)
        }.resume()
    }

    /// Reuses a server that is already running (e.g. `npm start`), otherwise starts one.
    func startServer(_ completion: @escaping (Bool) -> Void) {
        serverUp { [weak self] up in
            DispatchQueue.main.async {
                guard let self else { return }
                if up { return completion(true) }
                let logDir = "\(HOME)/.jevis/logs"
                try? FileManager.default.createDirectory(atPath: logDir, withIntermediateDirectories: true)
                FileManager.default.createFile(atPath: "\(logDir)/app-server.log", contents: nil)
                let log = FileHandle(forWritingAtPath: "\(logDir)/app-server.log")
                // The node the app was built with can be gone (Homebrew deletes the old versioned folder on an upgrade):
                // look for another one, and say in the log what happened instead of leaving it empty.
                guard let node = findNode() else {
                    log?.write(Data(L("node bulunamadı. Aranan yerler: \(NODE), \(NODE_FALLBACKS.joined(separator: ", ")). Node kurulu mu? (brew install node), sonra uygulamayı yeniden kur: node cli.js app install\n",
                                      "node not found. Looked in: \(NODE), \(NODE_FALLBACKS.joined(separator: ", ")). Is Node installed? (brew install node), then install the app again: node cli.js app install\n").utf8))
                    return completion(false)
                }
                let p = Process()
                p.executableURL = URL(fileURLWithPath: node)
                p.arguments = ["\(ROOT)/app/server.js"]
                p.currentDirectoryURL = URL(fileURLWithPath: ROOT)
                var e = ProcessInfo.processInfo.environment
                e["PORT"] = PORT
                e["PATH"] = "/opt/homebrew/bin:/usr/local/bin:\(HOME)/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
                p.environment = e
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
                do { try p.run() } catch {
                    log?.write(Data(L("Sunucu başlatılamadı (\(node), klasör \(ROOT)): \(error.localizedDescription)\n",
                                      "Couldn't start the server (\(node), folder \(ROOT)): \(error.localizedDescription)\n").utf8))
                    return completion(false)
                }
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
        // Handry --test-listener in.wav --out out.json [--active]: runs a recording
        // through the listener (uses Handry's own speech permission), then quits.
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
