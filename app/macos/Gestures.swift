// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Hand gestures: a small window in the screen's corner (app/public/hands.html) shows the camera picture and the
// hand's skeleton; what the hand does moves the real mouse here (index finger out: the pointer; thumb and index
// together: click, twice: double click, pinch and move: drag; two fingers: scroll; open palm or fist: nothing;
// app/public/hands-gestures.js). The camera is on only while the window is (the green light shows it), and
// nothing from it leaves the Mac. Menu › Hand Gestures turns it on and off, so does ⌥Esc (emergency stop).
// While Handry asks the user to confirm something (~/.jevis/confirming.json) the hand doesn't click.
import Cocoa
import WebKit

/// The page's messages, without the content controller keeping Gestures alive.
private final class GestureMessages: NSObject, WKScriptMessageHandler {
    weak var gestures: Gestures?
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) { gestures?.received(message.body) }
}

final class Gestures {
    /// On or off (the menu follows it).
    var onChange: (_ on: Bool) -> Void = { _ in }
    /// Handry's own pages may use the camera: the app delegate answers WebKit's question.
    weak var uiDelegate: WKUIDelegate?
    private(set) var isOn = false
    private var panel: NSPanel?
    private var web: WKWebView?
    private let messages = GestureMessages()
    private var generation = 0
    /// The screen the hand moves over, in global top-left points (what CGEvent uses).
    private var area = CGRect.zero
    private var buttonDown = false
    private var clicks: Int64 = 1
    private var lastDownAt = Date.distantPast
    private var lastDownPoint = CGPoint.zero
    private var lastMessage = Date()
    private var watchdog: Timer?
    private let source = CGEventSource(stateID: .hidSystemState)

    init() { messages.gestures = self }

    /// Opens the window in the corner of the screen under the mouse; the hand moves the pointer over that screen.
    func start() {
        stop()
        generation += 1
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first(where: { NSMouseInRect(mouse, $0.frame, false) }) ?? NSScreen.main ?? NSScreen.screens[0]
        let primary = NSScreen.screens[0].frame
        area = CGRect(x: screen.frame.minX, y: primary.maxY - screen.frame.maxY, width: screen.frame.width, height: screen.frame.height)
        let size = NSSize(width: 256, height: 174) // a 16:9 picture and a line under it
        let visible = screen.visibleFrame
        let frame = NSRect(x: visible.maxX - size.width - 16, y: visible.minY + 16, width: size.width, height: size.height)
        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(messages, name: "hands")
        let web = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: config)
        web.setValue(false, forKey: "drawsBackground")
        web.uiDelegate = uiDelegate
        let panel = NSPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 1)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.ignoresMouseEvents = true // clicks go through to what is under it
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        panel.contentView = web
        panel.orderFrontRegardless()
        web.load(URLRequest(url: URL(string: URL_BASE + "hands.html?w=\(Int(screen.frame.width))&h=\(Int(screen.frame.height))")!))
        self.panel = panel
        self.web = web
        lastMessage = Date()
        watchdog = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.check() }
        isOn = true
        onChange(true)
    }

    /// Closes it: the mouse button is let go and the camera goes off.
    func stop() {
        watchdog?.invalidate()
        watchdog = nil
        letGo()
        guard let panel else { return }
        web?.evaluateJavaScript("window.stopHands && window.stopHands()")
        web?.configuration.userContentController.removeScriptMessageHandler(forName: "hands")
        let closing = web
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { closing?.loadHTMLString("", baseURL: nil) }
        panel.orderOut(nil)
        self.panel = nil
        web = nil
        isOn = false
        onChange(false)
    }

    func toggle() { if isOn { stop() } else { start() } }

    // MARK: The mouse

    private func point(_ msg: [String: Any]) -> CGPoint? {
        guard let x = (msg["x"] as? NSNumber)?.doubleValue, let y = (msg["y"] as? NSNumber)?.doubleValue, x.isFinite, y.isFinite else { return nil }
        return CGPoint(x: area.minX + min(max(x, 0), area.width - 1), y: area.minY + min(max(y, 0), area.height - 1))
    }

    private var mouseNow: CGPoint { CGEvent(source: nil)?.location ?? .zero }

    private func post(_ type: CGEventType, _ p: CGPoint) {
        guard let e = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: p, mouseButton: .left) else { return }
        if type != .mouseMoved { e.setIntegerValueField(.mouseEventClickState, value: clicks) }
        e.post(tap: .cghidEventTap)
    }

    private func letGo() {
        guard buttonDown else { return }
        post(.leftMouseUp, mouseNow)
        buttonDown = false
    }

    /// The page went quiet with the button down (it hung or closed): let go, so the mouse is never stuck.
    private func check() {
        if buttonDown && Date().timeIntervalSince(lastMessage) > 1.5 { letGo() }
    }

    fileprivate func received(_ body: Any) {
        guard let msg = body as? [String: Any], let type = msg["type"] as? String else { return }
        lastMessage = Date()
        switch type {
        case "ready":
            if !AXIsProcessTrusted() {
                let note = L("Fareyi oynatmak için Erişilebilirlik izni gerekiyor: menü › İzinler…",
                             "Moving the mouse needs the Accessibility permission: menu › Permissions…")
                if let data = try? JSONSerialization.data(withJSONObject: [note]), let json = String(data: data, encoding: .utf8) {
                    web?.evaluateJavaScript("window.handsNote(\(json)[0])")
                }
            }
        case "move":
            guard let p = point(msg) else { return }
            post(buttonDown ? .leftMouseDragged : .mouseMoved, p)
        case "down":
            guard let p = point(msg), !buttonDown else { return }
            // Handry is asking the user something: a hand doesn't answer it by accident.
            if Pen.confirming() { NSSound.beep(); return }
            let again = Date().timeIntervalSince(lastDownAt) < 0.45 && hypot(p.x - lastDownPoint.x, p.y - lastDownPoint.y) < 10
            clicks = again ? min(clicks + 1, 3) : 1
            lastDownAt = Date()
            lastDownPoint = p
            post(.mouseMoved, p)
            post(.leftMouseDown, p)
            buttonDown = true
        case "up":
            guard buttonDown else { return }
            post(.leftMouseUp, point(msg) ?? mouseNow)
            buttonDown = false
        case "scroll":
            guard let dy = (msg["dy"] as? NSNumber)?.int32Value, dy != 0 else { return }
            CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 1, wheel1: dy, wheel2: 0, wheel3: 0)?.post(tap: .cghidEventTap)
        case "error":
            // the window says what went wrong, then goes
            let now = generation
            DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in if self?.generation == now { self?.stop() } }
        default:
            break // "hold": the pinch is still on (keeps the watchdog quiet)
        }
    }
}
