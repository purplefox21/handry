// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// The pet that lives on the screen, on a borderless, see-through panel: the
// hand that walks on its fingers (app/hand/sprites, drawn by app/hand/make.mjs)
// or Foxie, a pixel-art red fox (app/foxie/sprites, the user's Blender → pixel
// art pipeline; see app/foxie/TARIF.md). Both are the same kind of sprite set,
// so this code plays either; "the fox" below means whichever it is. Only the
// pet's own pixels take the mouse; everywhere else clicks go to the apps below.
// A loop can have a way in and out ("bored_in", "bored_out"): played around it.
//
// Its own life: sits, walks along the top of the Dock, gets bored, sleeps;
// jumps onto windows and walks along their top edge (and goes with them when
// they move, falls when they close); hangs its paws over a window's corner;
// can be picked up by the tail or the scruff and dropped.
// What Foxie (the assistant) is doing shows on it: "Hey Foxie" → ears up and
// listening; Claude thinking → typing at its little desk; a tool working in an
// app → it runs under that app's window; done → a happy hop; failed → sad.
//
// Units: one sprite pixel is `scale` points on screen; the manifest's speed,
// ground and anchor are in sprite pixels.
import AppKit

// MARK: Sprites

final class FoxSprites {
    struct Anim {
        let name: String
        let fps: Double
        let loop: Bool
        let count: Int
        let next: String?
        let size: CGSize            // sprite pixels
        let anchor: CGPoint?        // sprite pixels from the top left
        let speed: CGFloat          // sprite pixels per second (walk, run)
        let liftoff: Int?           // jump: frame (1-based) where it leaves the ground
        let mirrorAfter: Bool       // turn: faces the other way afterwards
    }

    let dir: URL
    let ground: CGFloat
    let size: CGSize
    private(set) var anims: [String: Anim] = [:]
    private var images: [String: [CGImage?]] = [:]
    private var alphas: [String: [UInt8]] = [:]   // "anim/frame" → alpha bytes (a few, for hit tests)

    init?(dir: URL) {
        guard let data = try? Data(contentsOf: dir.appendingPathComponent("manifest.json")),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let list = json["animations"] as? [String: [String: Any]] else { return nil }
        self.dir = dir
        let frame = json["frame"] as? [Double] ?? [180, 146]
        size = CGSize(width: frame[0], height: frame[1])
        ground = CGFloat(json["ground"] as? Double ?? 128)
        for (name, a) in list {
            let own = a["frame"] as? [Double]
            let anchor = a["anchor"] as? [Double]
            anims[name] = Anim(name: name, fps: a["fps"] as? Double ?? 24, loop: a["loop"] as? Bool ?? false,
                               count: a["frames"] as? Int ?? 1, next: a["next"] as? String,
                               size: own.map { CGSize(width: $0[0], height: $0[1]) } ?? size,
                               anchor: anchor.map { CGPoint(x: $0[0], y: $0[1]) },
                               speed: CGFloat(a["speed"] as? Double ?? 0), liftoff: a["liftoff_frame"] as? Int,
                               mirrorAfter: a["mirror_after"] as? Bool ?? false)
        }
    }

    func image(_ anim: String, _ index: Int) -> CGImage? {
        guard let a = anims[anim] else { return nil }
        if images[anim] == nil { images[anim] = Array(repeating: nil, count: a.count) }
        let i = max(0, min(a.count - 1, index))
        if let img = images[anim]![i] { return img }
        let url = dir.appendingPathComponent(anim).appendingPathComponent(String(format: "%04d.png", i + 1))
        guard let src = CGImageSourceCreateWithURL(url as CFURL, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return nil }
        images[anim]![i] = img
        return img
    }

