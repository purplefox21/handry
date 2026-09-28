// Draws the JEVIS app icon as a 1024×1024 PNG: a white lightning bolt on a
// blue-to-violet rounded square, on the macOS icon grid (824 px body, soft
// shadow). Usage: icon <out.png>
import AppKit

let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024, bitsPerSample: 8, samplesPerPixel: 4,
                           hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let ctx = NSGraphicsContext.current!.cgContext
let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
let color = { (r: CGFloat, g: CGFloat, b: CGFloat, a: CGFloat) in CGColor(colorSpace: srgb, components: [r, g, b, a])! }

// Body with its drop shadow.
let body = CGRect(x: 100, y: 100, width: 824, height: 824)
let shape = CGPath(roundedRect: body, cornerWidth: 185, cornerHeight: 185, transform: nil)
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: color(0, 0, 0, 0.32))
ctx.addPath(shape)
ctx.setFillColor(color(0.24, 0.55, 1.0, 1))
ctx.fillPath()
ctx.restoreGState()

// Blue (top left) to violet (bottom right), with a soft light from the top.
ctx.saveGState()
ctx.addPath(shape)
ctx.clip()
let fill = CGGradient(colorsSpace: srgb, colors: [color(0.24, 0.55, 1.0, 1), color(0.54, 0.36, 0.96, 1)] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(fill, start: CGPoint(x: 100, y: 924), end: CGPoint(x: 924, y: 100), options: [])
let glow = CGGradient(colorsSpace: srgb, colors: [color(1, 1, 1, 0.24), color(1, 1, 1, 0)] as CFArray, locations: [0, 1])!
ctx.drawRadialGradient(glow, startCenter: CGPoint(x: 512, y: 960), startRadius: 0, endCenter: CGPoint(x: 512, y: 960), endRadius: 640, options: [])
ctx.restoreGState()

// The bolt: the same "zap" shape as in the chat window, on a 24-unit grid.
let points: [(CGFloat, CGFloat)] = [(13, 2), (3, 14), (12, 14), (11, 22), (21, 10), (12, 10)]
let unit: CGFloat = 0.6 * 824 / 24
let bolt = CGMutablePath()
for (i, p) in points.enumerated() {
    let point = CGPoint(x: 512 + (p.0 - 12) * unit, y: 512 - (p.1 - 12) * unit) // y grows upward here
    if i == 0 { bolt.move(to: point) } else { bolt.addLine(to: point) }
}
bolt.closeSubpath()
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -10), blur: 26, color: color(0.12, 0.06, 0.42, 0.45))
ctx.beginTransparencyLayer(auxiliaryInfo: nil) // one shadow for fill and outline together
ctx.addPath(bolt)
ctx.setFillColor(color(1, 1, 1, 1))
ctx.setStrokeColor(color(1, 1, 1, 1))
ctx.setLineJoin(.round)
ctx.setLineWidth(unit * 1.6)
ctx.drawPath(using: .fillStroke)
ctx.endTransparencyLayer()
ctx.restoreGState()

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
