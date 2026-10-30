// Handry's dot at the top of each screen (just under the camera notch on Macs
// that have one; smaller, under the menu bar, on the others) and the lines
// Handry draws to show something: an arrow out of the dot, a circle, an
// underline, a box, a short note. The lines appear by themselves (no pen).
// Nothing here takes clicks.
// A drawing goes when its time is up or as soon as the user clicks or types
// (after a short moment, so it isn't gone before it was seen). Several places
// can come one after another (a sequence: the next one when the last goes).
// What to draw comes from ~/.jevis/overlay.json (hands/overlay.js); the dot
// follows ~/.jevis/activity.json: soft violet when idle, pulsing while Handry
// works, orange when it waits for the user, a green or red blink at the end.
import Cocoa
import QuartzCore

private final class OverlayPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

final class Overlay {
    private struct Screen {
        let panel: NSPanel
        let screen: NSScreen
        let dot: CAShapeLayer
        let dotCenter: CGPoint
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
    private var timer: Timer?
    private let overlayFile = "\(HOME)/.jevis/overlay.json"
    private let activityFile = "\(HOME)/.jevis/activity.json"

    var dotShown: Bool {
        get { UserDefaults.standard.object(forKey: "overlayDot") as? Bool ?? true }
        set {
            UserDefaults.standard.set(newValue, forKey: "overlayDot")
            for s in screens { s.dot.isHidden = !newValue }
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

    /// Where the light sits: on the lower edge of the camera notch (the notch has no pixels, so half of it is
    /// hidden and it looks like light coming out of the notch), or under the menu bar when there is none.
    /// Returns its center and size.
    static func dotPlace(_ s: NSScreen) -> (CGPoint, CGSize) {
        let w = s.frame.width, h = s.frame.height
        if #available(macOS 12.0, *), s.safeAreaInsets.top > 0 {
            var mid = w / 2
            if let l = s.auxiliaryTopLeftArea, let r = s.auxiliaryTopRightArea { mid = (l.maxX + r.minX) / 2 - s.frame.minX }
            return (CGPoint(x: mid, y: h - s.safeAreaInsets.top), CGSize(width: 46, height: 9))
        }
        let bar = s.frame.maxY - s.visibleFrame.maxY
        return (CGPoint(x: w / 2, y: h - max(bar, 22)), CGSize(width: 34, height: 7))
    }

    /// One click-through layer per screen (again when screens change).
    private func build() {
        for s in screens { s.panel.orderOut(nil) }
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
            let (center, size) = Overlay.dotPlace(screen)
            let dot = CAShapeLayer()
            dot.path = CGPath(roundedRect: CGRect(x: -size.width / 2, y: -size.height / 2, width: size.width, height: size.height), cornerWidth: size.height / 2, cornerHeight: size.height / 2, transform: nil)
            dot.position = center
            dot.fillColor = NSColor.systemPurple.cgColor
            dot.opacity = 0.5
            dot.shadowColor = NSColor.systemPurple.cgColor
            dot.shadowRadius = 6
            dot.shadowOpacity = 0
            dot.shadowOffset = .zero
            dot.isHidden = !dotShown
            view.layer?.addSublayer(dot)
            panel.orderFrontRegardless()
            screens.append(Screen(panel: panel, screen: screen, dot: dot, dotCenter: center))
        }
        dotState = ""
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
        guard state != dotState else { return }
        dotState = state
        let color: NSColor = state == "attention" ? .systemOrange : state == "done" ? .systemGreen : state == "error" ? .systemRed : .systemPurple
        for s in screens {
            s.dot.removeAllAnimations()
            s.dot.fillColor = color.cgColor
            s.dot.shadowColor = color.cgColor
            if state == "busy" || state == "attention" {
                s.dot.opacity = 1
                s.dot.shadowOpacity = 0.9
                let glow = CABasicAnimation(keyPath: "shadowRadius")
                glow.fromValue = 3
                glow.toValue = 11
                let light = CABasicAnimation(keyPath: "opacity")
                light.fromValue = 0.55
                light.toValue = 1
                let pulse = CAAnimationGroup()
                pulse.animations = [glow, light]
                pulse.duration = 0.8
                pulse.autoreverses = true
                pulse.repeatCount = .infinity
                s.dot.add(pulse, forKey: "pulse")
            } else {
                s.dot.opacity = state == "idle" ? 0.5 : 1
                s.dot.shadowOpacity = state == "idle" ? 0 : 0.8
            }
        }
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
