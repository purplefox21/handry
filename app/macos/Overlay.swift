// Handry's island at the top of each screen (black, out of the camera notch on
// Macs that have one; a small black tab at the top edge on the others) and the
// lines Handry draws to show something: an arrow out of the notch, a circle, an
// underline, a box, a short note. The lines appear by themselves (no pen).
// Nothing here takes clicks.
// A drawing goes when its time is up or as soon as the user clicks or types
// (after a short moment, so it isn't gone before it was seen). Several places
// can come one after another (a sequence: the next one when the last goes).
// What to draw comes from ~/.jevis/overlay.json (hands/overlay.js); the island
// follows ~/.jevis/activity.json: wider and a little lower than the notch, a
// small wave on the left and Handry's white hand on the right, both faint and
// still while Handry rests. No colored lights (they look like the camera's):
// the wave moves while it works, the hand waves when Handry waits for the
// user, hops once when it is done, shakes on an error. Menu › the island:
// always there, only while Handry works, or never. A click on it opens the bar.
import Cocoa
import QuartzCore

private final class OverlayPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

/// The camera notch of a screen: its middle (from the screen's left edge), width and height; width and height
/// are 0 on a screen without one.
func notchOf(_ s: NSScreen) -> (mid: CGFloat, width: CGFloat, height: CGFloat) {
    if #available(macOS 12.0, *), s.safeAreaInsets.top > 0, let l = s.auxiliaryTopLeftArea, let r = s.auxiliaryTopRightArea {
        return ((l.maxX + r.minX) / 2 - s.frame.minX, r.minX - l.maxX, s.safeAreaInsets.top)
    }
    return (s.frame.width / 2, 0, 0)
}

/// The outline of something hanging from the top edge of the screen, the way the notch does: flat along the
/// edge, with small inward curves where it meets it, and round lower corners. In a w × h box, origin bottom-left.
func islandPath(width w: CGFloat, height h: CGFloat, ear: CGFloat, radius: CGFloat) -> CGPath {
    let e = max(0, min(ear, h / 2, w / 4))
    let r = max(0, min(radius, (w - 2 * e) / 2, h - e))
    let p = CGMutablePath()
    p.move(to: CGPoint(x: 0, y: h))
    p.addLine(to: CGPoint(x: w, y: h))
    p.addQuadCurve(to: CGPoint(x: w - e, y: h - e), control: CGPoint(x: w - e, y: h))
    p.addLine(to: CGPoint(x: w - e, y: r))
    p.addArc(tangent1End: CGPoint(x: w - e, y: 0), tangent2End: CGPoint(x: e, y: 0), radius: r)
    p.addLine(to: CGPoint(x: e + r, y: 0))
    p.addArc(tangent1End: CGPoint(x: e, y: 0), tangent2End: CGPoint(x: e, y: h), radius: r)
    p.addLine(to: CGPoint(x: e, y: h - e))
    p.addQuadCurve(to: CGPoint(x: 0, y: h), control: CGPoint(x: e, y: h))
    p.closeSubpath()
    return p
}

/// The menu bar's hand (menubar.png, a template image), white: a layer masked by it. Without the image, a white dot.
private func whiteHand(size: CGFloat) -> CALayer {
    let hand = CALayer()
    hand.bounds = CGRect(x: 0, y: 0, width: size, height: size)
    hand.backgroundColor = NSColor.white.cgColor
    if let url = Bundle.main.url(forResource: "menubar", withExtension: "png"), let image = NSImage(contentsOf: url),
       let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) {
        let mask = CALayer()
        mask.frame = hand.bounds
        mask.contents = cg
        mask.contentsGravity = .resizeAspect
        hand.mask = mask
    } else {
        hand.bounds = CGRect(x: 0, y: 0, width: 6, height: 6)
        hand.cornerRadius = 3
    }
    return hand
}