    /// Is the sprite pixel (x, y from the top left) part of the fox?
    func opaque(_ anim: String, _ index: Int, _ x: Int, _ y: Int) -> Bool {
        guard let img = image(anim, index), x >= 0, y >= 0, x < img.width, y < img.height else { return false }
        let key = "\(anim)/\(index)"
        if alphas[key] == nil {
            if alphas.count > 64 { alphas.removeAll() }
            var px = [UInt8](repeating: 0, count: img.width * img.height * 4)
            let ctx = CGContext(data: &px, width: img.width, height: img.height, bitsPerComponent: 8, bytesPerRow: img.width * 4,
                                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            ctx.draw(img, in: CGRect(x: 0, y: 0, width: img.width, height: img.height))
            alphas[key] = stride(from: 3, to: px.count, by: 4).map { px[$0] }
        }
        return alphas[key]![y * img.width + x] > 0
    }

    /// The fox's opaque columns in a frame (for "grabbed by the tail": the left third or so).
    func opaqueSpan(_ anim: String, _ index: Int) -> ClosedRange<Int>? {
        guard let img = image(anim, index) else { return nil }
        var lo = Int.max, hi = Int.min
        for x in 0..<img.width {
            for y in stride(from: 0, to: img.height, by: 2) where opaque(anim, index, x, y) { lo = min(lo, x); hi = max(hi, x); break }
        }
        return lo <= hi ? lo...hi : nil
    }
}

// MARK: World: the floor and the windows the fox can stand on

struct Platform {
    var x1: CGFloat, x2: CGFloat, y: CGFloat   // AppKit points (bottom-left origin)
    var window: CGWindowID?
}

struct SeenWindow {
    let id: CGWindowID
    let pid: pid_t
    let owner: String
    let frame: CGRect                  // AppKit points
}

/// Other apps' normal windows, front to back (CGWindowList; bounds need no permission).
func visibleWindows() -> [SeenWindow] {
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]],
          let main = NSScreen.screens.first else { return [] }
    let me = ProcessInfo.processInfo.processIdentifier
    return list.compactMap { w in
        guard (w[kCGWindowLayer as String] as? Int) == 0,
              let pid = w[kCGWindowOwnerPID as String] as? pid_t, pid != me,
              let b = w[kCGWindowBounds as String] as? [String: CGFloat],
              let x = b["X"], let y = b["Y"], let width = b["Width"], let height = b["Height"],
              width >= 150, height >= 150, (w[kCGWindowAlpha as String] as? Double ?? 1) > 0.1 else { return nil }
        // CG measures from the top of the main screen; AppKit from its bottom.
        return SeenWindow(id: w[kCGWindowNumber as String] as? CGWindowID ?? 0, pid: pid, owner: w[kCGWindowOwnerName as String] as? String ?? "",
                          frame: CGRect(x: x, y: main.frame.height - y - height, width: width, height: height))
    }
}

// MARK: The panel and its view

final class FoxPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

final class FoxView: NSView {
    weak var fox: FoxPet?
    override func mouseDown(with event: NSEvent) { fox?.mouseDown(NSEvent.mouseLocation) }
    override func mouseDragged(with event: NSEvent) { fox?.mouseDragged(NSEvent.mouseLocation) }
    override func mouseUp(with event: NSEvent) { fox?.mouseUp(NSEvent.mouseLocation) }
    override func rightMouseDown(with event: NSEvent) { fox?.showMenu(event, in: self) }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .openHand) }
}

// MARK: The fox

final class FoxPet {
    enum Mode { case idle, walk, run, stop, turn, special, bored, sleep, desk, listen, jump, air, land, held, hang }

    let sprites: FoxSprites
    let panel: FoxPanel
    let view = FoxView()
    let layer = CALayer()
    var menuProvider: (() -> NSMenu)?

    var scale: CGFloat { didSet { UserDefaults.standard.set(Double(scale), forKey: "foxScale"); place() } }
    private(set) var visible = true

    // State
    private var mode: Mode = .idle
    private var anim = "idle"
    private var frame = 0
    private var frameTime: Double = 0
    private var onEnd: (() -> Void)?
    private var facingRight = true
    private var foot = CGPoint.zero              // the point under the fox's feet (sprite column 90, ground row)
    private var platform = Platform(x1: 0, x2: 0, y: 0, window: nil)
    private var platformOffset: CGFloat = 0      // foot.x - window.minX while standing on a window
    private var targetX: CGFloat?
    private var thenAt: (() -> Void)?
    private var velocity = CGVector.zero
    private var jumpTarget: (Platform, CGFloat)?
    private var decideAt = Date().addingTimeInterval(4)
    private var stayUntil = Date.distantPast     // bored / hang / desk / listen last until
    private var lastMouse = NSEvent.mouseLocation
    private var mouseMovedAt = Date()
    private var windows: [SeenWindow] = []
    private var windowsAt = Date.distantPast
    private var lastTick = CACurrentMediaTime()
    private var timer: Timer?
    private var hidUntilFullScreenEnds = false

