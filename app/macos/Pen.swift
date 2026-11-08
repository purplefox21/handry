// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// The pen (Kalem): the user draws on the screen and asks about it ("what is this?", "do I click here?").
// On (⌥⇧P, the pen at the notch, the menu, ✏️ in the bar): a see-through layer over every screen takes the
// mouse or trackpad and draws lime lines (Handry's own drawings never use that color). ⌘Z takes the last
// line back, "Clear" takes them all, Esc or "Done" ends it; then the bar opens with the drawing attached.
// Off: the layer lets every click through; the lines stay until the user clears them or starts a new drawing.
// The lines go to ~/.jevis/marks/current.json in global top-left points (what the desktop hands use), with
// the display each is on; screen_marks (hands/marks.js) reads them. While Handry asks the user to confirm
// something (~/.jevis/confirming.json) the pen doesn't come on, and goes off if it was on.
import Cocoa

let PEN_COLOR = NSColor(srgbRed: 0xC6 / 255.0, green: 1, blue: 0, alpha: 1)

private final class PenPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

private final class PenView: NSView {
    weak var pen: Pen?
    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { pen?.down(self, event) }
    override func mouseDragged(with event: NSEvent) { pen?.drag(self, event) }
    override func mouseUp(with event: NSEvent) { pen?.up(self, event) }
    override func mouseMoved(with event: NSEvent) { if pen?.isOn == true { NSCursor.crosshair.set() } }
    override func keyDown(with event: NSEvent) { if pen?.key(event) != true { super.keyDown(with: event) } }
    override func performKeyEquivalent(with event: NSEvent) -> Bool { pen?.key(event) ?? false }
    override func resetCursorRects() { if pen?.isOn == true { addCursorRect(bounds, cursor: .crosshair) } }
}

/// The pen's small panel at the top of each screen: what to do, and two buttons.
private struct Hud {
    let layer: CALayer
    let clear: CGRect
    let done: CGRect
}

final class Pen {
    /// The user is done drawing (Esc, Done, the shortcut again): ask about it.
    var onFinish: (_ lines: Int) -> Void = { _ in }
    /// The pen went on or off (the island's pen and the menu follow it).
    var onChange: (_ on: Bool) -> Void = { _ in }
    private(set) var isOn = false
    var lines: Int { strokes.count }

    private struct Screen {
        let panel: PenPanel
        let view: PenView
        let screen: NSScreen
        let ink: CALayer
        var hud: Hud
    }
    /// One line, in global top-left points.
    private struct Stroke {
        var points: [CGPoint]
        let display: CGDirectDisplayID
        let at: Double
        var layers: [CAShapeLayer] = []
    }
    private var screens: [Screen] = []
    private var strokes: [Stroke] = []
    private var drawing: (screen: Int, points: [CGPoint], layer: CAShapeLayer)?
    private var drawingId = ""
    private var startedAt: Double = 0
    private var drewNow = false // a line was drawn since the pen came on
    private var watch: Timer?
    private let file = "\(HOME)/.jevis/marks/current.json"
    private func ms() -> Double { Date().timeIntervalSince1970 * 1000 }