/// The island on one screen. Closed, it is exactly the notch (so it can't be seen) and then fades out.
/// Out, it hangs a little lower than the notch, so it is seen coming out of it. Working, it has a wing on
/// each side: a small wave on the left, Handry's hand on the right. Resting on a notch only a narrow wing
/// with the hand is out, on the right, so less of the app's menus is covered (a screen without a notch has
/// room in the middle of its menu bar, so there both wings stay out, faint).
private final class Island {
    enum Mood { case resting, working, waiting, done, failed }
    private enum Form { case closed, hand, full }
    static let ear: CGFloat = 7
    static let wing: CGFloat = 30
    static let restWing: CGFloat = 24
    let root = CALayer()
    private let shape = CAShapeLayer()
    private let hand: CALayer
    private let wave = CAReplicatorLayer()
    let notchWidth: CGFloat
    let height: CGFloat       // out: a little lower than the notch, so it is seen coming out of it
    let closedHeight: CGFloat // closed: the notch itself
    let maxWidth: CGFloat
    private let mid: CGFloat, top: CGFloat
    private var form = Form.closed

    init(screen s: NSScreen) {
        let notch = notchOf(s)
        notchWidth = notch.width
        closedHeight = notch.height > 0 ? notch.height : 22
        height = notch.height > 0 ? notch.height + 9 : max(s.frame.maxY - s.visibleFrame.maxY, 22) + 6
        hand = whiteHand(size: 12)
        let core = notch.width > 0 ? notch.width : 8
        maxWidth = core + 2 * Island.wing + 2 * Island.ear
        mid = notch.mid
        top = s.frame.height
        let y = top - height / 2
        root.frame = CGRect(origin: .zero, size: s.frame.size)
        shape.frame = CGRect(x: notch.mid - maxWidth / 2, y: top - height, width: maxWidth, height: height)
        shape.fillColor = NSColor.black.cgColor
        shape.path = path(.closed)
        shape.opacity = 0
        root.addSublayer(shape)
        let side = core / 2 + Island.wing / 2
        hand.anchorPoint = CGPoint(x: 0.5, y: 0.15) // the wrist: it waves from there
        hand.position = handPlace(.full)
        hand.opacity = 0
        root.addSublayer(hand)
        let bar = CALayer()
        bar.frame = CGRect(x: 0, y: 0, width: 2.4, height: 10)
        bar.backgroundColor = NSColor.white.cgColor
        bar.cornerRadius = 1.2
        bar.transform = CATransform3DMakeScale(1, 0.4, 1)
        wave.instanceCount = 3
        wave.instanceTransform = CATransform3DMakeTranslation(4.2, 0, 0)
        wave.instanceDelay = 0.15
        wave.addSublayer(bar)
        wave.frame = CGRect(x: notch.mid - side - 5, y: y - 5, width: 11, height: 10)
        wave.opacity = 0
        root.addSublayer(wave)
    }

    /// The outline for a form, in the layer (which is as wide and tall as the island at its biggest, the notch
    /// in its middle).
    private func path(_ form: Form) -> CGPath {
        let core = notchWidth > 0 ? notchWidth : 8
        let left: CGFloat, right: CGFloat, h: CGFloat
        switch form {
        case .closed: (left, right, h) = (core / 2, core / 2, closedHeight)
        case .hand: (left, right, h) = (core / 2, core / 2 + Island.restWing, height)
        case .full: (left, right, h) = (core / 2 + Island.wing, core / 2 + Island.wing, height)
        }
        let p = islandPath(width: left + right + 2 * Island.ear, height: h, ear: Island.ear, radius: min(14, h / 2))
        var t = CGAffineTransform(translationX: maxWidth / 2 - left - Island.ear, y: height - h)
        return p.copy(using: &t) ?? p
    }

    /// Where the hand's wrist goes: in the middle of the right wing (the narrow one while resting).
    private func handPlace(_ form: Form) -> CGPoint {
        let size = hand.bounds.height
        let wing = form == .hand ? Island.restWing : Island.wing
        return CGPoint(x: mid + (notchWidth > 0 ? notchWidth : 8) / 2 + wing / 2, y: top - height / 2 - size * 0.35)
    }

    /// Where a click opens (or closes) the bar, from the screen's bottom-left: what can be seen of the island.
    /// With the bar open over a notch, the notch itself (the bar's empty top), so a click there closes it.
    func clickRect(barOpen: Bool) -> CGRect {
        let core = notchWidth > 0 ? notchWidth : 8
        if barOpen && notchWidth > 0 { return CGRect(x: mid - core / 2, y: top - closedHeight, width: core, height: closedHeight) }
        switch form {
        case .closed: return .zero
        case .hand: return CGRect(x: mid - core / 2, y: top - height, width: core + Island.restWing + Island.ear, height: height)
        case .full: return CGRect(x: mid - maxWidth / 2, y: top - height, width: maxWidth, height: height)
        }
    }

