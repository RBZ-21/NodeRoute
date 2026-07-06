import Foundation
import Network

/// Thin wrapper around `NWPathMonitor` used to decide whether to attempt a
/// network request or enqueue it for later (DR-002), and to trigger a drain of
/// the offline queue when connectivity is restored.
final class Reachability: @unchecked Sendable {
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "com.noderoute.driver.reachability")
    private let lock = NSLock()
    private var storedIsOnline = true
    private var onBecameOnline: (@Sendable () -> Void)?

    var isOnline: Bool {
        lock.lock(); defer { lock.unlock() }
        return storedIsOnline
    }

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            guard let self else { return }
            let online = path.status == .satisfied
            self.lock.lock()
            let transitionedOnline = online && !self.storedIsOnline
            self.storedIsOnline = online
            let handler = self.onBecameOnline
            self.lock.unlock()
            if transitionedOnline { handler?() }
        }
        monitor.start(queue: queue)
    }

    /// Register a callback fired when the device transitions from offline to online.
    func setOnBecameOnline(_ handler: @escaping @Sendable () -> Void) {
        lock.lock()
        onBecameOnline = handler
        lock.unlock()
    }

    deinit { monitor.cancel() }
}
