import XCTest
@testable import NodeRouteDriver

/// DR-002: persistent offline queue — dedupe, drain semantics, persistence, and
/// (unlike the web queue's DR-010 bug) no head-of-line blocking.
final class OfflineActionQueueTests: XCTestCase {

    private func tempURL() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("queue-\(UUID().uuidString).json")
    }

    private func action(id: String, kind: QueuedDriverAction.Kind = .arrive) -> QueuedDriverAction {
        QueuedDriverAction(
            id: id, kind: kind, stopID: "stop-1", invoiceID: nil,
            proofImageDataURI: nil, notes: nil, reason: nil, temperature: nil,
            createdAt: Date(), attempts: 0
        )
    }

    func testEnqueueDedupesById() async {
        let queue = OfflineActionQueue(fileURL: tempURL())
        await queue.enqueue(action(id: "abc12345"))
        await queue.enqueue(action(id: "abc12345"))
        let count = await queue.count()
        XCTAssertEqual(count, 1, "the same client action must never be queued twice")
    }

    func testDrainRemovesDeliveredKeepsRetry() async {
        let queue = OfflineActionQueue(fileURL: tempURL(), maxAttempts: 3)
        await queue.enqueue(action(id: "deliver01"))
        await queue.enqueue(action(id: "retry0001"))

        let remaining = await queue.drain { $0.id == "deliver01" ? .delivered : .retry }

        XCTAssertEqual(remaining, 1)
        let pending = await queue.pending()
        XCTAssertEqual(pending.map(\.id), ["retry0001"])
        XCTAssertEqual(pending.first?.attempts, 1, "a retried entry increments its attempt count")
    }

    func testRetryEntryDroppedAfterMaxAttempts() async {
        let queue = OfflineActionQueue(fileURL: tempURL(), maxAttempts: 2)
        await queue.enqueue(action(id: "poison001"))

        _ = await queue.drain { _ in .retry } // attempts -> 1, kept
        var pending = await queue.pending()
        XCTAssertEqual(pending.count, 1)

        _ = await queue.drain { _ in .retry } // attempts -> 2 == max, dropped
        pending = await queue.pending()
        XCTAssertEqual(pending.count, 0, "a poison entry is dropped after maxAttempts so it can't wedge the queue")
    }

    func testDropRemovesEntry() async {
        let queue = OfflineActionQueue(fileURL: tempURL())
        await queue.enqueue(action(id: "server401"))
        let remaining = await queue.drain { _ in .drop }
        XCTAssertEqual(remaining, 0, "a permanently-rejected entry is removed")
    }

    func testPersistsAcrossInstances() async {
        let url = tempURL()
        let first = OfflineActionQueue(fileURL: url)
        await first.enqueue(action(id: "persist01"))

        let second = OfflineActionQueue(fileURL: url)
        let pending = await second.pending()
        XCTAssertEqual(pending.map(\.id), ["persist01"], "queue must survive a cold start")
    }

    func testSkipAndContinueDoesNotHeadOfLineBlock() async {
        let queue = OfflineActionQueue(fileURL: tempURL())
        await queue.enqueue(action(id: "first0001")) // will fail transiently
        await queue.enqueue(action(id: "second002")) // will succeed

        let remaining = await queue.drain { $0.id == "first0001" ? .retry : .delivered }

        XCTAssertEqual(remaining, 1)
        let pending = await queue.pending()
        XCTAssertEqual(pending.map(\.id), ["first0001"], "an entry behind a failing one still drains")
    }
}