    private func fade(_ layer: CALayer, to value: Float, delay: Double = 0, duration: Double = 0.18) {
        let a = CABasicAnimation(keyPath: "opacity")
        a.fromValue = layer.presentation()?.opacity ?? layer.opacity
        a.toValue = value
        a.beginTime = CACurrentMediaTime() + delay
        a.duration = duration
        a.fillMode = .backwards
        layer.opacity = value
        layer.add(a, forKey: "fade")
    }

    /// What the hand does: still while Handry rests or works, waving while it waits for the user, one hop
    /// when it is done, a shake on an error.
    private func move(_ mood: Mood, delay: Double) {
        hand.removeAnimation(forKey: "move")
        switch mood {
        case .resting, .working:
            return
        case .waiting:
            let a = CAKeyframeAnimation(keyPath: "transform.rotation.z")
            a.values = [0, 0.38, -0.12, 0.38, 0, 0]
            a.keyTimes = [0, 0.15, 0.3, 0.45, 0.6, 1]
            a.duration = 1.6
            a.repeatCount = .infinity
            a.beginTime = CACurrentMediaTime() + delay
            hand.add(a, forKey: "move")
        case .done:
            let a = CAKeyframeAnimation(keyPath: "transform.translation.y")
            a.values = [0, 3.5, 0, 1.2, 0]
            a.duration = 0.55
            a.beginTime = CACurrentMediaTime() + delay
            hand.add(a, forKey: "move")
        case .failed:
            let a = CAKeyframeAnimation(keyPath: "transform.translation.x")
            a.values = [0, -2.5, 2.5, -2, 2, 0]
            a.duration = 0.45
            a.beginTime = CACurrentMediaTime() + delay
            hand.add(a, forKey: "move")
        }
    }

    /// open: the island is out (resting or not). mood: what the hand does, whether the wave moves, and
    /// whether the wave's wing is out at all.
    func set(open: Bool, mood: Mood) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }
        let was = form
        let next: Form = !open ? .closed : (mood == .resting && notchWidth > 0) ? .hand : .full
        let waving = mood == .working
        let bar = wave.sublayers?.first
        if waving, bar?.animation(forKey: "wave") == nil {
            let a = CABasicAnimation(keyPath: "transform.scale.y")
            a.fromValue = 0.35
            a.toValue = 1
            a.duration = 0.45
            a.autoreverses = true
            a.repeatCount = .infinity
            a.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            bar?.add(a, forKey: "wave")
        } else if !waving {
            bar?.removeAnimation(forKey: "wave")
        }
        if open {
            let delay = was == .closed ? 0.18 : 0
            move(mood, delay: delay + 0.12)
            fade(hand, to: mood == .resting ? 0.5 : 0.92, delay: delay)
            fade(wave, to: next == .full ? (waving ? 0.9 : 0.35) : 0, delay: next == .full && was != .full ? 0.18 : 0, duration: next == .full ? 0.18 : 0.1)
        }
        guard next != was else { return }
        form = next
        if next != .closed && hand.position != handPlace(next) {
            let slide = CABasicAnimation(keyPath: "position")
            slide.fromValue = was == .closed ? handPlace(next) : (hand.presentation()?.position ?? hand.position)
            slide.toValue = handPlace(next)
            slide.duration = 0.3
            slide.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.25, 1)
            hand.position = handPlace(next)
            hand.add(slide, forKey: "slide")
        }
        let grow = CASpringAnimation(keyPath: "path")
        grow.fromValue = shape.presentation()?.path ?? shape.path
        grow.toValue = path(next)
        if next != .closed {
            grow.damping = 15
            grow.stiffness = 210
            grow.duration = grow.settlingDuration
            if was == .closed {
                shape.removeAnimation(forKey: "fade")
                shape.opacity = 1
                if notchWidth == 0 { fade(shape, to: 1, duration: 0.2) }
            }
        } else {
            grow.damping = 30
            grow.stiffness = 300
            grow.duration = 0.3
            fade(hand, to: 0, duration: 0.12)
            fade(wave, to: 0, duration: 0.12)
            // the notch hides the closed island; then it goes for good (a screen without a notch fades it at once)
            fade(shape, to: 0, delay: notchWidth > 0 ? 0.3 : 0, duration: notchWidth > 0 ? 0.01 : 0.25)
        }
        shape.path = path(next)
        shape.add(grow, forKey: "grow")
    }
}