    // Mouse
    private var pressAt: CGPoint?
    private var dragging = false
    private var grabOffset = CGPoint.zero

    // Assistant
    private var listening = false
    private var thinkingAt = Date.distantPast   // the last sign that Foxie is working
    private var thinking: Bool {
        get { Date().timeIntervalSince(thinkingAt) < 90 }
        set { thinkingAt = newValue ? Date() : .distantPast }
    }
    private var sleptAt = Date.distantPast

    init?(spritesDir: URL) {
        guard let sprites = FoxSprites(dir: spritesDir) else { return nil }
        self.sprites = sprites
        let saved = UserDefaults.standard.double(forKey: "foxScale")
        scale = saved > 0 ? CGFloat(saved) : ((NSScreen.main?.backingScaleFactor ?? 2) >= 2 ? 0.5 : 1)
        panel = FoxPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        panel.ignoresMouseEvents = true
        panel.isReleasedWhenClosed = false
        view.fox = self
        view.wantsLayer = true
        view.layer = CALayer()
        layer.magnificationFilter = .nearest
        layer.minificationFilter = .nearest
        layer.contentsGravity = .resize
        view.layer?.addSublayer(layer)
        panel.contentView = view
        let floor = screenFloor()
        foot = CGPoint(x: floor.x1 + (floor.x2 - floor.x1) * 0.72, y: floor.y)
        platform = floor
        if !UserDefaults.standard.bool(forKey: "foxHidden") { show() } else { visible = false }
    }

    // MARK: Showing

    func show() {
        visible = true
        UserDefaults.standard.set(false, forKey: "foxHidden")
        place()
        panel.orderFrontRegardless()
        timer?.invalidate()
        lastTick = CACurrentMediaTime()
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(timer!, forMode: .common)
    }

    func hide() {
        visible = false
        UserDefaults.standard.set(true, forKey: "foxHidden")
        timer?.invalidate()
        timer = nil
        panel.orderOut(nil)
    }

    /// Off the screen for good (another pet takes its place); the "hidden" setting stays as it was.
    func retire() {
        visible = false
        timer?.invalidate()
        timer = nil
        panel.orderOut(nil)
        panel.close()
    }

    func screenFloor() -> Platform {
        let screen = NSScreen.screens.first!
        return Platform(x1: screen.visibleFrame.minX, x2: screen.visibleFrame.maxX, y: screen.visibleFrame.minY, window: nil)
    }

    // MARK: Animation

    private func play(_ name: String, mode: Mode, then: (() -> Void)? = nil) {
        guard let a = sprites.anims[name] else { return }
        // A loop with its own way in plays that first (its `next` is the loop).
        if a.loop, anim != name, anim != "\(name)_in", sprites.anims["\(name)_in"] != nil {
            return play("\(name)_in", mode: mode)   // (a loop never ends, so no `then` to keep)
        }
        if anim != name { frame = 0; frameTime = 0 }
        anim = name
        self.mode = mode
        onEnd = then
    }

    /// One-shot animations end in their `next` unless the caller decides.
    private func finishOnce() {
        let a = sprites.anims[anim]!
        if a.mirrorAfter { facingRight.toggle() }
        if let done = onEnd { onEnd = nil; done(); return }
        if let next = a.next, sprites.anims[next] != nil {
            // The way into a loop keeps the loop's mode.
            play(next, mode: anim.hasSuffix("_in") ? mode : next == "sleep" ? .sleep : next == "listen" ? .listen : next == "fall" ? .air : .idle)
        } else {
            play("idle", mode: .idle)
        }
    }

    private func advance(_ dt: Double) {
        guard let a = sprites.anims[anim] else { return }
        frameTime += dt
        let step = 1 / a.fps
        while frameTime >= step {
            frameTime -= step
            if frame + 1 < a.count { frame += 1 }
            else if a.loop { frame = 0 }
            else { finishOnce(); return }
        }
    }

    // MARK: Placing the panel

