import Foundation

/// A single mutating driver action that failed to reach the server and is being
/// held for retry. `id` is the base client-action id; replaying with the same id
/// lets the backend `driver_client_actions` table dedupe, so a queued action that
/// actually did land server-side won't be double-applied (DR-002 depends on DR-001).
struct QueuedDriverAction: Codable, Identifiable, Equatable, Sendable {
    enum Kind: String, Codable, Sendable {
        case arrive
        case delivered
        case failed
        case temperatureLog
    }

    let id: String
    let kind: Kind
    let stopID: String?
    let invoiceID: String?
    let proofImageDataURI: String?
    let notes: String?
    let reason: String?
    let temperature: TemperatureLogPayload?
    let createdAt: Date
    var attempts: Int
}

/// Persistent, file-backed queue of failed mutating actions. Thread-safe via
/// `actor` isolation. Mirrors the intent of the web client's IndexedDB queue
/// (`driver-app/src/hooks/useOfflineQueue.ts`) but purpose-built for iOS.
///
/// Design notes:
///  - Enqueue de-dupes by `id`, so the same client action is never queued twice.
///  - `drain` is **skip-and-continue**: a failing entry never blocks entries behind
///    it (this is the head-of-line-blocking bug DR-010 flags in the web queue —
///    deliberately avoided here).
///  - A permanently-rejected entry (HTTP 4xx/5xx) is dropped; a transient failure is
///    retried up to `maxAttempts`, after which it is dropped so it can't wedge forever.
actor OfflineActionQueue {
    /// Outcome of replaying one action, returned by the caller-supplied sender.
    enum SendOutcome: Sendable {
        case delivered   // succeeded (or backend deduped a prior success) — remove
        case retry       // transient/offline failure — keep and try again later
        case drop        // permanent failure (server rejected) — remove
    }

    private let fileURL: URL
    private let maxAttempts: Int
    private var actions: [QueuedDriverAction] = []
    private var loaded = false

    init(fileURL: URL? = nil, maxAttempts: Int = 6) {
        self.fileURL = fileURL ?? OfflineActionQueue.defaultFileURL()
        self.maxAttempts = maxAttempts
    }

    static func defaultFileURL() -> URL {
        let base = (try? FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )) ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("noderoute-offline-queue.json")
    }

    func pending() -> [QueuedDriverAction] {
        loadIfNeeded()
        return actions
    }

    func count() -> Int {
        loadIfNeeded()
        return actions.count
    }

    /// Enqueue an action, de-duplicating by `id`.
    func enqueue(_ action: QueuedDriverAction) {
        loadIfNeeded()
        guard !actions.contains(where: { $0.id == action.id }) else { return }
        actions.append(action)
        persist()
    }

    /// Replay every queued action via `send`, removing the ones that succeed or are
    /// permanently rejected and keeping transient failures for a later drain.
    @discardableResult
    func drain(using send: @Sendable (QueuedDriverAction) async -> SendOutcome) async -> Int {
        loadIfNeeded()
        guard !actions.isEmpty else { return 0 }

        var survivors: [QueuedDriverAction] = []
        for var action in actions {
            switch await send(action) {
            case .delivered, .drop:
                continue // remove from the queue
            case .retry:
                action.attempts += 1
                if action.attempts < maxAttempts {
                    survivors.append(action)
                }
                // else: give up on a poison entry rather than block the queue forever.
            }
        }
        actions = survivors
        persist()
        return actions.count
    }

    private func loadIfNeeded() {
        guard !loaded else { return }
        loaded = true
        guard let data = try? Data(contentsOf: fileURL) else { return }
        if let decoded = try? Self.decoder.decode([QueuedDriverAction].self, from: data) {
            actions = decoded
        }
    }

    private func persist() {
        guard let data = try? Self.encoder.encode(actions) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}
