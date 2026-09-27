// jevis-ax: JEVIS desktop helper. Reads an app's accessibility tree and
// presses, types, clicks, scrolls and sends key combos. Prints one JSON object.
//
//   jevis-ax trusted [--prompt]
//   jevis-ax apps | frontmost [--app NAME|--pid N]
//   jevis-ax tree [--app NAME|--pid N] [--menus] [--max 400] [--budget 2.5]
//   jevis-ax press <path> [--expect TEXT] [--app|--pid]
//   jevis-ax setvalue <path> <text> [--app|--pid]
//   jevis-ax focus <path> [--app|--pid]
//   jevis-ax type <text> | key <combo> | click <x> <y> [--right] [--double] | scroll <dy> [dx]
//   jevis-ax activate [--app|--pid]
//
// Paths: "w.3.1" = child 3, then child 1 of the focused window; "m.2.0" = menu bar.
import Cocoa
import ApplicationServices

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

func resolve(_ path: String, _ app: NSRunningApplication) -> AXUIElement {
    let appEl = AXUIElementCreateApplication(app.processIdentifier)
    var parts = path.split(separator: ".")
    guard !parts.isEmpty, var el = root(parts.removeFirst(), appEl) else { fail("Pencere bulunamadı.", code: "STALE") }
    for part in parts {
        guard let i = Int(part), let kids = attribute(el, "AXChildren") as? [AXUIElement], i < kids.count else {
            fail("Öğe artık yok (\(path)). Pencereyi yeniden oku.", code: "STALE")
        }
        el = kids[i]
    }
    return el
}

// MARK: - Reading the tree

let ACTIONABLE: Set<String> = ["AXButton", "AXCheckBox", "AXRadioButton", "AXPopUpButton", "AXMenuButton", "AXTextField",
                               "AXTextArea", "AXComboBox", "AXSlider", "AXLink", "AXMenuItem",
                               "AXDisclosureTriangle", "AXIncrementor", "AXCell", "AXRow", "AXTab", "AXSegmentedControl",
                               "AXColorWell", "AXSwitch", "AXToggle", "AXDockItem"]

func readTree(app: NSRunningApplication, menus: Bool, maxItems: Int, budget: Double) -> [String: Any] {
    let appEl = AXUIElementCreateApplication(app.processIdentifier)
    // Electron apps (VS Code, Slack…) only build their tree when asked to.
    AXUIElementSetAttributeValue(appEl, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    let deadline = Date().addingTimeInterval(budget)
    var items: [[String: Any]] = []
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
        if ACTIONABLE.contains(role), !disabledMenuItem, (sized || isMenuItem) {
            let pos = a["AXPosition"] as? CGPoint ?? .zero
            let size = a["AXSize"] as? CGSize ?? .zero
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
    if let window = focusedWindow(appEl) {
        windowTitle = text(attribute(window, "AXTitle")) ?? ""
        walk(window, "w", 0, "")
    }
    if menus, let bar = attribute(appEl, "AXMenuBar") {
        walk(bar as! AXUIElement, "m", 0, "")
    }
    return ["app": app.localizedName ?? "", "pid": app.processIdentifier, "bundleId": app.bundleIdentifier ?? "",
            "window": windowTitle, "elements": items, "texts": texts, "visited": visited, "truncated": truncated]
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

func typeText(_ s: String) {
    let src = CGEventSource(stateID: .hidSystemState)
    let lines = s.components(separatedBy: "\n")
    for (n, line) in lines.enumerated() {
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
        if n < lines.count - 1 { sendKey("return") }
    }
}

func click(_ p: CGPoint, right: Bool = false, double: Bool = false) {
    let button: CGMouseButton = right ? .right : .left
    let (downType, upType): (CGEventType, CGEventType) = right ? (.rightMouseDown, .rightMouseUp) : (.leftMouseDown, .leftMouseUp)
    CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: button)?.post(tap: .cghidEventTap)
    usleep(30000)
    for n in 1...(double ? 2 : 1) {
        for type in [downType, upType] {
            let e = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: button)!
            e.setIntegerValueField(.mouseEventClickState, value: Int64(n))
            e.post(tap: .cghidEventTap)
            usleep(20000)
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
    let win = windows.first { ($0[kCGWindowOwnerPID as String] as? pid_t) == app.processIdentifier && ($0[kCGWindowLayer as String] as? Int) == 0 }
    let appEl = AXUIElementCreateApplication(app.processIdentifier)
    var out: [String: Any] = ["app": app.localizedName ?? "", "pid": app.processIdentifier, "bundleId": app.bundleIdentifier ?? ""]
    if let w = focusedWindow(appEl) { out["window"] = text(attribute(w, "AXTitle")) ?? "" }
    if let id = win?[kCGWindowNumber as String] as? Int { out["windowId"] = id }
    if let b = win?[kCGWindowBounds as String] as? [String: Any] { out["bounds"] = b }
    emit(out)

case "tree":
    let menus = flag("--menus")
    let maxItems = Int(option("--max") ?? "") ?? 400
    let budget = Double(option("--budget") ?? "") ?? 2.5
    emit(readTree(app: targetApp(pid: pidOpt, name: appOpt), menus: menus, maxItems: maxItems, budget: budget))

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
    guard args.count >= 2, let x = Double(args[0]), let y = Double(args[1]) else { fail("Kullanım: click <x> <y>", code: "BAD_ARGS") }
    click(CGPoint(x: x, y: y), right: flag("--right"), double: flag("--double"))
    emit(["ok": true])

case "scroll":
    let dy = Int32(args.first ?? "") ?? -300
    let dx = Int32(args.count > 1 ? args[1] : "") ?? 0
    CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0)?.post(tap: .cghidEventTap)
    emit(["ok": true])

case "activate":
    let app = targetApp(pid: pidOpt, name: appOpt)
    emit(["ok": app.activate(options: [.activateAllWindows]), "app": app.localizedName ?? ""])

default:
    emit(["commands": ["trusted", "apps", "frontmost", "tree", "press", "focus", "setvalue", "type", "key", "click", "scroll", "activate"]])
}