    private func place() {
        guard let a = sprites.anims[anim], let img = sprites.image(anim, frame) else { return }
        let w = a.size.width * scale, h = a.size.height * scale
        var origin: CGPoint
        if mode == .held, let anchor = a.anchor {
            let ax = facingRight ? anchor.x : a.size.width - 1 - anchor.x
            origin = CGPoint(x: foot.x - ax * scale, y: foot.y - (a.size.height - anchor.y) * scale)
        } else if mode == .hang, let anchor = a.anchor {
            let ax = facingRight ? anchor.x : a.size.width - 1 - anchor.x
            origin = CGPoint(x: foot.x - ax * scale, y: foot.y - (a.size.height - anchor.y) * scale)
        } else {
            origin = CGPoint(x: foot.x - (a.size.width / 2) * scale, y: foot.y - (a.size.height - sprites.ground) * scale)
        }
        origin.x = origin.x.rounded()
        origin.y = origin.y.rounded()
        let rect = CGRect(origin: origin, size: CGSize(width: w, height: h))
        if panel.frame != rect { panel.setFrame(rect, display: false) }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        layer.frame = CGRect(x: 0, y: 0, width: w, height: h)
        layer.contents = img
        layer.transform = facingRight ? CATransform3DIdentity : CATransform3DMakeScale(-1, 1, 1)
        CATransaction.commit()
    }

    // MARK: The clock

    private func tick() {
        let now = CACurrentMediaTime()
        let dt = min(0.1, now - lastTick)
        lastTick = now
        let mouse = NSEvent.mouseLocation
        if mouse != lastMouse { lastMouse = mouse; mouseMovedAt = Date() }
        if Date().timeIntervalSince(windowsAt) > 0.2 { windows = visibleWindows(); windowsAt = Date(); followWindow() }
        if hideForFullScreen() { return }
        advance(dt)
        move(dt)
        if mode == .idle || mode == .bored { decide() }
        if (mode == .bored || mode == .hang || mode == .desk || mode == .listen) && Date() > stayUntil && !listening && !thinking { standUp() }
        // Slept a good while and the mouse is moving again: the user is back.
        if anim == "sleep" {
            if sleptAt == .distantPast { sleptAt = Date() }
            if Date().timeIntervalSince(sleptAt) > 300 && Date().timeIntervalSince(mouseMovedAt) < 1 { sleptAt = .distantPast; play("wake_up", mode: .special) }
        } else if sleptAt != .distantPast {
            sleptAt = .distantPast
        }
        place()
        updateMousePassThrough(mouse)
    }

    /// A full-screen app in front (a video, a game): the fox steps aside until it ends.
    private func hideForFullScreen() -> Bool {
        guard let screen = NSScreen.screens.first, let front = NSWorkspace.shared.frontmostApplication else { return false }
        let full = windows.first { $0.pid == front.processIdentifier && $0.frame.equalTo(screen.frame) } != nil
        if full != hidUntilFullScreenEnds {
            hidUntilFullScreenEnds = full
            if full { panel.orderOut(nil) } else { panel.orderFrontRegardless() }
        }
        return full
    }

    // MARK: Moving

    private func move(_ dt: Double) {
        switch mode {
        case .walk, .run:
            guard let tx = targetX, let a = sprites.anims[anim] else { return }
            let speed = a.speed * scale
            let dir: CGFloat = tx > foot.x ? 1 : -1
            foot.x += dir * speed * CGFloat(dt)
            if (dir > 0 && foot.x >= tx) || (dir < 0 && foot.x <= tx) {
                foot.x = tx
                targetX = nil
                arrived()
            } else if foot.x <= platform.x1 + 10 * scale || foot.x >= platform.x2 - 10 * scale {
                foot.x = max(platform.x1 + 10 * scale, min(platform.x2 - 10 * scale, foot.x))
                targetX = nil
                atEdge()
            }
            if platform.window != nil, let w = windows.first(where: { $0.id == platform.window }) { platformOffset = foot.x - w.frame.minX }
        case .stop:
            // The first ~9 frames of the stop still slide, slowing down.
            if frame < 9, let run = sprites.anims["run"] {
                let left = CGFloat(9 - frame) / 9
                foot.x += (facingRight ? 1 : -1) * run.speed * scale * left * CGFloat(dt)
                foot.x = max(platform.x1 + 10 * scale, min(platform.x2 - 10 * scale, foot.x))
            }
        case .jump:
            if let lift = sprites.anims["jump"]?.liftoff, frame + 1 >= lift, case let (target, tx)? = jumpTarget {
                launch(to: target, x: tx)
            }
        case .air:
            fly(dt)
        default:
            break
        }
    }

    private func arrived() {
        if let then = thenAt { thenAt = nil; then(); return }
        if anim == "run" { play("stop", mode: .stop) } else { play("idle", mode: .idle) }
        decideAt = Date().addingTimeInterval(.random(in: 4...10))
    }

