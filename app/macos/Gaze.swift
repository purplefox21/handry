// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Eye tracking: a see-through page over one screen (app/public/gaze.html) uses the camera and MediaPipe to find
// where the user looks. First a calibration (points to look at; the panel takes the mouse and Esc meanwhile),
// then a soft dot follows the gaze and every click goes through to the apps below. The camera is on only while
// this runs (the green light shows it), and nothing from it leaves the Mac. Menu › Eye Tracking turns it on and
// off; menu › Calibrate Eyes starts over. The calibration is kept in ~/.jevis/gaze/calibration.json.
import Cocoa
import WebKit

private final class GazePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

/// The page's messages, without the content controller keeping Gaze alive.
private final class GazeMessages: NSObject, WKScriptMessageHandler {
    weak var gaze: Gaze?
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) { gaze?.received(message.body) }
}

final class Gaze {
    /// On or off (the menu follows it).
    var onChange: (_ on: Bool) -> Void = { _ in }
    /// Handry's own pages may use the camera: the app delegate answers WebKit's question.
    weak var uiDelegate: WKUIDelegate?
    private(set) var isOn = false
    private var panel: GazePanel?
    private var web: WKWebView?
    private let messages = GazeMessages()

    static var calibrated: Bool { FileManager.default.fileExists(atPath: "\(HOME)/.jevis/gaze/calibration.json") }

    init() { messages.gaze = self }

    /// Opens on the screen under the mouse. calibrate: start with the calibration even if there is one.
    func start(calibrate: Bool) {
        stop()
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first(where: { NSMouseInRect(mouse, $0.frame, false) }) ?? NSScreen.main ?? NSScreen.screens[0]
        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(messages, name: "gaze")
        let web = WKWebView(frame: NSRect(origin: .zero, size: screen.frame.size), configuration: config)
        web.setValue(false, forKey: "drawsBackground")
        web.uiDelegate = uiDelegate
        let panel = GazePanel(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 2)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        panel.contentView = web
        panel.setFrame(screen.frame, display: false)
        let first = calibrate || !Gaze.calibrated
        panel.ignoresMouseEvents = !first
        panel.orderFrontRegardless()
        if first { panel.makeKey(); panel.makeFirstResponder(web) }
        web.load(URLRequest(url: URL(string: URL_BASE + "gaze.html?mode=\(calibrate ? "calibrate" : "track")")!))
        self.panel = panel
        self.web = web
        isOn = true
        onChange(true)
    }

    /// Closes it: the camera goes off.
    func stop() {
        guard let panel else { return }
        web?.evaluateJavaScript("window.stopGaze && window.stopGaze()")
        web?.configuration.userContentController.removeScriptMessageHandler(forName: "gaze")
        let closing = web
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { closing?.loadHTMLString("", baseURL: nil) }
        panel.orderOut(nil)
        self.panel = nil
        web = nil
        isOn = false
        onChange(false)
    }

    func toggle() { if isOn { stop() } else { start(calibrate: false) } }

    fileprivate func received(_ body: Any) {
        guard let msg = body as? [String: Any], let type = msg["type"] as? String else { return }
        switch type {
        case "calibrating":
            panel?.ignoresMouseEvents = false
            panel?.makeKey()
        case "calibrated", "tracking":
            // following now: clicks go through, and the keyboard goes back to the app the user was in
            guard let panel else { return }
            panel.ignoresMouseEvents = true
            if panel.isKeyWindow { panel.orderOut(nil); panel.orderFrontRegardless() }
        case "cancel":
            stop()
        case "error":
            // the page says what went wrong; it goes after a while
            panel?.ignoresMouseEvents = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 6) { [weak self] in self?.stop() }
        default:
            break
        }
    }
}