/// The panel over the notch. It may take a click without making Handry the active app (a panel that can't
/// become key would activate it), so the app the user was in stays in front.
private final class NotchPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

/// The notch itself (on a screen without one, the middle of the top edge): a click there opens or closes the bar.
private final class NotchTarget: NSView {
    var onClick: () -> Void = {}
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) {
        onClick()
        // give the keyboard back: an invisible panel must not keep it
        DispatchQueue.main.async { [weak w = window] in
            guard let w, w.isKeyWindow else { return }
            w.orderOut(nil)
            w.orderFrontRegardless()
        }
    }
}

final class Overlay {
    /// A click on the notch.
    var onNotchClick: () -> Void = {}
    private var islandShown = false
    /// Handry's bar is open (on a screen without a notch it covers the island's place, so that click is off).
    var barOpen = false { didSet { updateTargets() } }

    private struct Screen {
        let panel: NSPanel
        let screen: NSScreen
        let island: Island
        let dotCenter: CGPoint
        let target: NSPanel // takes a click on the island
    }

    private var screens: [Screen] = []
    private var drawn: [String: [CALayer]] = [:]
    private var expires: [String: Double] = [:]
    private var occupied: [String: (panel: NSPanel, rects: [CGRect])] = [:] // what each drawing covers, so notes don't land on each other
    private var known: Set<String> = []                 // drawings already taken from the file
    private var queue: [String: [[String: Any]]] = [:]   // a sequence → its steps still to come
    private var showing: [String: String] = [:]          // a sequence → its step on screen
    private var groupOf: [String: String] = [:]
    private var shownAt: [String: Double] = [:]
    private func ms() -> Double { Date().timeIntervalSince1970 * 1000 }
    private var overlayStamp: Date?
    private var activityStamp: Date?
    private var activityAt: Double = 0
    private var dotState = ""
    private var dotMode = ""
    private var timer: Timer?
    private let overlayFile = "\(HOME)/.jevis/overlay.json"
    private let activityFile = "\(HOME)/.jevis/activity.json"

    /// When the island shows: "always", "working" (only while Handry works) or "never". Before there was a
    /// choice, the dot could only be turned off ("overlayDot": false), which is "never" now.
    var islandMode: String {
        get {
            if let m = UserDefaults.standard.string(forKey: "islandMode"), ["always", "working", "never"].contains(m) { return m }
            return (UserDefaults.standard.object(forKey: "overlayDot") as? Bool ?? true) ? "always" : "never"
        }
        set {
            UserDefaults.standard.set(newValue, forKey: "islandMode")
            readActivity()
        }
    }

    /// Only what can be seen of the island takes clicks; with the island in, the notch is just the notch.
    private func updateTargets() {
        for s in screens {
            let rect = s.island.clickRect(barOpen: barOpen)
            let on = islandShown && rect.width > 0 && (notchOf(s.screen).height > 0 || !barOpen)
            if on { s.target.setFrame(rect.offsetBy(dx: s.screen.frame.minX, dy: s.screen.frame.minY), display: false) }
            s.target.ignoresMouseEvents = !on
        }
    }