    /// At the end of a window's top edge: turn back, hang over the corner, or jump down.
    private func atEdge() {
        guard platform.window != nil else { play("idle", mode: .idle); return }
        let roll = Double.random(in: 0..<1)
        if roll < 0.35 {
            hang()
        } else if roll < 0.65 {
            velocity = CGVector(dx: (facingRight ? 1 : -1) * 60 * scale, dy: 120 * scale)
            platform = Platform(x1: -1e6, x2: 1e6, y: -1e6, window: nil)
            play("fall", mode: .air)
        } else {
            turn { self.play("idle", mode: .idle) }
        }
    }

    private func hang() {
        guard let w = windows.first(where: { $0.id == platform.window }) else { return }
        facingRight = foot.x > w.frame.midX           // over the right corner: facing right
        foot = CGPoint(x: facingRight ? w.frame.maxX : w.frame.minX, y: w.frame.maxY)
        platformOffset = foot.x - w.frame.minX
        play("edge_hang", mode: .hang)
        stayUntil = Date().addingTimeInterval(.random(in: 20...60))
    }

    private func standUp() {
        if mode == .hang, let w = windows.first(where: { $0.id == platform.window }) {
            foot.x = facingRight ? w.frame.maxX - 40 * scale : w.frame.minX + 40 * scale
            platformOffset = foot.x - w.frame.minX
        }
        // A loop with its own way out ("listen_out") plays it, then idles.
        if sprites.anims["\(anim)_out"] != nil { play("\(anim)_out", mode: .special) } else { play("idle", mode: .idle) }
        decideAt = Date().addingTimeInterval(.random(in: 3...8))
    }

    private func turn(then: @escaping () -> Void) {
        play("turn", mode: .turn, then: then)
    }

    /// Walk (or run, if far) to x on the current platform, turning first if needed.
    private func go(to x: CGFloat, run: Bool? = nil, then: (() -> Void)? = nil) {
        let tx = max(platform.x1 + 12 * scale, min(platform.x2 - 12 * scale, x))
        guard abs(tx - foot.x) > 4 else { then?(); return }
        let fast = run ?? (abs(tx - foot.x) > 300)
        let start = {
            self.targetX = tx
            self.thenAt = then
            self.play(fast ? "run" : "walk", mode: fast ? .run : .walk)
        }
        if (tx > foot.x) != facingRight { turn(then: start) } else { start() }
    }

    // MARK: Jumping and falling

    private func jump(to target: Platform, x: CGFloat) {
        jumpTarget = (target, x)
        if (x > foot.x) != facingRight { turn { self.play("jump", mode: .jump) } } else { play("jump", mode: .jump) }
    }

    private func launch(to target: Platform, x: CGFloat) {
        jumpTarget = nil
        let g = 2000 * scale
        let t: CGFloat = 0.55
        velocity = CGVector(dx: (x - foot.x) / t, dy: (target.y - foot.y + g * t * t / 2) / t)
        platform = Platform(x1: -1e6, x2: 1e6, y: -1e6, window: nil)
        mode = .air   // keeps showing the jump's last frames until it comes down
    }

    private func fly(_ dt: Double) {
        let g = 2000 * scale, maxFall = 1500 * scale
        let before = foot.y
        velocity.dy = max(-maxFall, velocity.dy - g * CGFloat(dt))
        foot.x += velocity.dx * CGFloat(dt)
        foot.y += velocity.dy * CGFloat(dt)
        if velocity.dy < 0 && anim != "fall" { play("fall", mode: .air) }
        guard velocity.dy < 0 else { return }
        // Land on the first thing under the feet: a window's top edge or the floor.
        var floors = windows.compactMap { w -> Platform? in
            topIsOpen(w) ? Platform(x1: w.frame.minX, x2: w.frame.maxX, y: w.frame.maxY, window: w.id) : nil
        }
        floors.append(screenFloor())
        if let landing = floors.filter({ foot.x >= $0.x1 && foot.x <= $0.x2 && before >= $0.y && foot.y <= $0.y }).max(by: { $0.y < $1.y }) {
            foot.y = landing.y
            platform = landing
            if let id = landing.window, let w = windows.first(where: { $0.id == id }) { platformOffset = foot.x - w.frame.minX }
            velocity = .zero
            play("land", mode: .land)
        }
        if let s = NSScreen.screens.first, foot.y < s.frame.minY {
            platform = screenFloor()
            foot = CGPoint(x: max(platform.x1 + 40, min(platform.x2 - 40, foot.x)), y: platform.y)
            play("land", mode: .land)
        }
    }

