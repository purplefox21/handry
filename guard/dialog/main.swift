// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Handry's own question window, in place of AppleScript's "display dialog":
// a small dark glass card at the top of the screen, under the camera notch
// (or under Handry's bar when it is open). Like osascript it is its own
// process: guard/confirm.js starts it, the answer is the button the user
// clicked, printed on stdout ("timeout" when nobody answered). Nothing else can
// answer it: there is no file or port to write to.
// It does not take the keyboard away from the app the user is in (they may be
// typing a password in Chrome); a click on it is enough. Once clicked, Esc is
// the first button and, for a question ("confirm"), Enter is too.
//
//   handry-dialog confirm|wait <title> <message> <seconds> <button>…
//   (the first button is the "no", the last one the main one)
import Cocoa

let args = CommandLine.arguments
if args.count < 7 || Double(args[4]) == nil {
    FileHandle.standardError.write("usage: handry-dialog confirm|wait <title> <message> <seconds> <button> <button>…\n".data(using: .utf8)!)
    exit(2)
}
let kind = args[1], heading = args[2], message = String(args[3].prefix(1500)), seconds = Double(args[4]) ?? 60, buttons = Array(args[5...])

func answer(_ text: String) -> Never {
    print(text)
    fflush(stdout)
    exit(0)
}

final class Card: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    override func cancelOperation(_ sender: Any?) { answer(buttons[0]) }
}

/// A rounded button: the main one white with black text, the others a faint white.
final class Pill: NSButton {
    let main: Bool
    private var hover = false { didSet { paint() } }

    init(_ title: String, main: Bool) {
        self.main = main
        super.init(frame: .zero)
        self.title = title
        isBordered = false
        wantsLayer = true
        layer?.cornerRadius = 8
        layer?.cornerCurve = .continuous
        attributedTitle = NSAttributedString(string: title, attributes: [
            .font: NSFont.systemFont(ofSize: 13, weight: .medium),
            .foregroundColor: main ? NSColor.black : NSColor.white
        ])
        paint()
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }
    required init?(coder: NSCoder) { fatalError() }

    private func paint() {
        layer?.backgroundColor = (main ? NSColor.white.withAlphaComponent(hover ? 0.85 : 1) : NSColor.white.withAlphaComponent(hover ? 0.2 : 0.12)).cgColor
    }
    override var intrinsicContentSize: NSSize {
        let s = super.intrinsicContentSize
        return NSSize(width: max(s.width + 28, 64), height: 28)
    }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseEntered(with event: NSEvent) { hover = true }
    override func mouseExited(with event: NSEvent) { hover = false }
}

/// Handry's mark: five short bars.
final class Mark: NSView {
    override init(frame: NSRect) {
        super.init(frame: NSRect(x: 0, y: 0, width: 18, height: 14))
        wantsLayer = true
        for (i, h) in [4.0, 8.0, 12.0, 8.0, 4.0].enumerated() {
            let bar = CALayer()
            bar.frame = CGRect(x: 1 + Double(i) * 3.4, y: (14 - h) / 2, width: 2, height: h)
            bar.cornerRadius = 1
            bar.backgroundColor = NSColor.white.withAlphaComponent(0.75).cgColor
            layer?.addSublayer(bar)
        }
    }
    required init?(coder: NSCoder) { fatalError() }
    override var intrinsicContentSize: NSSize { NSSize(width: 18, height: 14) }
}

final class Dialog: NSObject, NSApplicationDelegate {
    var card: Card!

    @objc func pressed(_ sender: NSButton) { answer(sender.title) }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let width: CGFloat = 400
        let title = NSTextField(labelWithString: heading)
        title.font = .systemFont(ofSize: 12, weight: .semibold)
        title.textColor = NSColor.white.withAlphaComponent(0.55)
        let head = NSStackView(views: [Mark(), title])
        head.spacing = 8

        let text = NSTextField(wrappingLabelWithString: message)
        text.font = .systemFont(ofSize: 13.5)
        text.textColor = NSColor.white.withAlphaComponent(0.92)
        text.preferredMaxLayoutWidth = width - 40
        text.isSelectable = false

