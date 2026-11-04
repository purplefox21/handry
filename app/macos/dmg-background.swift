// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Draws the disk image's background: a light card with an arrow from Handry to Applications.
// swift dmg-background.swift <out.tiff-base> : writes <base>.png and <base>@2x.png
import AppKit

func draw(scale: CGFloat, to path: String) {
    let w: CGFloat = 660, h: CGFloat = 420
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(w * scale), pixelsHigh: Int(h * scale), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { exit(1) }
    rep.size = NSSize(width: w, height: h)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSColor(calibratedWhite: 0.93, alpha: 1).setFill()
    NSRect(x: 0, y: 0, width: w, height: h).fill()

    // The arrow, between the two icons (window coordinates: icons sit at y 190 from the top)
    let y = h - 190
    let arrow = NSBezierPath()
    arrow.lineWidth = 5
    arrow.lineCapStyle = .round
    arrow.lineJoinStyle = .round
    arrow.move(to: NSPoint(x: 270, y: y))
    arrow.line(to: NSPoint(x: 390, y: y))
    arrow.move(to: NSPoint(x: 370, y: y + 18))
    arrow.line(to: NSPoint(x: 392, y: y))
    arrow.line(to: NSPoint(x: 370, y: y - 18))
    NSColor(calibratedWhite: 0.45, alpha: 1).setStroke()
    arrow.stroke()

    let para = NSMutableParagraphStyle()
    para.alignment = .center
    let main: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 20, weight: .semibold), .foregroundColor: NSColor(calibratedWhite: 0.15, alpha: 1), .paragraphStyle: para]
    let sub: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 14), .foregroundColor: NSColor(calibratedWhite: 0.4, alpha: 1), .paragraphStyle: para]
    NSAttributedString(string: "Handry'yi Applications'a sürükle", attributes: main).draw(in: NSRect(x: 0, y: h - 72, width: w, height: 30))
    NSAttributedString(string: "Drag Handry to Applications", attributes: sub).draw(in: NSRect(x: 0, y: h - 98, width: w, height: 22))
    NSGraphicsContext.restoreGraphicsState()
    guard let png = rep.representation(using: .png, properties: [:]) else { exit(1) }
    try? png.write(to: URL(fileURLWithPath: path))
}

let base = CommandLine.arguments[1]
draw(scale: 1, to: "\(base).png")
draw(scale: 2, to: "\(base)@2x.png")
