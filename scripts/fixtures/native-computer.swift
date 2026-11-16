import AppKit

final class TestPanel: NSPanel {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}

final class Target: NSObject, NSApplicationDelegate {
  let root: URL
  let nonce: String
  let field = NSTextField(string: "PI_STUDIO_QA_NATIVE")
  var panel: TestPanel!
  var presses = 0
  var timer: Timer?

  init(root: URL, nonce: String) { self.root = root; self.nonce = nonce }

  func applicationDidFinishLaunching(_ notification: Notification) {
    panel = TestPanel(
      contentRect: NSRect(x: 90, y: 120, width: 560, height: 280),
      styleMask: [.titled, .closable, .nonactivatingPanel],
      backing: .buffered, defer: false)
    panel.title = "Pi Studio QA Native Computer"
    panel.level = .floating
    panel.hidesOnDeactivate = false
    panel.isReleasedWhenClosed = false
    let view = NSView(frame: NSRect(x: 0, y: 0, width: 560, height: 280))
    let title = NSTextField(labelWithString: "Pi Studio — owned native test window")
    title.frame = NSRect(x: 24, y: 220, width: 512, height: 30)
    title.font = .systemFont(ofSize: 19, weight: .semibold)
    view.addSubview(title)
    let detail = NSTextField(labelWithString: "Background input only. No personal documents.")
    detail.frame = NSRect(x: 24, y: 184, width: 512, height: 25)
    view.addSubview(detail)
    field.frame = NSRect(x: 24, y: 124, width: 512, height: 40)
    field.font = .systemFont(ofSize: 18)
    field.identifier = NSUserInterfaceItemIdentifier("qa-native-input")
    field.setAccessibilityLabel("QA native input")
    view.addSubview(field)
    let button = NSButton(title: "QA increment", target: self, action: #selector(increment))
    button.frame = NSRect(x: 24, y: 58, width: 190, height: 38)
    button.bezelStyle = .rounded
    button.identifier = NSUserInterfaceItemIdentifier("qa-native-button")
    view.addSubview(button)
    panel.contentView = view
    // Nonactivating: never calls activate(), makeKey() or changes the hardware pointer.
    panel.orderFrontRegardless()
    writeState()
    timer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in
      self?.writeState()
    }
  }

  @objc func increment() { presses += 1; writeState() }

  func writeState() {
    let data: [String: Any] = [
      "nonce": nonce, "pid": ProcessInfo.processInfo.processIdentifier,
      "windowId": panel.windowNumber, "text": field.stringValue, "presses": presses,
      "frontmostPid": NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0,
      "key": panel.isKeyWindow, "main": panel.isMainWindow,
    ]
    if let bytes = try? JSONSerialization.data(withJSONObject: data, options: [.sortedKeys]) {
      try? bytes.write(to: root.appendingPathComponent("target-state.json"), options: .atomic)
    }
  }
}

guard CommandLine.arguments.count == 3 else { exit(2) }
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = Target(root: URL(fileURLWithPath: CommandLine.arguments[1]), nonce: CommandLine.arguments[2])
app.delegate = delegate
app.run()
