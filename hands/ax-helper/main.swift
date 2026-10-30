// jevis-ax: Handry desktop helper. Reads an app's accessibility tree and
// presses, types, clicks, scrolls and sends key combos. Prints one JSON object.
//
//   jevis-ax trusted [--prompt]
//   jevis-ax apps | frontmost [--app NAME|--pid N]
//   jevis-ax tree [--app NAME|--pid N] [--menus] [--max 400] [--budget 2.5]
//   jevis-ax press <path> [--expect TEXT] [--app|--pid]
//   jevis-ax setvalue <path> <text> [--app|--pid]
//   jevis-ax focus <path> [--app|--pid]
//   jevis-ax type <text> | key <combo> | click <x> <y> [--right] [--double] | scroll <dy> [dx]
//   jevis-ax glide <x> <y> [--trace] | cursor
//   jevis-ax activate [--app|--pid]
//   jevis-ax windows [--app|--pid] | raise <index> [--app|--pid] | screen | hit <x> <y>
//   jevis-ax automation <bundleId>
//
// Paths: "w.3.1" = child 3, then child 1 of the focused window; "m.2.0" = menu bar.
import Cocoa
import ApplicationServices
import AVFoundation

// MARK: - Output and arguments

func emit(_ obj: Any) {
    let data = (try? JSONSerialization.data(withJSONObject: obj, options: [])) ?? Data("{}".utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

func fail(_ message: String, code: String = "ERROR") -> Never {
    emit(["error": message, "code": code])
    exit(1)
}

var args = Array(CommandLine.arguments.dropFirst())

func option(_ name: String) -> String? {
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    let value = args[i + 1]
    args.removeSubrange(i...(i + 1))
    return value
}

func flag(_ name: String) -> Bool {
    guard let i = args.firstIndex(of: name) else { return false }
    args.remove(at: i)
    return true
}

// MARK: - Apps and elements

func targetApp(pid: String?, name: String?) -> NSRunningApplication {
    if let pid, let n = pid_t(pid), let app = NSRunningApplication(processIdentifier: n) { return app }
    if let name {
        let wanted = name.lowercased()
        let apps = NSWorkspace.shared.runningApplications
        if let app = apps.first(where: { $0.localizedName?.lowercased() == wanted || $0.bundleIdentifier?.lowercased() == wanted }) { return app }
        // "calculator" also finds "Hesap Makinesi" (com.apple.calculator) on a Turkish Mac.
        if let app = apps.first(where: { $0.bundleIdentifier?.lowercased().split(separator: ".").last.map(String.init) == wanted }) { return app }
        if let app = apps.first(where: { $0.activationPolicy == .regular && (($0.localizedName?.lowercased().contains(wanted) ?? false) || ($0.bundleIdentifier?.lowercased().contains(wanted) ?? false)) }) { return app }
        fail("Uygulama çalışmıyor: \(name)", code: "NO_APP")
    }
    guard let app = NSWorkspace.shared.frontmostApplication else { fail("Önde bir uygulama yok", code: "NO_APP") }
    return app
}

func attribute(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var value: AnyObject?
    return AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success ? value : nil
}

let ATTRS = ["AXRole", "AXSubrole", "AXTitle", "AXDescription", "AXValue", "AXHelp", "AXIdentifier",
             "AXEnabled", "AXFocused", "AXPosition", "AXSize", "AXChildren", "AXSelected", "AXPlaceholderValue"]

/// All interesting attributes of an element in one IPC round trip.
func fetch(_ el: AXUIElement) -> [String: Any] {
    var raw: CFArray?
    guard AXUIElementCopyMultipleAttributeValues(el, ATTRS as CFArray, AXCopyMultipleAttributeOptions(rawValue: 0), &raw) == .success,
          let values = raw as? [AnyObject] else { return [:] }
    var out: [String: Any] = [:]
    for (i, v) in values.enumerated() where i < ATTRS.count {
        if CFGetTypeID(v) == AXValueGetTypeID() {
            let axValue = v as! AXValue
            switch AXValueGetType(axValue) {
            case .cgPoint:
                var p = CGPoint.zero
                AXValueGetValue(axValue, .cgPoint, &p)
                out[ATTRS[i]] = p
            case .cgSize:
                var s = CGSize.zero
                AXValueGetValue(axValue, .cgSize, &s)
                out[ATTRS[i]] = s
            default:
                continue // .axError: the element has no such attribute
            }
        } else {
            out[ATTRS[i]] = v
        }
    }
    return out
}

func text(_ v: Any?) -> String? {
    if let s = v as? String { let t = s.trimmingCharacters(in: .whitespacesAndNewlines); return t.isEmpty ? nil : t }
    if let a = v as? NSAttributedString { return text(a.string) }
    return nil
}

func cut(_ s: String, _ n: Int) -> String { s.count > n ? String(s.prefix(n - 1)) + "…" : s }

func focusedWindow(_ appEl: AXUIElement) -> AXUIElement? {
    if let w = attribute(appEl, "AXFocusedWindow") { return (w as! AXUIElement) }
    if let w = attribute(appEl, "AXMainWindow") { return (w as! AXUIElement) }
    if let ws = attribute(appEl, "AXWindows") as? [AXUIElement], let first = ws.first { return first }
    return nil
}

func root(_ kind: Substring, _ appEl: AXUIElement) -> AXUIElement? {
    kind == "m" ? (attribute(appEl, "AXMenuBar").map { $0 as! AXUIElement }) : focusedWindow(appEl)
}

func frameworks(_ app: NSRunningApplication) -> [String] {
    guard let url = app.bundleURL?.appendingPathComponent("Contents/Frameworks") else { return [] }
    return (try? FileManager.default.contentsOfDirectory(atPath: url.path)) ?? []
}

/// Apps whose windows are Chromium web views (Electron, CEF, Chrome itself).
func isChromium(_ app: NSRunningApplication) -> Bool {
    frameworks(app).contains { $0.contains("Electron") || $0.contains("Chromium") || $0.hasSuffix(" Framework.framework") && ($0.contains("Chrome") || $0.contains("Edge") || $0.contains("Brave")) }
}

func isElectron(_ app: NSRunningApplication) -> Bool {
    frameworks(app).contains { $0.hasPrefix("Electron Framework") }
}

/// Electron apps (VS Code, Slack, Discord) build their accessibility tree
/// only when asked to. The switch stays on for the app's lifetime: switched
/// off, the tree takes seconds to come back. (VS Code would then show
/// "Screen Reader Optimized" unless editor.accessibilitySupport is "off";
/// `node cli.js doctor` checks that.)
func openAccess(_ app: NSRunningApplication) {
    AXUIElementSetAttributeValue(AXUIElementCreateApplication(app.processIdentifier), "AXManualAccessibility" as CFString, kCFBooleanTrue)
}

func resolve(_ path: String, _ app: NSRunningApplication) -> AXUIElement {
    openAccess(app)
    let appEl = AXUIElementCreateApplication(app.processIdentifier)
    // A freshly switched-on Electron tree takes a moment to fill in.
    for attempt in 0..<4 {
        var parts = path.split(separator: ".")
        if !parts.isEmpty, var el = root(parts.removeFirst(), appEl) {
            var found = true
            for part in parts {
                guard let i = Int(part), let kids = attribute(el, "AXChildren") as? [AXUIElement], i < kids.count else { found = false; break }
                el = kids[i]
            }
            if found { return el }
        }
        if attempt < 3 && isChromium(app) { usleep(300_000) } else { break }
    }
    fail("Öğe artık yok (\(path)). Pencereyi yeniden oku.", code: "STALE")
}

// MARK: - Reading the tree

let ACTIONABLE: Set<String> = ["AXButton", "AXCheckBox", "AXRadioButton", "AXPopUpButton", "AXMenuButton", "AXTextField",
                               "AXTextArea", "AXComboBox", "AXSlider", "AXLink", "AXMenuItem",
                               "AXDisclosureTriangle", "AXIncrementor", "AXCell", "AXRow", "AXTab", "AXSegmentedControl",
                               "AXColorWell", "AXSwitch", "AXToggle", "AXDockItem"]


func readTree(app: NSRunningApplication, menus: Bool, maxItems: Int, budget: Double) -> [String: Any] {
    let appEl = AXUIElementCreateApplication(app.processIdentifier)
    openAccess(app)
    let chromium = isChromium(app)
    let electron = isElectron(app)
    let deadline = Date().addingTimeInterval(budget + 3)
    var items: [[String: Any]] = []
    // The same control drawn twice at the same spot (virtualized lists) is listed once.
    var seen = Set<String>()
    var texts: [String] = []
    var visited = 0
    var truncated = false

    // Returns the role and label of the node so the caller can use static
    // texts as context for the controls that follow them.
    @discardableResult
    func walk(_ el: AXUIElement, _ path: String, _ depth: Int, _ context: String) -> (String, String?) {
        if items.count >= maxItems || visited >= 6000 || depth > 45 || Date() > deadline { truncated = true; return ("", nil) }
        visited += 1
        let a = fetch(el)
        let role = a["AXRole"] as? String ?? ""
        let title = text(a["AXTitle"])
        let desc = text(a["AXDescription"])
        let label = title ?? desc ?? text(a["AXPlaceholderValue"]) ?? text(a["AXHelp"])
        if (role == "AXStaticText" || role == "AXHeading"), texts.count < 150, let size = a["AXSize"] as? CGSize, size.width > 1,
           let t = text(a["AXValue"]) ?? label, texts.last != t {
            texts.append(cut(t, 160))
        }
        // Menu bar titles are left out on purpose: pressing one opens a menu and
        // blocks the app; menu items can be pressed directly without opening it.
        let disabledMenuItem = role == "AXMenuItem" && (a["AXEnabled"] as? Bool) == false
        let isMenuItem = role == "AXMenuItem" && label != nil && !disabledMenuItem
        let sized = (a["AXSize"] as? CGSize).map { $0.width > 1 && $0.height > 1 } ?? false
        // Web views wrap everything in nameless cells and rows; their contents carry the names.
        let namelessWebCell = chromium && (role == "AXCell" || role == "AXRow") && label == nil && text(a["AXValue"]) == nil
        let pos = a["AXPosition"] as? CGPoint ?? .zero
        let size = a["AXSize"] as? CGSize ?? .zero
        let key = "\(role)|\(label ?? "")|\(Int(pos.x)),\(Int(pos.y)),\(Int(size.width)),\(Int(size.height))"
        if ACTIONABLE.contains(role), !disabledMenuItem, !namelessWebCell, (sized || isMenuItem), !(sized && seen.contains(key)) {
            if sized { seen.insert(key) }
            var item: [String: Any] = ["path": path, "role": String(role.dropFirst(2)), "x": Int(pos.x), "y": Int(pos.y), "w": Int(size.width), "h": Int(size.height)]
            if let label { item["name"] = cut(label, 80) }
            if let sub = a["AXSubrole"] as? String { item["subrole"] = String(sub.dropFirst(2)) }
            if let v = text(a["AXValue"]) { item["value"] = cut(v, 80) } else if let n = a["AXValue"] as? NSNumber { item["value"] = n }
            if let e = a["AXEnabled"] as? Bool, !e { item["disabled"] = true }
            if let f = a["AXFocused"] as? Bool, f { item["focused"] = true }
            if let s = a["AXSelected"] as? Bool, s { item["selected"] = true }
            if !context.isEmpty && context != label { item["ctx"] = cut(context, 60) }
            items.append(item)
        }
        guard let children = a["AXChildren"] as? [AXUIElement] else { return (role, label ?? text(a["AXValue"])) }
        var lastText = ""
        // Menus carry their path ("Dosya > Son Kullanılanlar"); groups their own title.
        var inherited = context
        if role == "AXMenuBarItem" || role == "AXMenuItem", let t = title {
            inherited = context.isEmpty ? t : "\(context) > \(t)"
        } else if ["AXGroup", "AXScrollArea", "AXSheet", "AXTabGroup"].contains(role), let t = title ?? desc {
            inherited = t
        }
        for (i, child) in children.enumerated() {
            let ctx = !lastText.isEmpty ? lastText : inherited
            let (childRole, childText) = walk(child, "\(path).\(i)", depth + 1, ctx)
            // Only a label right before a control describes it.
            lastText = childRole == "AXStaticText" ? (childText ?? "") : ""
        }
        return (role, label ?? text(a["AXValue"]))
    }

    var windowTitle = ""
    var enhanced = false
    let window = focusedWindow(appEl)
    if let window {
        windowTitle = text(attribute(window, "AXTitle")) ?? ""
        walk(window, "w", 0, "")
        // Chromium-based apps (Spotify, Slack, Discord…) only expose their
        // controls after AXEnhancedUserInterface is switched on; the tree then
        // builds up over a moment.
        // Electron fills its tree in after AXManualAccessibility alone.
        for _ in 0..<(electron ? 6 : 4) where chromium && items.filter({ $0["name"] != nil }).count < 6 {
            if !electron {
                AXUIElementSetAttributeValue(appEl, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
                enhanced = true
            }
            usleep(electron ? 500_000 : 700_000)
            items.removeAll(); texts.removeAll(); seen.removeAll(); visited = 0; truncated = false
            walk(window, "w", 0, "")
        }
    }
    if menus, let bar = attribute(appEl, "AXMenuBar") {
        walk(bar as! AXUIElement, "m", 0, "")
    }
    let windowCount = (attribute(appEl, "AXWindows") as? [AXUIElement])?.count ?? 0
    return ["app": app.localizedName ?? "", "pid": app.processIdentifier, "bundleId": app.bundleIdentifier ?? "",
            "window": windowTitle, "windows": windowCount, "enhanced": enhanced,
            "elements": items, "texts": texts, "visited": visited, "truncated": truncated]
}

// MARK: - Input events

let KEYCODES: [String: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14,
    "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27,
    "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "return": 36, "enter": 36, "l": 37, "j": 38,
    "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "tab": 48, "space": 49, "`": 50,
    "delete": 51, "backspace": 51, "escape": 53, "esc": 53, "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97,
    "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111, "home": 115, "pageup": 116, "forwarddelete": 117,
    "end": 119, "pagedown": 121, "left": 123, "right": 124, "down": 125, "up": 126
]

func sendKey(_ combo: String) {
    var flags: CGEventFlags = []
    var key: CGKeyCode?
    for part in combo.lowercased().split(separator: "+").map({ $0.trimmingCharacters(in: .whitespaces) }) {
        switch part {
        case "cmd", "command", "meta": flags.insert(.maskCommand)
        case "shift": flags.insert(.maskShift)
        case "alt", "option", "opt": flags.insert(.maskAlternate)
        case "ctrl", "control": flags.insert(.maskControl)
        case "fn": flags.insert(.maskSecondaryFn)
        default:
            guard let code = KEYCODES[part] else { fail("Bilinmeyen tuş: \(part)", code: "BAD_KEY") }
            key = code
        }
    }
    guard let key else { fail("Tuş verilmedi: \(combo)", code: "BAD_KEY") }
    let src = CGEventSource(stateID: .hidSystemState)
    for down in [true, false] {
        let e = CGEvent(keyboardEventSource: src, virtualKey: key, keyDown: down)!
        e.flags = flags
        e.post(tap: .cghidEventTap)
        usleep(12000)
    }
}

// MARK: - Human pace
// The pointer glides along a curve instead of appearing on its target, a click
// is held for a moment, and short text is typed key by key with uneven gaps.
// Sites and apps that ask "is this a person?" see real movement and keystrokes.
// Off unless JEVIS_HUMAN=1 (the Node side sets it from human_mode); it is slower.
let humanPace = ProcessInfo.processInfo.environment["JEVIS_HUMAN"] == "1"

func randomIn(_ a: Double, _ b: Double) -> Double { Double.random(in: a...b) }
func gaussian() -> Double { sqrt(-2 * log(1 - Double.random(in: 0..<1))) * cos(2 * Double.pi * Double.random(in: 0..<1)) }
func cursorPosition() -> CGPoint { CGEvent(source: nil)?.location ?? .zero }

func pointerMoved(_ q: CGPoint) {
    CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: q, mouseButton: .left)?.post(tap: .cghidEventTap)
}

/// Moves the real pointer to p along a curve: slow start, fast middle, slow landing.
func glide(to p: CGPoint) {
    let a = cursorPosition()
    let dx = Double(p.x - a.x), dy = Double(p.y - a.y), dist = hypot(dx, dy)
    guard humanPace, dist >= 3 else { pointerMoved(p); return }
    let duration = min(1.4, max(0.18, (0.2 + 0.14 * log2(dist / 40 + 1)) * randomIn(0.85, 1.25)))
    let nx = -dy / dist, ny = dx / dist
    let bow = dist * randomIn(0.04, 0.12) * (Bool.random() ? 1 : -1)
    let ax = Double(a.x), ay = Double(a.y), px = Double(p.x), py = Double(p.y)
    let c1x = ax + dx * 0.3 + nx * bow, c1y = ay + dy * 0.3 + ny * bow
    let c2x = ax + dx * 0.7 + nx * bow * 0.6, c2y = ay + dy * 0.7 + ny * bow * 0.6
    let steps = max(8, Int(duration / 0.009))
    let start = Date()
    for i in 1...steps {
        let u = Double(i) / Double(steps)
        let s = u * u * u * (u * (6 * u - 15) + 10), m = 1 - s
        var x = m * m * m * ax + 3 * m * m * s * c1x + 3 * m * s * s * c2x + s * s * s * px
        var y = m * m * m * ay + 3 * m * m * s * c1y + 3 * m * s * s * c2y + s * s * s * py
        if i < steps { x += randomIn(-0.6, 0.6); y += randomIn(-0.6, 0.6) }
        let wait = duration * u - Date().timeIntervalSince(start)
        if wait > 0 { usleep(UInt32(wait * 1_000_000)) }
        pointerMoved(i < steps ? CGPoint(x: x.rounded(), y: y.rounded()) : p)
    }
}

func typeText(_ s: String) {
    let src = CGEventSource(stateID: .hidSystemState)
    let lines = s.components(separatedBy: "\n")
    for (n, line) in lines.enumerated() {
        if humanPace && line.count <= 120 {
            // key by key; the text still comes from the unicode string, so the keyboard layout does not matter
            usleep(UInt32(randomIn(0.12, 0.3) * 1_000_000))
            for ch in line {
                let units = Array(String(ch).utf16)
                let lower = String(ch).lowercased()
                let code: CGKeyCode = ch == " " ? (KEYCODES["space"] ?? 0) : (ch.isASCII ? (KEYCODES[lower] ?? 0) : 0)
                let shift = ch.isASCII && ch.isLetter && ch.isUppercase
                for down in [true, false] {
                    let e = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: down)!
                    if shift { e.flags = .maskShift }
                    e.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
                    e.post(tap: .cghidEventTap)
                    if down { usleep(UInt32(randomIn(0.03, 0.075) * 1_000_000)) }
                }
                var gap = min(0.18, max(0.04, 0.07 + gaussian() * 0.024))
                if Double.random(in: 0..<1) < 0.04 { gap += randomIn(0.2, 0.45) }
                usleep(UInt32(gap * 1_000_000))
            }
        } else {
            let units = Array(line.utf16)
            var i = 0
            while i < units.count {
                let chunk = Array(units[i..<min(i + 16, units.count)])
                for down in [true, false] {
                    let e = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: down)!
                    e.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk)
                    e.post(tap: .cghidEventTap)
                }
                i += 16
                usleep(8000)
            }
        }
        if n < lines.count - 1 { sendKey("return") }
    }
}

func click(_ p: CGPoint, right: Bool = false, double: Bool = false) {
    let button: CGMouseButton = right ? .right : .left
    let (downType, upType): (CGEventType, CGEventType) = right ? (.rightMouseDown, .rightMouseUp) : (.leftMouseDown, .leftMouseUp)
    glide(to: p)
    usleep(humanPace ? UInt32(randomIn(0.07, 0.19) * 1_000_000) : 30000)
    for n in 1...(double ? 2 : 1) {
        for type in [downType, upType] {
            let e = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: button)!
            e.setIntegerValueField(.mouseEventClickState, value: Int64(n))
            e.post(tap: .cghidEventTap)
            usleep(humanPace && type == downType ? UInt32(randomIn(0.045, 0.11) * 1_000_000) : 20000)
        }
    }
}

func center(_ el: AXUIElement) -> CGPoint? {
    let a = fetch(el)
    guard let pos = a["AXPosition"] as? CGPoint, let size = a["AXSize"] as? CGSize else { return nil }
    return CGPoint(x: pos.x + size.width / 2, y: pos.y + size.height / 2)
}

func labelOf(_ el: AXUIElement) -> String {
    let a = fetch(el)
    return [text(a["AXTitle"]), text(a["AXDescription"]), text(a["AXValue"]), text(a["AXPlaceholderValue"])].compactMap { $0 }.joined(separator: " ")
}

// MARK: - Commands

let command = args.isEmpty ? "help" : args.removeFirst()
let pidOpt = option("--pid")
let appOpt = option("--app")

switch command {
case "trusted":
    let prompt = flag("--prompt")
    let opts = ["AXTrustedCheckOptionPrompt": prompt] as CFDictionary
    let trusted = AXIsProcessTrustedWithOptions(opts)
    var screen = CGPreflightScreenCaptureAccess()
    if prompt && !screen { screen = CGRequestScreenCaptureAccess() }
    emit(["trusted": trusted, "screenRecording": screen])

case "apps":
    let apps = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
    emit(["apps": apps.map { ["name": $0.localizedName ?? "", "pid": $0.processIdentifier, "bundleId": $0.bundleIdentifier ?? "", "active": $0.isActive] }])

case "frontmost":
    let app = targetApp(pid: pidOpt, name: appOpt)
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    let mine = windows.filter { ($0[kCGWindowOwnerPID as String] as? pid_t) == app.processIdentifier && ($0[kCGWindowLayer as String] as? Int) == 0 }
    // Without the focused window (no Accessibility permission) the biggest one, not a full-screen app's thin strips.
    let area = { (d: [String: Any]) -> CGFloat in
        guard let b = d[kCGWindowBounds as String] as? NSDictionary, let r = CGRect(dictionaryRepresentation: b as CFDictionary) else { return 0 }
        return r.width * r.height
    }
    var win = mine.max { area($0) < area($1) }
    let appEl = AXUIElementCreateApplication(app.processIdentifier)
    var out: [String: Any] = ["app": app.localizedName ?? "", "pid": app.processIdentifier, "bundleId": app.bundleIdentifier ?? ""]
    if let w = focusedWindow(appEl) {
        out["window"] = text(attribute(w, "AXTitle")) ?? ""
        // The on-screen window that is the focused one (full-screen apps add strips above it).
        let a = fetch(w)
        if let pos = a["AXPosition"] as? CGPoint, let size = a["AXSize"] as? CGSize, let same = mine.first(where: { d in
            guard let b = d[kCGWindowBounds as String] as? NSDictionary, let r = CGRect(dictionaryRepresentation: b as CFDictionary) else { return false }
            return abs(r.minX - pos.x) < 2 && abs(r.minY - pos.y) < 2 && abs(r.width - size.width) < 2 && abs(r.height - size.height) < 2
        }) { win = same }
    }
    if let id = win?[kCGWindowNumber as String] as? Int { out["windowId"] = id }
    if let b = win?[kCGWindowBounds as String] as? [String: Any] { out["bounds"] = b }
    emit(out)

case "tree":
    let menus = flag("--menus")
    let app = targetApp(pid: pidOpt, name: appOpt)
    // Web-view apps list their whole library in a sidebar before the page itself.
    let maxItems = Int(option("--max") ?? "") ?? (isChromium(app) ? 900 : 400)
    let budget = Double(option("--budget") ?? "") ?? 2.5
    emit(readTree(app: app, menus: menus, maxItems: maxItems, budget: budget))

case "press":
    let expect = option("--expect")
    guard let path = args.first else { fail("Yol verilmedi.", code: "BAD_ARGS") }
    let el = resolve(path, targetApp(pid: pidOpt, name: appOpt))
    if let expect, !expect.isEmpty, !labelOf(el).lowercased().contains(expect.lowercased()) {
        fail("Pencere değişmiş: \(path) artık \"\(expect)\" değil. Yeniden oku.", code: "STALE")
    }
    if AXUIElementPerformAction(el, kAXPressAction as CFString) == .success {
        emit(["ok": true, "method": "AXPress"])
    } else if let p = center(el) {
        click(p)
        emit(["ok": true, "method": "click", "x": Int(p.x), "y": Int(p.y)])
    } else {
        fail("Öğeye basılamadı.", code: "PRESS_FAILED")
    }

case "focus":
    guard let path = args.first else { fail("Yol verilmedi.", code: "BAD_ARGS") }
    let el = resolve(path, targetApp(pid: pidOpt, name: appOpt))
    emit(["ok": AXUIElementSetAttributeValue(el, "AXFocused" as CFString, kCFBooleanTrue) == .success])

case "setvalue":
    guard args.count >= 2 else { fail("Kullanım: setvalue <yol> <metin>", code: "BAD_ARGS") }
    let el = resolve(args[0], targetApp(pid: pidOpt, name: appOpt))
    let value = args[1]
    AXUIElementSetAttributeValue(el, "AXFocused" as CFString, kCFBooleanTrue)
    var method = "AXValue"
    if AXUIElementSetAttributeValue(el, "AXValue" as CFString, value as CFString) != .success || text(attribute(el, "AXValue")) != value.trimmingCharacters(in: .whitespacesAndNewlines) {
        // The keyboard fallback types into the front app: it must be the target app.
        let target = targetApp(pid: pidOpt, name: appOpt)
        if NSWorkspace.shared.frontmostApplication?.processIdentifier != target.processIdentifier {
            target.activate(options: [])
            usleep(300000)
        }
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == target.processIdentifier else {
            fail("\(target.localizedName ?? "Uygulama") öne getirilemedi; klavyeyle yazılmadı.", code: "NOT_FRONT")
        }
        if let p = center(el) { click(p) }
        usleep(80000)
        sendKey("cmd+a")
        typeText(value)
        method = "keyboard"
    }
    emit(["ok": true, "method": method, "value": text(attribute(el, "AXValue")) ?? ""])

case "type":
    guard let s = args.first else { fail("Metin verilmedi.", code: "BAD_ARGS") }
    typeText(s)
    emit(["ok": true])

case "key":
    guard let combo = args.first else { fail("Tuş verilmedi.", code: "BAD_ARGS") }
    sendKey(combo)
    emit(["ok": true])

case "click":
    // click <x> <y> [--pid N]: with --pid, only when that app is in front and
    // owns what is under the point (checked right before the click).
    let right = flag("--right"), double = flag("--double")
    guard args.count >= 2, let x = Double(args[0]), let y = Double(args[1]) else { fail("Kullanım: click <x> <y>", code: "BAD_ARGS") }
    if let pidOpt, let pid = pid_t(pidOpt) {
        let front = NSWorkspace.shared.frontmostApplication
        var found: AXUIElement?
        var owner: pid_t = 0
        if AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(x), Float(y), &found) == .success, let el = found { AXUIElementGetPid(el, &owner) }
        guard front?.processIdentifier == pid, owner == pid else {
            let under = NSRunningApplication(processIdentifier: owner)?.localizedName ?? "başka bir şey"
            fail("Tıklanmadı: o noktada artık hedef pencere yok (önde \(front?.localizedName ?? "?"), altında \(under)).", code: "NOT_FRONT")
        }
    }
    click(CGPoint(x: x, y: y), right: right, double: double)
    emit(["ok": true])

case "glide":
    // glide <x> <y> [--trace]: only moves the pointer. --trace reports what the pointer really did.
    guard args.count >= 2, let x = Double(args[0]), let y = Double(args[1]) else { fail("Kullanım: glide <x> <y>", code: "BAD_ARGS") }
    let from = cursorPosition(), started = Date()
    glide(to: CGPoint(x: x, y: y))
    let final = cursorPosition()
    emit(["ok": true, "from": [from.x, from.y], "final": [final.x, final.y], "ms": Int(Date().timeIntervalSince(started) * 1000)])

case "cursor":
    let c = cursorPosition()
    emit(["ok": true, "x": c.x, "y": c.y])

case "scroll":
    // scroll <dy> [dx] [--at x,y]: with --at the pointer moves there first; the scroll goes to what is under it.
    let at = option("--at")?.split(separator: ",").compactMap { Double($0) }
    let dy = Int32(args.first ?? "") ?? -300
    let dx = Int32(args.count > 1 ? args[1] : "") ?? 0
    if let at, at.count == 2 {
        glide(to: CGPoint(x: at[0], y: at[1]))
        usleep(humanPace ? UInt32(randomIn(0.06, 0.16) * 1_000_000) : 60000)
    }
    // In steps like a real wheel: some apps drop one huge event.
    let steps = max(1, Int((max(abs(dy), abs(dx)) + 199) / 200))
    for _ in 0..<steps {
        CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: dy / Int32(steps), wheel2: dx / Int32(steps), wheel3: 0)?.post(tap: .cghidEventTap)
        usleep(16000)
    }
    emit(["ok": true])

case "record":
    // record <seconds> <out.wav>: 16 kHz mono 16-bit WAV, the format whisper.cpp reads.
    let seconds = Double(args.first ?? "") ?? 5
    let out = args.count > 1 ? args[1] : NSTemporaryDirectory() + "jevis-record.wav"
    if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
        var answered = false
        AVCaptureDevice.requestAccess(for: .audio) { _ in answered = true }
        let until = Date().addingTimeInterval(60)
        while !answered && Date() < until { RunLoop.current.run(until: Date().addingTimeInterval(0.1)) }
    }
    guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
        fail("Mikrofon izni yok. Sistem Ayarları › Gizlilik ve Güvenlik › Mikrofon bölümünden Handry'yi çalıştıran uygulamaya izin ver.", code: "NO_PERMISSION")
    }
    let settings: [String: Any] = [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1,
                                   AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false]
    guard let recorder = try? AVAudioRecorder(url: URL(fileURLWithPath: out), settings: settings), recorder.record(forDuration: seconds) else {
        fail("Kayıt başlatılamadı.", code: "MIC")
    }
    RunLoop.current.run(until: Date().addingTimeInterval(seconds + 0.3))
    recorder.stop()
    emit(["ok": true, "file": out, "seconds": seconds])

case "windows":
    let app = targetApp(pid: pidOpt, name: appOpt)
    let appEl = AXUIElementCreateApplication(app.processIdentifier)
    let windows = (attribute(appEl, "AXWindows") as? [AXUIElement]) ?? []
    let focused = attribute(appEl, "AXFocusedWindow")
    emit(["app": app.localizedName ?? "", "pid": app.processIdentifier, "windows": windows.enumerated().map { i, w -> [String: Any] in
        let a = fetch(w)
        let pos = a["AXPosition"] as? CGPoint ?? .zero
        let size = a["AXSize"] as? CGSize ?? .zero
        return ["index": i, "title": text(a["AXTitle"]) ?? "", "focused": focused.map { CFEqual($0, w) } ?? false,
                "minimized": (attribute(w, "AXMinimized") as? Bool) ?? false,
                "x": Int(pos.x), "y": Int(pos.y), "w": Int(size.width), "h": Int(size.height)]
    }])

case "setframe":
    // setframe <x> <y> <w> <h> [--title T]: moves and resizes one window of the app (the first, or the first whose
    // title contains T). Uses the accessibility API directly: AppleScript's "set position" fails on many windows.
    let baslik = option("--title")
    guard args.count >= 4, let fx = Double(args[0]), let fy = Double(args[1]), let fw = Double(args[2]), let fh = Double(args[3]) else { fail("Kullanım: setframe <x> <y> <w> <h>", code: "BAD_ARGS") }
    let app = targetApp(pid: pidOpt, name: appOpt)
    let appEl = AXUIElementCreateApplication(app.processIdentifier)
    let windows = (attribute(appEl, "AXWindows") as? [AXUIElement]) ?? []
    guard let win = windows.first(where: { baslik == nil || (text(attribute($0, "AXTitle")) ?? "").localizedCaseInsensitiveContains(baslik!) }) else { fail("Böyle bir pencere yok.", code: "NOT_FOUND") }
    AXUIElementSetAttributeValue(win, "AXMinimized" as CFString, kCFBooleanFalse)
    var konum = CGPoint(x: fx, y: fy)
    var boyut = CGSize(width: fw, height: fh)
    // boyut, konum, boyut: bazı uygulamalar boyutu eski konumdaki ekrana göre kısıyor
    AXUIElementSetAttributeValue(win, kAXSizeAttribute as CFString, AXValueCreate(.cgSize, &boyut)!)
    let yer = AXUIElementSetAttributeValue(win, kAXPositionAttribute as CFString, AXValueCreate(.cgPoint, &konum)!)
    // sabit boyutlu pencereler (Hesap Makinesi gibi) sadece taşınır; boyut hatası yok sayılır
    AXUIElementSetAttributeValue(win, kAXSizeAttribute as CFString, AXValueCreate(.cgSize, &boyut)!)
    if yer != .success { fail("Pencere yerleştirilemedi (kod \(yer.rawValue)). Pencere tam ekranda ya da yerleştirmeye kapalı olabilir.", code: "NOT_SETTABLE") }
    let son = fetch(win)
    let p2 = son["AXPosition"] as? CGPoint ?? .zero
    let s2 = son["AXSize"] as? CGSize ?? .zero
    emit(["ok": true, "title": text(son["AXTitle"]) ?? "", "x": Int(p2.x), "y": Int(p2.y), "w": Int(s2.width), "h": Int(s2.height)])

case "minimize":
    // minimize [--title T]: sends one window of the app (the first, or the first whose title contains T) to the Dock.
    let baslik = option("--title")
    let app = targetApp(pid: pidOpt, name: appOpt)
    let appEl = AXUIElementCreateApplication(app.processIdentifier)
    let windows = (attribute(appEl, "AXWindows") as? [AXUIElement]) ?? []
    guard let win = windows.first(where: { baslik == nil || (text(attribute($0, "AXTitle")) ?? "").localizedCaseInsensitiveContains(baslik!) }) else { fail("Böyle bir pencere yok.", code: "NOT_FOUND") }
    let sonuc = AXUIElementSetAttributeValue(win, "AXMinimized" as CFString, kCFBooleanTrue)
    if sonuc != .success { fail("Pencere küçültülemedi (kod \(sonuc.rawValue)).", code: "NOT_SETTABLE") }
    emit(["ok": true, "title": text(attribute(win, "AXTitle")) ?? ""])

case "raise":
    // raise <index>: brings one window of the app to the front.
    let app = targetApp(pid: pidOpt, name: appOpt)
    let appEl = AXUIElementCreateApplication(app.processIdentifier)
    let windows = (attribute(appEl, "AXWindows") as? [AXUIElement]) ?? []
    guard let i = Int(args.first ?? ""), i >= 0, i < windows.count else { fail("Böyle bir pencere yok.", code: "NOT_FOUND") }
    let w = windows[i]
    AXUIElementSetAttributeValue(w, "AXMinimized" as CFString, kCFBooleanFalse)
    AXUIElementPerformAction(w, kAXRaiseAction as CFString)
    AXUIElementSetAttributeValue(w, "AXMain" as CFString, kCFBooleanTrue)
    AXUIElementSetAttributeValue(appEl, "AXFrontmost" as CFString, kCFBooleanTrue)
    app.activate(options: [.activateAllWindows])
    emit(["ok": true, "title": text(attribute(w, "AXTitle")) ?? ""])

case "hit":
    // hit <x> <y>: what is under a screen point (points), for checking a click.
    guard args.count >= 2, let x = Double(args[0]), let y = Double(args[1]) else { fail("Kullanım: hit <x> <y>", code: "BAD_ARGS") }
    var found: AXUIElement?
    guard AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(x), Float(y), &found) == .success, var el = found else {
        emit(["found": false]); break
    }
    // A text inside a button names the button: climb to the control.
    var candidate: AXUIElement? = el
    for _ in 0..<5 {
        guard let c = candidate else { break }
        if ACTIONABLE.contains(attribute(c, "AXRole") as? String ?? "") { el = c; break }
        candidate = attribute(c, "AXParent").map { $0 as! AXUIElement }
    }
    var pid: pid_t = 0
    AXUIElementGetPid(el, &pid)
    emit(["found": true, "role": String((attribute(el, "AXRole") as? String ?? "").dropFirst(2)), "name": cut(labelOf(el), 80),
          "pid": pid, "app": NSRunningApplication(processIdentifier: pid)?.localizedName ?? ""])

case "automation":
    // automation <bundleId>: may the app running Handry send that app Apple
    // Events? Only looks; never shows the permission question.
    guard let bundle = args.first else { fail("Kullanım: automation <bundleId>", code: "BAD_ARGS") }
    var target = AEAddressDesc()
    let bytes = Array(bundle.utf8)
    AECreateDesc(DescType(typeApplicationBundleID), bytes, bytes.count, &target)
    let status = AEDeterminePermissionToAutomateTarget(&target, AEEventClass(typeWildCard), AEEventID(typeWildCard), false)
    AEDisposeDesc(&target)
    let states: [OSStatus: String] = [noErr: "granted", -1743: "denied", -1744: "ask", -600: "not_running"]
    emit(["bundleId": bundle, "state": states[status] ?? "unknown", "status": Int(status)])

case "focused":
    // Which app has the keyboard focus (a non-activating panel can have it
    // while another app is "in front").
    guard let raw = attribute(AXUIElementCreateSystemWide(), "AXFocusedUIElement") else { emit(["found": false]); break }
    let el = raw as! AXUIElement
    var owner: pid_t = 0
    AXUIElementGetPid(el, &owner)
    emit(["found": true, "pid": owner, "app": NSRunningApplication(processIdentifier: owner)?.localizedName ?? "",
          "role": String((attribute(el, "AXRole") as? String ?? "").dropFirst(2))])

case "screen":
    // The main display in points (the unit clicks use) and its pixel scale.
    let frame = NSScreen.screens.first?.frame ?? .zero
    emit(["x": Int(frame.origin.x), "y": Int(frame.origin.y), "w": Int(frame.width), "h": Int(frame.height),
          "scale": NSScreen.screens.first?.backingScaleFactor ?? 1])

case "activate":
    let app = targetApp(pid: pidOpt, name: appOpt)
    emit(["ok": app.activate(options: [.activateAllWindows]), "app": app.localizedName ?? ""])

default:
    emit(["commands": ["trusted", "apps", "frontmost", "tree", "press", "focus", "setvalue", "type", "key", "click", "scroll", "activate"]])
}