    init() {
        build()
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in self?.build() }
        timer = Timer.scheduledTimer(withTimeInterval: 0.12, repeats: true) { [weak self] _ in self?.tick() }
        // the user doing something (anywhere, or in Handry's own windows) takes the drawings away
        NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .keyDown]) { [weak self] _ in self?.userActed() }
        NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .keyDown]) { [weak self] event in self?.userActed(); return event }
    }

    /// A click or a key: what has been on screen for a moment goes (a sequence moves on to its next step).
    private func userActed() {
        let now = ms()
        for id in Array(drawn.keys) where now - (shownAt[id] ?? now) > 800 { remove(id) }
    }

    /// Where arrows start: the middle of the camera notch's lower edge, or under the menu bar when there is none.
    static func dotPlace(_ s: NSScreen) -> CGPoint {
        let notch = notchOf(s)
        if notch.height > 0 { return CGPoint(x: notch.mid, y: s.frame.height - notch.height) }
        let bar = s.frame.maxY - s.visibleFrame.maxY
        return CGPoint(x: notch.mid, y: s.frame.height - max(bar, 22))
    }

    /// One click-through layer per screen (again when screens change).
    private func build() {
        for s in screens { s.panel.orderOut(nil) }
        for s in screens { s.target.orderOut(nil) }
        screens = []
        drawn = [:]
        expires = [:]
        occupied = [:]
        known = []
        queue = [:]
        showing = [:]
        groupOf = [:]
        shownAt = [:]
        overlayStamp = nil
        for screen in NSScreen.screens {
            let panel = OverlayPanel(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            panel.level = .statusBar
            panel.isOpaque = false
            panel.backgroundColor = .clear
            panel.hasShadow = false
            panel.ignoresMouseEvents = true
            panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
            let view = NSView(frame: NSRect(origin: .zero, size: screen.frame.size))
            view.wantsLayer = true
            panel.contentView = view
            panel.setFrame(screen.frame, display: false)
            let island = Island(screen: screen)
            view.layer?.addSublayer(island.root)
            panel.orderFrontRegardless()
            // the click target: see-through, as big as what can be seen of the island (updateTargets)
            let target = NotchPanel(contentRect: NSRect(x: screen.frame.minX, y: screen.frame.maxY - 1, width: 1, height: 1), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            target.level = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 2)
            target.isOpaque = false
            target.backgroundColor = .clear
            target.hasShadow = false
            target.ignoresMouseEvents = true
            target.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
            let catcher = NotchTarget(frame: NSRect(x: 0, y: 0, width: 1, height: 1))
            catcher.autoresizingMask = [.width, .height]
            catcher.onClick = { [weak self] in self?.onNotchClick() }
            target.contentView = catcher
            target.orderFrontRegardless()
            screens.append(Screen(panel: panel, screen: screen, island: island, dotCenter: Overlay.dotPlace(screen), target: target))
        }
        dotState = ""
        dotMode = ""
        readActivity()
    }

    private func modDate(_ path: String) -> Date? {
        (try? FileManager.default.attributesOfItem(atPath: path))?[.modificationDate] as? Date
    }

    private func tick() {
        let now = Date().timeIntervalSince1970 * 1000
        for (id, until) in expires where until < now { remove(id) }
        if let m = modDate(overlayFile), m != overlayStamp { overlayStamp = m; readOverlay() }
        if let m = modDate(activityFile), m != activityStamp { activityStamp = m; readActivity() }
        // a run that ended without saying so: back to idle after a while
        if (dotState == "busy" || dotState == "attention"), now - activityAt > 90_000 { setDot("idle") }
    }

    // MARK: The dot

    private func readActivity() {
        guard let data = FileManager.default.contents(atPath: activityFile),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return setDot("idle") }
        activityAt = (json["at"] as? Double) ?? 0
        setDot(json["kind"] as? String ?? "idle")
    }

    private func setDot(_ kind: String) {
        let state: String
        switch kind {
        case "thinking", "tool": state = "busy"
        case "attention": state = "attention"
        case "done": state = "done"
        case "error": state = "error"
        default: state = "idle"
        }
        let mode = islandMode
        guard state != dotState || mode != dotMode else { return }
        dotState = state
        dotMode = mode
        islandShown = mode == "always" || (mode == "working" && state != "idle")
        let mood: Island.Mood = state == "attention" ? .waiting : state == "done" ? .done : state == "error" ? .failed : state == "busy" ? .working : .resting
        for s in screens { s.island.set(open: islandShown, mood: mood) }
        updateTargets()
        if state == "done" || state == "error" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
                if self?.dotState == state { self?.setDot("idle") }
            }
        }
    }

    // MARK: Drawings

    private func number(_ v: Any?) -> CGFloat { CGFloat((v as? NSNumber)?.doubleValue ?? 0) }

    /// "#RRGGBB" (picked by hands/overlay.js to stand out from what is under the drawing) or a color name.
    private func color(_ name: String?) -> NSColor {
        if let name, name.hasPrefix("#"), name.count == 7, let v = Int(name.dropFirst(), radix: 16) {
            return NSColor(srgbRed: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
        }
        switch name {
        case "orange": return .systemOrange
        case "red": return .systemRed
        case "green": return .systemGreen
        case "blue": return .systemBlue
        default: return .systemPurple
        }
    }

    private func readOverlay() {
        guard let data = FileManager.default.contents(atPath: overlayFile),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let shapes = json["shapes"] as? [[String: Any]] else { return }
        let now = ms()
        let ids = Set(shapes.compactMap { $0["id"] as? String })
        // cleared from the file: off the screen and out of the sequences
        for id in Array(drawn.keys) where !ids.contains(id) { remove(id, advance: false) }
        for g in Array(queue.keys) { queue[g] = queue[g]?.filter { ids.contains($0["id"] as? String ?? "") } }
        known = known.intersection(ids)
        for s in shapes {
            guard let id = s["id"] as? String, !known.contains(id) else { continue }
            known.insert(id)
            if let until = s["until"] as? Double, until < now { continue }
            if let g = s["group"] as? String { queue[g, default: []].append(s) } else { show(s) }
        }
        for g in Array(queue.keys) where showing[g] == nil { next(g) }
    }

    /// Puts one drawing on the screen; its time (seconds) counts from now.
    private func show(_ s: [String: Any]) {
        guard let id = s["id"] as? String, let r = s["rect"] as? [String: Any] else { return }
        let rect = CGRect(x: number(r["x"]), y: number(r["y"]), width: number(r["w"]), height: number(r["h"]))
        draw(id: id, kind: s["kind"] as? String ?? "arrow", rect: rect, note: s["text"] as? String, color: color(s["color"] as? String))
        let now = ms()
        shownAt[id] = now
        expires[id] = now + ((s["seconds"] as? NSNumber)?.doubleValue ?? 5) * 1000
        if let g = s["group"] as? String { groupOf[id] = g; showing[g] = id }
    }

    /// The next step of a sequence, if there is one.
    private func next(_ g: String) {
        guard showing[g] == nil, var steps = queue[g], !steps.isEmpty else { if queue[g]?.isEmpty == true { queue[g] = nil }; return }
        steps.sort { (($0["order"] as? NSNumber)?.intValue ?? 0) < (($1["order"] as? NSNumber)?.intValue ?? 0) }
        let step = steps.removeFirst()
        queue[g] = steps
        show(step)
    }

    /// Global top-left points (what the Mac hands use) → the screen they are on and points in its layer.
    private func locate(_ r: CGRect) -> (Screen, CGRect)? {
        let mainH = NSScreen.screens.first?.frame.height ?? 0
        let cocoa = CGRect(x: r.minX, y: mainH - r.maxY, width: r.width, height: r.height)
        let center = CGPoint(x: cocoa.midX, y: cocoa.midY)
        guard let s = screens.first(where: { $0.screen.frame.contains(center) }) ?? screens.first else { return nil }
        return (s, cocoa.offsetBy(dx: -s.screen.frame.minX, dy: -s.screen.frame.minY))
    }

    /// A line that draws itself from start to end.
    private func line(_ path: CGPath, _ color: NSColor, in root: CALayer, duration: Double, delay: Double = 0) -> CAShapeLayer {
        let l = CAShapeLayer()
        l.path = path
        l.strokeColor = color.cgColor
        l.fillColor = nil
        l.lineWidth = 3.5
        l.lineCap = .round
        l.lineJoin = .round
        l.shadowColor = NSColor.black.cgColor
        l.shadowOpacity = 0.35
        l.shadowRadius = 2
        l.shadowOffset = .zero
        l.strokeEnd = 0
        root.addSublayer(l)
        let a = CABasicAnimation(keyPath: "strokeEnd")
        a.fromValue = 0
        a.toValue = 1
        a.duration = duration
        a.beginTime = CACurrentMediaTime() + delay
        a.fillMode = .forwards
        a.isRemovedOnCompletion = false
        a.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        l.add(a, forKey: "draw")
        return l
    }

    private func draw(id: String, kind: String, rect: CGRect, note: String?, color: NSColor) {
        guard let (s, r) = locate(rect), let root = s.panel.contentView?.layer else { return }
        var layers: [CALayer] = []
        var noteDelay = 0.35
        switch kind {
        case "circle":
            // a little uneven and a bit past where it started, like a hand
            let c = CGPoint(x: r.midX, y: r.midY), rx = r.width / 2 + 12, ry = r.height / 2 + 9
            let p = CGMutablePath()
            let start = CGFloat.pi * 0.85
            for i in 0...72 {
                let t = start + CGFloat(i) / 72 * (2 * .pi + 0.45)
                let wobble = 1 + 0.035 * sin(3 * t + 1.3)
                let pt = CGPoint(x: c.x + cos(t) * rx * wobble, y: c.y + sin(t) * ry * wobble)
                if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
            }
            layers.append(line(p, color, in: root, duration: 0.55))
            noteDelay = 0.5
        case "underline":
            let p = CGMutablePath()
            p.move(to: CGPoint(x: r.minX - 4, y: r.minY - 5))
            p.addQuadCurve(to: CGPoint(x: r.maxX + 4, y: r.minY - 6), control: CGPoint(x: r.midX, y: r.minY - 9))
            layers.append(line(p, color, in: root, duration: 0.35))
        case "box":
            layers.append(line(CGPath(roundedRect: r.insetBy(dx: -7, dy: -6), cornerWidth: 8, cornerHeight: 8, transform: nil), color, in: root, duration: 0.6))
            noteDelay = 0.55
        case "note":
            noteDelay = 0
        default: // arrow: out of the dot, ending at the edge of the thing
            let start = CGPoint(x: s.dotCenter.x, y: s.dotCenter.y - 5)
            let box = r.insetBy(dx: -8, dy: -8)
            let c = CGPoint(x: box.midX, y: box.midY)
            var end = CGPoint(x: c.x, y: box.maxY)
            let dx = start.x - c.x, dy = start.y - c.y
            if !box.contains(start), dx != 0 || dy != 0 {
                let t = min(dx == 0 ? .infinity : abs(box.width / 2 / dx), dy == 0 ? .infinity : abs(box.height / 2 / dy))
                end = CGPoint(x: c.x + dx * t, y: c.y + dy * t)
            }
            let len = hypot(end.x - start.x, end.y - start.y)
            let mid = CGPoint(x: (start.x + end.x) / 2, y: (start.y + end.y) / 2)
            let perp = len > 0 ? CGPoint(x: -(end.y - start.y) / len, y: (end.x - start.x) / len) : .zero
            let control = CGPoint(x: mid.x + perp.x * len * 0.18, y: mid.y + perp.y * len * 0.18)
            let p = CGMutablePath()
            p.move(to: start)
            p.addQuadCurve(to: end, control: control)
            layers.append(line(p, color, in: root, duration: 0.5))
            // the head follows the curve's last direction
            let tx = end.x - control.x, ty = end.y - control.y, tl = max(hypot(tx, ty), 0.001)
            let ux = tx / tl, uy = ty / tl, size: CGFloat = 15, angle: CGFloat = 0.5
            let head = CGMutablePath()
            head.move(to: CGPoint(x: end.x - size * (ux * cos(angle) - uy * sin(angle)), y: end.y - size * (uy * cos(angle) + ux * sin(angle))))
            head.addLine(to: end)
            head.addLine(to: CGPoint(x: end.x - size * (ux * cos(-angle) - uy * sin(-angle)), y: end.y - size * (uy * cos(-angle) + ux * sin(-angle))))
            layers.append(line(head, color, in: root, duration: 0.15, delay: 0.5))
            noteDelay = 0.6
        }
        if let note, !note.isEmpty {
            // a label in the drawing's color with plain rounded type: readable on anything
            let base = NSFont.systemFont(ofSize: 15, weight: .semibold)
            let font = base.fontDescriptor.withDesign(.rounded).flatMap { NSFont(descriptor: $0, size: 15) } ?? base
            let rgb = color.usingColorSpace(.sRGB) ?? color
            let light = 0.299 * rgb.redComponent + 0.587 * rgb.greenComponent + 0.114 * rgb.blueComponent > 0.62
            let text = NSAttributedString(string: note, attributes: [.font: font, .foregroundColor: light ? NSColor.black : NSColor.white])
            let textSize = text.size()
            let size = CGSize(width: ceil(textSize.width) + 22, height: ceil(textSize.height) + 8)
            let t = CALayer()
            t.backgroundColor = color.withAlphaComponent(0.95).cgColor
            t.cornerRadius = size.height / 2
            t.shadowColor = NSColor.black.cgColor
            t.shadowOpacity = 0.3
            t.shadowRadius = 6
            t.shadowOffset = CGSize(width: 0, height: -1)
            let words = CATextLayer()
            words.string = text
            words.contentsScale = s.screen.backingScaleFactor
            words.alignmentMode = .center
            words.frame = CGRect(x: 0, y: (size.height - ceil(textSize.height)) / 2 - 0.5, width: size.width, height: ceil(textSize.height) + 1)
            t.addSublayer(words)
            // beside the thing, not on it, and not on another drawing: the first free place of right, above,
            // left, below (an underline's note goes under it first)
            let screenW = s.screen.frame.width, screenH = s.screen.frame.height
            let right = CGPoint(x: r.maxX + 18, y: r.midY - size.height / 2)
            let left = CGPoint(x: r.minX - 18 - size.width, y: r.midY - size.height / 2)
            let above = CGPoint(x: r.midX - size.width / 2, y: r.maxY + 16)
            let below = CGPoint(x: r.midX - size.width / 2, y: r.minY - 18 - size.height)
            let order: [CGPoint] = kind == "note" ? [CGPoint(x: r.midX - size.width / 2, y: r.midY - size.height / 2)]
                : kind == "underline" ? [below, right, left, above] : [right, above, left, below]
            let taken = occupied.values.filter { $0.panel === s.panel }.flatMap { $0.rects }
            let fits = { (p: CGPoint) -> Bool in p.x >= 8 && p.x + size.width <= screenW - 8 && p.y >= 8 && p.y + size.height <= screenH - 40 }
            let free = { (p: CGPoint) -> Bool in !taken.contains { $0.intersects(CGRect(origin: p, size: size)) } }
            var origin = order.first { fits($0) && free($0) } ?? order.first(where: fits) ?? order[0]
            origin.x = max(8, min(screenW - size.width - 12, origin.x))
            origin.y = max(8, min(screenH - size.height - 40, origin.y))
            occupied[id, default: (s.panel, [])].rects.append(CGRect(origin: origin, size: size))
            t.frame = CGRect(origin: origin, size: size)
            t.opacity = 0
            root.addSublayer(t)
            let a = CABasicAnimation(keyPath: "opacity")
            a.fromValue = 0
            a.toValue = 1
            a.duration = 0.3
            a.beginTime = CACurrentMediaTime() + noteDelay
            a.fillMode = .forwards
            a.isRemovedOnCompletion = false
            t.add(a, forKey: "in")
            layers.append(t)
        }
        occupied[id, default: (s.panel, [])].rects.append(r.insetBy(dx: kind == "note" ? 0 : -12, dy: kind == "note" ? 0 : -10))
        drawn[id] = layers
    }

    private func remove(_ id: String, advance: Bool = true) {
        expires.removeValue(forKey: id)
        occupied.removeValue(forKey: id)
        shownAt.removeValue(forKey: id)
        if let g = groupOf.removeValue(forKey: id) {
            showing[g] = nil
            if advance { DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in self?.next(g) } }
        }
        guard let layers = drawn.removeValue(forKey: id) else { return }
        CATransaction.begin()
        CATransaction.setCompletionBlock { layers.forEach { $0.removeFromSuperlayer() } }
        for l in layers {
            let a = CABasicAnimation(keyPath: "opacity")
            a.fromValue = l.presentation()?.opacity ?? 1
            a.toValue = 0
            a.duration = 0.35
            a.fillMode = .forwards
            a.isRemovedOnCompletion = false
            l.add(a, forKey: "out")
        }
        CATransaction.commit()
    }
}