    init() {
        build()
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in self?.build() }
    }

    // MARK: Points

    private var mainHeight: CGFloat { NSScreen.screens.first?.frame.height ?? 0 }
    private func global(_ p: CGPoint, on s: NSScreen) -> CGPoint { CGPoint(x: s.frame.minX + p.x, y: mainHeight - (s.frame.minY + p.y)) }
    private func local(_ g: CGPoint, on s: NSScreen) -> CGPoint { CGPoint(x: g.x - s.frame.minX, y: mainHeight - g.y - s.frame.minY) }
    private func displayId(_ s: NSScreen) -> CGDirectDisplayID { (s.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0 }

    // MARK: Layers

    private func build() {
        screens.forEach { $0.panel.orderOut(nil) }
        screens = []
        for screen in NSScreen.screens {
            let panel = PenPanel(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            panel.level = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 3)
            panel.isOpaque = false
            panel.backgroundColor = .clear
            panel.hasShadow = false
            panel.ignoresMouseEvents = true
            panel.acceptsMouseMovedEvents = true
            panel.hidesOnDeactivate = false
            panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
            let view = PenView(frame: NSRect(origin: .zero, size: screen.frame.size))
            view.pen = self
            view.wantsLayer = true
            panel.contentView = view
            panel.setFrame(screen.frame, display: false)
            let ink = CALayer()
            ink.frame = view.bounds
            view.layer?.addSublayer(ink)
            let hud = makeHud(on: screen, in: view)
            screens.append(Screen(panel: panel, view: view, screen: screen, ink: ink, hud: hud))
        }
        for i in strokes.indices { strokes[i].layers = draw(strokes[i].points) }
        show()
    }

    /// The layers are on screen while the pen is on or there are lines; otherwise out of the way entirely.
    private func show() {
        for s in screens {
            s.panel.ignoresMouseEvents = !isOn
            s.view.layer?.backgroundColor = isOn ? NSColor.black.withAlphaComponent(0.06).cgColor : NSColor.clear.cgColor
            s.hud.layer.isHidden = !isOn
            s.view.window?.invalidateCursorRects(for: s.view)
            if isOn || !strokes.isEmpty { s.panel.orderFrontRegardless() } else { s.panel.orderOut(nil) }
        }
    }

    private func path(_ points: [CGPoint]) -> CGPath {
        let p = CGMutablePath()
        guard let first = points.first else { return p }
        if points.count == 1 {
            p.addEllipse(in: CGRect(x: first.x - 3, y: first.y - 3, width: 6, height: 6))
            return p
        }
        p.move(to: first)
        for i in 1..<points.count {
            let mid = CGPoint(x: (points[i - 1].x + points[i].x) / 2, y: (points[i - 1].y + points[i].y) / 2)
            p.addQuadCurve(to: mid, control: points[i - 1])
        }
        p.addLine(to: points[points.count - 1])
        return p
    }

    private func lineLayer() -> CAShapeLayer {
        let l = CAShapeLayer()
        l.strokeColor = PEN_COLOR.cgColor
        l.fillColor = nil
        l.lineWidth = 4.5
        l.lineCap = .round
        l.lineJoin = .round
        l.shadowColor = NSColor.black.cgColor
        l.shadowOpacity = 0.55
        l.shadowRadius = 1.5
        l.shadowOffset = .zero
        return l
    }

    /// A line in global points, on every screen it crosses.
    private func draw(_ points: [CGPoint]) -> [CAShapeLayer] {
        screens.map { s in
            let l = lineLayer()
            l.path = path(points.map { local($0, on: s.screen) })
            if points.count == 1 { l.fillColor = PEN_COLOR.cgColor }
            s.ink.addSublayer(l)
            return l
        }
    }

    private func makeHud(on screen: NSScreen, in view: NSView) -> Hud {
        let font = NSFont.systemFont(ofSize: 13, weight: .medium)
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor.white]
        let label = NSAttributedString(string: L("✏️  Çiz, sonra sor   ·   ⌘Z geri al", "✏️  Draw, then ask   ·   ⌘Z undo"), attributes: attrs)
        let clearText = NSAttributedString(string: L("Temizle", "Clear"), attributes: attrs)
        let doneText = NSAttributedString(string: L("Bitti  esc", "Done  esc"), attributes: [.font: font, .foregroundColor: NSColor.black])
        let pad: CGFloat = 14, gap: CGFloat = 10, h: CGFloat = 34
        let lw = ceil(label.size().width), cw = ceil(clearText.size().width) + 22, dw = ceil(doneText.size().width) + 22
        let w = pad + lw + gap + cw + 6 + dw + 6
        let top = screen.frame.height - max(screen.frame.maxY - screen.visibleFrame.maxY, notchOf(screen).height, 24) - 14
        let notch = notchOf(screen)
        let frame = CGRect(x: notch.mid - w / 2, y: top - h, width: w, height: h)
        let hud = CALayer()
        hud.frame = frame
        hud.backgroundColor = NSColor.black.withAlphaComponent(0.82).cgColor
        hud.cornerRadius = h / 2
        hud.borderColor = PEN_COLOR.withAlphaComponent(0.7).cgColor
        hud.borderWidth = 1
        func text(_ s: NSAttributedString, x: CGFloat, width: CGFloat) -> CATextLayer {
            let t = CATextLayer()
            t.string = s
            t.alignmentMode = .center
            t.contentsScale = screen.backingScaleFactor
            let th = ceil(s.size().height)
            t.frame = CGRect(x: x, y: (h - th) / 2 - 0.5, width: width, height: th + 1)
            return t
        }
        hud.addSublayer(text(label, x: pad, width: lw))
        let clearBox = CGRect(x: pad + lw + gap, y: 5, width: cw, height: h - 10)
        let clear = CALayer()
        clear.frame = clearBox
        clear.backgroundColor = NSColor.white.withAlphaComponent(0.16).cgColor
        clear.cornerRadius = clearBox.height / 2
        clear.addSublayer(text(clearText, x: 0, width: cw))
        hud.addSublayer(clear)
        let doneBox = CGRect(x: clearBox.maxX + 6, y: 5, width: dw, height: h - 10)
        let done = CALayer()
        done.frame = doneBox
        done.backgroundColor = PEN_COLOR.cgColor
        done.cornerRadius = doneBox.height / 2
        let doneLabel = text(doneText, x: 0, width: dw)
        done.addSublayer(doneLabel)
        hud.addSublayer(done)
        hud.isHidden = true
        view.layer?.addSublayer(hud)
        return Hud(layer: hud, clear: clearBox.offsetBy(dx: frame.minX, dy: frame.minY), done: doneBox.offsetBy(dx: frame.minX, dy: frame.minY))
    }

    // MARK: On and off

    /// Handry is asking the user to confirm something: the pen stays off (the question must be answered first).
    static func confirming() -> Bool {
        guard let data = FileManager.default.contents(atPath: "\(HOME)/.jevis/confirming.json"),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let until = (json["until"] as? NSNumber)?.doubleValue, let pid = (json["pid"] as? NSNumber)?.int32Value else { return false }
        return until > Date().timeIntervalSince1970 * 1000 && kill(pid, 0) == 0
    }

    /// Turns the pen on; false (and nothing happens) while a confirmation is open.
    @discardableResult
    func start() -> Bool {
        if isOn { return true }
        if Pen.confirming() { NSSound.beep(); return false }
        isOn = true
        drewNow = false
        show()
        // the keyboard (Esc, ⌘Z) goes to the screen under the mouse, without making Handry the active app
        let mouse = NSEvent.mouseLocation
        if let s = screens.first(where: { NSMouseInRect(mouse, $0.screen.frame, false) }) ?? screens.first {
            s.panel.makeKey()
            s.panel.makeFirstResponder(s.view)
        }
        NSCursor.crosshair.set()
        watch = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { [weak self] _ in
            if Pen.confirming() { self?.finish(ask: false) }
        }
        save()
        onChange(true)
        return true
    }

    /// Turns the pen off. ask: if something new was drawn, the bar opens to ask about it.
    func finish(ask: Bool = true) {
        guard isOn else { return }
        isOn = false
        watch?.invalidate()
        watch = nil
        if let d = drawing { drawing = nil; d.layer.removeFromSuperlayer() }
        show()
        // give the keyboard back to the app the user was in
        for s in screens where s.panel.isKeyWindow {
            s.panel.orderOut(nil)
            if !strokes.isEmpty { s.panel.orderFrontRegardless() }
        }
        NSCursor.arrow.set()
        save()
        onChange(false)
        if ask && drewNow && !strokes.isEmpty { onFinish(strokes.count) }
    }

    func toggle() { if isOn { finish() } else { start() } }

    /// Takes every line away (the drawing is gone for screen_marks too).
    func clear() {
        strokes.forEach { $0.layers.forEach { $0.removeFromSuperlayer() } }
        strokes = []
        save()
        show()
    }

    func undo() {
        guard let last = strokes.popLast() else { NSSound.beep(); return }
        last.layers.forEach { $0.removeFromSuperlayer() }
        save()
    }

    // MARK: Drawing

    fileprivate func down(_ view: PenView, _ event: NSEvent) {
        guard isOn, let i = screens.firstIndex(where: { $0.view === view }) else { return }
        let p = view.convert(event.locationInWindow, from: nil)
        if screens[i].hud.clear.contains(p) { clear(); return }
        if screens[i].hud.done.contains(p) { finish(); return }
        if !drewNow {
            // the first line since the pen came on starts a new drawing: the old lines go
            clear()
            drawingId = "m\(Int(ms()))"
            startedAt = ms()
            drewNow = true
        }
        let layer = lineLayer()
        screens[i].ink.addSublayer(layer)
        drawing = (i, [p], layer)
        layer.path = path([p])
        layer.fillColor = PEN_COLOR.cgColor
    }

    fileprivate func drag(_ view: PenView, _ event: NSEvent) {
        guard isOn, var d = drawing, screens[d.screen].view === view else { return }
        let p = view.convert(event.locationInWindow, from: nil)
        guard let last = d.points.last, hypot(p.x - last.x, p.y - last.y) >= 1.5 else { return }
        d.points.append(p)
        drawing = d
        d.layer.fillColor = nil
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        d.layer.path = path(d.points)
        CATransaction.commit()
    }

    fileprivate func up(_ view: PenView, _ event: NSEvent) {
        guard let d = drawing else { return }
        drawing = nil
        d.layer.removeFromSuperlayer()
        let s = screens[d.screen].screen
        let points = d.points.map { global($0, on: s) }
        var stroke = Stroke(points: points, display: displayId(s), at: ms())
        stroke.layers = draw(points)
        strokes.append(stroke)
        save()
    }

    fileprivate func key(_ event: NSEvent) -> Bool {
        guard isOn else { return false }
        if event.keyCode == 53 { finish(); return true } // Esc
        let chars = event.charactersIgnoringModifiers?.lowercased()
        if event.modifierFlags.contains(.command), chars == "z" { undo(); return true }
        if event.keyCode == 51 { undo(); return true } // Delete
        return false
    }

    // MARK: The file

    private func save() {
        let displays = Dictionary(uniqueKeysWithValues: screens.map { (displayId($0.screen), $0.screen) })
        let lines: [[String: Any]] = strokes.map { s in
            let b = CGDisplayBounds(s.display)
            var display: [String: Any] = ["id": Int(s.display), "x": Int(b.minX), "y": Int(b.minY), "w": Int(b.width), "h": Int(b.height)]
            if let screen = displays[s.display] { display["scale"] = screen.backingScaleFactor }
            return ["display": display, "at": s.at, "points": s.points.map { [($0.x * 10).rounded() / 10, ($0.y * 10).rounded() / 10] }]
        }
        let json: [String: Any] = ["id": drawingId.isEmpty ? "m\(Int(ms()))" : drawingId, "startedAt": startedAt, "at": ms(), "active": isOn,
                                   "color": "#C6FF00", "strokes": lines]
        let dir = "\(HOME)/.jevis/marks"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        guard let data = try? JSONSerialization.data(withJSONObject: json) else { return }
        let tmp = "\(file).tmp"
        if (try? data.write(to: URL(fileURLWithPath: tmp))) != nil {
            _ = try? FileManager.default.replaceItemAt(URL(fileURLWithPath: file), withItemAt: URL(fileURLWithPath: tmp))
            if !FileManager.default.fileExists(atPath: file) { try? FileManager.default.moveItem(atPath: tmp, toPath: file) }
        }
    }
}
