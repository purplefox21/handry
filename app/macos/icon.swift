// Draws Foxie's icons from the fox sprite itself (app/foxie/sprites/idle/0001.png):
//   - the app icon, 1024×1024: the fox's head and shoulders, scaled up pixel
//     for pixel (no smoothing), on a deep purple rounded square (purpfox's
//     colour) on the macOS icon grid (824 px body, soft shadow);
//   - the menu bar icon, 36×36: a simple fox head glyph in black (a template
//     image: macOS colours it for light and dark menu bars).
// Usage: icon <sprite.png> <app-icon.png> <menubar.png>
import AppKit

let args = CommandLine.arguments
guard args.count == 4, let sprite = NSImage(contentsOfFile: args[1])?.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("Kullanım: icon <sprite.png> <app-icon.png> <menubar.png>")
    exit(1)
}
let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
let color = { (r: CGFloat, g: CGFloat, b: CGFloat, a: CGFloat) in CGColor(colorSpace: srgb, components: [r, g, b, a])! }

// Where the head is in the 180×146 sitting frame (sprite pixels, top-left origin).
let bust = CGRect(x: 100, y: 24, width: 64, height: 64)   // ears, head, chest

func bitmap(_ w: Int, _ h: Int) -> CGContext {
    CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: srgb,
              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
}

func write(_ ctx: CGContext, _ path: String) {
    let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
}

// MARK: App icon

let icon = bitmap(1024, 1024)
let body = CGRect(x: 100, y: 100, width: 824, height: 824)
let shape = CGPath(roundedRect: body, cornerWidth: 185, cornerHeight: 185, transform: nil)
icon.saveGState()
icon.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: color(0, 0, 0, 0.32))
icon.addPath(shape)
icon.setFillColor(color(0.17, 0.09, 0.30, 1))
icon.fillPath()
icon.restoreGState()

icon.saveGState()
icon.addPath(shape)
icon.clip()
// Night purple, lighter towards the top, with a soft glow behind the head.
let fill = CGGradient(colorsSpace: srgb, colors: [color(0.36, 0.20, 0.62, 1), color(0.13, 0.07, 0.24, 1)] as CFArray, locations: [0, 1])!
icon.drawLinearGradient(fill, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])
let glow = CGGradient(colorsSpace: srgb, colors: [color(1, 0.62, 0.30, 0.30), color(1, 0.62, 0.30, 0)] as CFArray, locations: [0, 1])!
icon.drawRadialGradient(glow, startCenter: CGPoint(x: 512, y: 560), startRadius: 0, endCenter: CGPoint(x: 512, y: 560), endRadius: 420, options: [])
// The bust, 11 screen pixels per sprite pixel, standing on the bottom edge.
let scale: CGFloat = 11
let crop = sprite.cropping(to: bust)!
icon.interpolationQuality = .none
icon.draw(crop, in: CGRect(x: 512 - bust.width * scale / 2 + 20, y: 100, width: bust.width * scale, height: bust.height * scale))
icon.restoreGState()
write(icon, args[2])

// MARK: Menu bar icon (template: only the shape counts)

// A fox head seen from the front, simple enough to read at 18 points: two
// pointed ears, wide cheeks, the chin as the snout, and the eyes left open.
let bar = bitmap(36, 36)
let face = CGMutablePath()
face.addLines(between: [CGPoint(x: 4, y: 34), CGPoint(x: 13, y: 26), CGPoint(x: 23, y: 26), CGPoint(x: 32, y: 34),
                        CGPoint(x: 30, y: 20), CGPoint(x: 34, y: 15), CGPoint(x: 18, y: 2), CGPoint(x: 2, y: 15), CGPoint(x: 6, y: 20)])
face.closeSubpath()
bar.addPath(face)
bar.setFillColor(color(0, 0, 0, 1))
bar.fillPath()
bar.setBlendMode(.clear)
bar.fill(CGRect(x: 10, y: 15, width: 4, height: 4))
bar.fill(CGRect(x: 22, y: 15, width: 4, height: 4))
write(bar, args[3])