    /// A window's top edge counts only where no window in front of it covers it.
    private func topIsOpen(_ w: SeenWindow) -> Bool {
        guard let index = windows.firstIndex(where: { $0.id == w.id }) else { return false }
        let probe = CGPoint(x: w.frame.midX, y: w.frame.maxY - 2)
        if windows[..<index].contains(where: { $0.frame.contains(probe) }) { return false }
        guard let screen = NSScreen.screens.first else { return false }
        return w.frame.maxY < screen.visibleFrame.maxY - 120 && w.frame.maxY > screen.visibleFrame.minY + 120
    }

    /// Standing on a window: go with it; fall when it closes, hides or moves away.
    private func followWindow() {
        guard let id = platform.window, mode != .air, mode != .held else { return }
        guard let w = windows.first(where: { $0.id == id }), topIsOpen(w) || mode == .hang else {
            velocity = .zero
            platform = Platform(x1: -1e6, x2: 1e6, y: -1e6, window: nil)
            play("fall", mode: .air)
            return
        }
        platform = Platform(x1: w.frame.minX, x2: w.frame.maxX, y: w.frame.maxY, window: id)
        if mode == .hang {
            foot = CGPoint(x: facingRight ? w.frame.maxX : w.frame.minX, y: w.frame.maxY)
        } else {
            foot = CGPoint(x: w.frame.minX + platformOffset, y: w.frame.maxY)
        }
    }

    // MARK: Deciding what to do

    private func decide() {
        let idleFor = Date().timeIntervalSince(mouseMovedAt)
        if mode == .idle && idleFor > 180 { play("lie_down", mode: .sleep); return }
        if mode == .idle && idleFor > 60 && platform.window == nil {
            play("bored", mode: .bored)
            stayUntil = Date().addingTimeInterval(.random(in: 20...60))
            return
        }
        guard mode == .idle, Date() > decideAt else { return }
        decideAt = Date().addingTimeInterval(.random(in: 4...10))
        let roll = Double.random(in: 0..<1)
        if roll < 0.2, platform.window == nil, let w = windows.filter(topIsOpen).filter({ $0.frame.width > 240 }).randomElement() {
            // Go under the window, then jump onto its top edge.
            let landX = CGFloat.random(in: (w.frame.minX + 60)...(w.frame.maxX - 60))
            let under = max(platform.x1 + 40, min(platform.x2 - 40, landX - (landX > foot.x ? 140 : -140) * scale))
            let target = Platform(x1: w.frame.minX, x2: w.frame.maxX, y: w.frame.maxY, window: w.id)
            go(to: under) { self.jump(to: target, x: landX) }
        } else if roll < 0.6 {
            let span = platform.x2 - platform.x1
            go(to: platform.x1 + CGFloat.random(in: 0.1...0.9) * span, run: false)
        } else if roll < 0.68, platform.window != nil {
            go(to: foot.x < (platform.x1 + platform.x2) / 2 ? platform.x1 : platform.x2, run: false)
        }
        // else: stays sitting
    }

    // MARK: Mouse: pass-through, petting, carrying

    private func spritePixel(_ p: CGPoint) -> (Int, Int)? {
        let f = panel.frame
        guard f.contains(p) else { return nil }
        var x = Int((p.x - f.minX) / scale)
        let y = Int((f.maxY - p.y) / scale)
        if !facingRight, let a = sprites.anims[anim] { x = Int(a.size.width) - 1 - x }
        return (x, y)
    }

    private func updateMousePassThrough(_ mouse: CGPoint) {
        if dragging { return }
        var over = false
        if let (x, y) = spritePixel(mouse) { over = sprites.opaque(anim, frame, x, y) }
        if panel.ignoresMouseEvents == over { panel.ignoresMouseEvents = !over }
    }

    func mouseDown(_ p: CGPoint) {
        pressAt = p
        dragging = false
    }

