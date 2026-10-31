// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Draws the app icon, 1024×1024, from the hand's icon art (app/hand/icon/art.png,
// 64×64, drawn by app/hand/make.mjs): the art scaled up pixel for pixel (no
// smoothing, 11 screen pixels each) on a deep purple rounded square (purpfox's
// colour) on the macOS icon grid (824 px body, soft shadow). The menu bar glyph
// comes ready from make.mjs (app/hand/icon/menubar.png).
// Usage: icon <art.png> <app-icon.png>
import AppKit

let args = CommandLine.arguments
guard args.count == 3, let art = NSImage(contentsOfFile: args[1])?.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("Kullanım: icon <art.png> <app-icon.png>")
    exit(1)
}
let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
let color = { (r: CGFloat, g: CGFloat, b: CGFloat, a: CGFloat) in CGColor(colorSpace: srgb, components: [r, g, b, a])! }

func bitmap(_ w: Int, _ h: Int) -> CGContext {
    CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: srgb,
              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
}

func write(_ ctx: CGContext, _ path: String) {
    let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
}

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
// Night purple, lighter towards the top, with a soft warm glow behind the hand.
let fill = CGGradient(colorsSpace: srgb, colors: [color(0.36, 0.20, 0.62, 1), color(0.13, 0.07, 0.24, 1)] as CFArray, locations: [0, 1])!
icon.drawLinearGradient(fill, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])
let glow = CGGradient(colorsSpace: srgb, colors: [color(1, 0.72, 0.45, 0.26), color(1, 0.72, 0.45, 0)] as CFArray, locations: [0, 1])!
icon.drawRadialGradient(glow, startCenter: CGPoint(x: 512, y: 520), startRadius: 0, endCenter: CGPoint(x: 512, y: 520), endRadius: 420, options: [])
// The hand, 11 screen pixels per art pixel, in the middle.
let scale: CGFloat = 11
let size = CGSize(width: CGFloat(art.width) * scale, height: CGFloat(art.height) * scale)
icon.interpolationQuality = .none
icon.draw(art, in: CGRect(x: 512 - size.width / 2, y: 512 - size.height / 2, width: size.width, height: size.height))
icon.restoreGState()
write(icon, args[2])
