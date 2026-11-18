import AppKit

// Presentation only: real renderer pixels, rounded window mask, standard macOS
// traffic-light geometry in the space reserved by createStudioWindow, and shadow.
// No screen capture, displayed window, application activation or user input.
let args = CommandLine.arguments
precondition(args.count == 3, "usage: frame-readme input.png output.png")
let source = NSImage(contentsOfFile: args[1])!
let width: CGFloat = 1440, height: CGFloat = 900
let margin: CGFloat = 48, scale: CGFloat = 2
let size = NSSize(width: width + margin * 2, height: height + margin * 2)
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width * scale), pixelsHigh: Int(size.height * scale), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
bitmap.size = size
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
let rect = NSRect(x: margin, y: margin, width: width, height: height)
let path = NSBezierPath(roundedRect: rect, xRadius: 12, yRadius: 12)
NSGraphicsContext.saveGraphicsState()
let shadow = NSShadow()
shadow.shadowColor = NSColor(srgbRed: 1, green: 0.83, blue: 0.24, alpha: 0.24)
shadow.shadowBlurRadius = 20
shadow.shadowOffset = NSSize(width: 0, height: 0)
shadow.set()
NSColor(calibratedWhite: 0.1, alpha: 1).setFill()
path.fill()
NSGraphicsContext.restoreGraphicsState()
NSGraphicsContext.saveGraphicsState()
path.addClip()
source.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: false, hints: [.interpolation: NSImageInterpolation.high])
// hiddenInset at trafficLightPosition {x:20,y:20}, matching the actual app.
let colors = [NSColor(srgbRed: 1, green: 0.373, blue: 0.341, alpha: 1), NSColor(srgbRed: 1, green: 0.741, blue: 0.180, alpha: 1), NSColor(srgbRed: 0.157, green: 0.784, blue: 0.251, alpha: 1)]
for (i, color) in colors.enumerated() {
    let dot = NSBezierPath(ovalIn: NSRect(x: margin + 20 + CGFloat(i) * 20, y: margin + height - 34, width: 14, height: 14))
    color.setFill(); dot.fill()
    NSColor.black.withAlphaComponent(0.18).setStroke(); dot.lineWidth = 0.5; dot.stroke()
}
NSGraphicsContext.restoreGraphicsState()
NSColor.white.withAlphaComponent(0.12).setStroke()
path.lineWidth = 0.5
path.stroke()
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
print("Framed \(URL(fileURLWithPath: args[2]).lastPathComponent): \(bitmap.pixelsWide)×\(bitmap.pixelsHigh), RGBA")