    func mouseDragged(_ p: CGPoint) {
        guard let start = pressAt else { return }
        if !dragging, hypot(p.x - start.x, p.y - start.y) > 4 {
            dragging = true
            NSCursor.closedHand.push()
            // Grabbed in the tail end (the back third of the fox) → by the tail, else by the scruff.
            var byTail = false
            if let (x, _) = spritePixel(start), let span = sprites.opaqueSpan(anim, frame) {
                // Sprite pixels are always facing right here, so the tail is at the low x end.
                byTail = CGFloat(x - span.lowerBound) < CGFloat(span.count) * 0.35
            }
            platform = Platform(x1: -1e6, x2: 1e6, y: -1e6, window: nil)
            targetX = nil
            play(byTail ? "held_tail" : "held_scruff", mode: .held)
        }
        if dragging { foot = p }
    }

    func mouseUp(_ p: CGPoint) {
        defer { pressAt = nil }
        if dragging {
            dragging = false
            NSCursor.pop()
            // Let go: falls from where the feet would be.
            if let a = sprites.anims[anim], let anchor = a.anchor {
                foot.y = p.y - (a.size.height - anchor.y) * scale + (a.size.height - sprites.ground) * scale
            }
            velocity = .zero
            play("fall", mode: .air)
            return
        }
        // A click: wakes it up, or it enjoys being petted.
        if mode == .sleep {
            play("wake_up", mode: .special)
        } else if mode != .air && mode != .jump {
            targetX = nil
            play(Double.random(in: 0..<1) < 0.75 ? "petted" : "happy", mode: .special)
        }
        mouseMovedAt = Date()
    }

    func showMenu(_ event: NSEvent, in view: NSView) {
        if let menu = menuProvider?() { NSMenu.popUpContextMenu(menu, with: event, for: view) }
    }

    // MARK: What Foxie (the assistant) is doing

    /// "Hey Foxie" heard (or the push-to-talk key): ears up, looks at you, listens.
    func setListening(_ on: Bool) {
        listening = on
        guard visible else { return }
        if on {
            if mode == .sleep { play("wake_up", mode: .special) { self.play("ears_up", mode: .listen) } }
            else if mode != .air && mode != .held { targetX = nil; play("ears_up", mode: .listen) }
            stayUntil = Date().addingTimeInterval(8)
        } else {
            stayUntil = Date().addingTimeInterval(2)
        }
    }

    /// Activity from ~/.jevis/activity.json (written by the server and the Handry tools).
    func react(kind: String, app: String?) {
        guard visible, mode != .held else { return }
        switch kind {
        case "thinking":
            thinking = true
            sitDown("desk", mode: .desk, for: 60)
        case "tool":
            thinking = true
            guard let app, !app.isEmpty, platform.window == nil else { return }
            // Run under the window of the app that is being used.
            if let w = windows.first(where: { window(of: app, is: $0) }) {
                let x = max(w.frame.minX + 40, min(w.frame.maxX - 40, foot.x))
                if abs(x - foot.x) > 60 { go(to: x, run: true) { self.sitDown("desk", mode: .desk, for: 30) } }
            }
        case "done":
            thinking = false
            sitDown("happy", mode: .special, for: 0)
        case "error":
            thinking = false
            sitDown("sad", mode: .special, for: 0)
        case "attention":
            sitDown("ears_up", mode: .listen, for: 15)
        case "idle":
            thinking = false
        default:
            break
        }
    }

    /// The app is a bundle id ("com.google.Chrome") or a name as the user said it.
    private func window(of app: String, is w: SeenWindow) -> Bool {
        if app.contains("."), !app.contains(" ") { return NSRunningApplication(processIdentifier: w.pid)?.bundleIdentifier == app }
        return w.owner.localizedCaseInsensitiveContains(app) || app.localizedCaseInsensitiveContains(w.owner)
    }

    /// Plays a sitting animation where it is (waking up first if it sleeps).
    private func sitDown(_ name: String, mode: Mode, for seconds: Double) {
        guard self.mode != .air, self.mode != .jump, self.mode != .held else { return }
        let start = {
            self.targetX = nil
            self.play(name, mode: mode)
            self.stayUntil = Date().addingTimeInterval(seconds)
        }
        if self.mode == .sleep || anim == "sleep" || anim == "lie_down" { play("wake_up", mode: .special) { start() } }
        else if self.mode == .walk || self.mode == .run { thenAt = nil; targetX = nil; start() }
        else { start() }
    }

    func sleepNow() {
        guard mode != .air, mode != .held else { return }
        targetX = nil
        play("lie_down", mode: .sleep)
    }
}