        let pills = buttons.enumerated().map { i, name -> Pill in
            let p = Pill(name, main: i == buttons.count - 1)
            p.target = self
            p.action = #selector(pressed(_:))
            p.setContentHuggingPriority(.required, for: .horizontal)
            return p
        }
        // a question: Enter means the first button ("Hayır"), as in the old dialog; waiting: Enter does nothing
        if kind == "confirm" { pills[0].keyEquivalent = "\r" }
        let spacer = NSView()
        spacer.setContentHuggingPriority(NSLayoutConstraint.Priority(1), for: .horizontal)
        let row = NSStackView(views: [spacer] + pills)
        row.spacing = 8

        let stack = NSStackView(views: [head, text, row])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 12
        stack.edgeInsets = NSEdgeInsets(top: 16, left: 20, bottom: 16, right: 16)
        stack.setCustomSpacing(16, after: text)
        row.translatesAutoresizingMaskIntoConstraints = false
        row.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -36).isActive = true
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.widthAnchor.constraint(equalToConstant: width).isActive = true

        let glass = NSVisualEffectView()
        glass.material = .hudWindow
        glass.blendingMode = .behindWindow
        glass.state = .active
        glass.appearance = NSAppearance(named: .darkAqua)
        glass.wantsLayer = true
        glass.layer?.cornerRadius = 18
        glass.layer?.cornerCurve = .continuous
        glass.layer?.masksToBounds = true
        glass.layer?.borderWidth = 0.5
        glass.layer?.borderColor = NSColor.white.withAlphaComponent(0.14).cgColor
        glass.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: glass.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: glass.trailingAnchor),
            stack.topAnchor.constraint(equalTo: glass.topAnchor),
            stack.bottomAnchor.constraint(equalTo: glass.bottomAnchor)
        ])
        let size = stack.fittingSize

        card = Card(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        card.contentView = glass
        card.isOpaque = false
        card.backgroundColor = .clear
        card.hasShadow = true
        card.level = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 2)
        card.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        card.hidesOnDeactivate = false
        card.isMovableByWindowBackground = true

        let place = spot(for: size)
        card.setFrame(place.offsetBy(dx: 0, dy: 10), display: false)
        card.alphaValue = 0
        card.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.24
            ctx.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.25, 1)
            card.animator().setFrame(place, display: true)
            card.animator().alphaValue = 1
        }
        if kind == "confirm" { NSSound(named: "Tink")?.play() }
        DispatchQueue.main.asyncAfter(deadline: .now() + max(1, seconds)) { answer("timeout") }
    }

    /// Top middle of the screen the mouse is on: under the notch or the menu bar, or under Handry's bar when
    /// that is open there.
    func spot(for size: NSSize) -> NSRect {
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main ?? NSScreen.screens[0]
        var mid = screen.frame.midX
        var top = screen.frame.maxY - max(screen.frame.maxY - screen.visibleFrame.maxY, 24)
        if #available(macOS 12.0, *), screen.safeAreaInsets.top > 0, let l = screen.auxiliaryTopLeftArea, let r = screen.auxiliaryTopRightArea {
            mid = (l.maxX + r.minX) / 2
            top = screen.frame.maxY - screen.safeAreaInsets.top
        }
        // Handry's bar: its window hangs from the top of this screen, one level over the menu bar
        let barLevel = Int(CGWindowLevelForKey(.statusWindow)) + 1
        let primaryTop = NSScreen.screens.first?.frame.maxY ?? screen.frame.maxY
        if let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] {
            for w in list where (w[kCGWindowLayer as String] as? Int) == barLevel && (w[kCGWindowOwnerName as String] as? String).map({ $0.hasPrefix("Handry") || $0 == "JEVIS" }) == true {
                guard let b = w[kCGWindowBounds as String] as? [String: CGFloat], let x = b["X"], let y = b["Y"], let bw = b["Width"], let bh = b["Height"] else { continue }
                let frame = NSRect(x: x, y: primaryTop - y - bh, width: bw, height: bh) // window bounds count from the top
                if frame.intersects(screen.frame) { top = min(top, frame.minY) }
            }
        }
        return NSRect(x: mid - size.width / 2, y: top - 10 - size.height, width: size.width, height: size.height)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = Dialog()
app.delegate = delegate
app.run()
