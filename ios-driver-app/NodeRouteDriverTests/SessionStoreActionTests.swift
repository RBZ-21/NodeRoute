import CoreLocation
import XCTest
@testable import NodeRouteDriver

/// Thread-safe recorder for stubbed APIClient calls. The APIClient closures are
/// `@Sendable`, so the recorder must be safe to touch from any executor.
private final class CallRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var calls: [(name: String, clientActionId: String?)] = []
    private var patches: [[String: String]] = []

    func record(_ name: String, _ id: String?) {
        lock.lock(); calls.append((name, id)); lock.unlock()
    }

    func recordPatch(_ payload: [String: String], _ id: String?) {
        lock.lock(); patches.append(payload); calls.append(("patchStop", id)); lock.unlock()
    }

    var names: [String] {
        lock.lock(); defer { lock.unlock() }
        return calls.map(\.name)
    }

    func firstID(for name: String) -> String? {
        lock.lock(); defer { lock.unlock() }
        return calls.first(where: { $0.name == name })?.clientActionId
    }

    var lastPatch: [String: String]? {
        lock.lock(); defer { lock.unlock() }
        return patches.last
    }
}

final class SessionStoreActionTests: XCTestCase {

    private func tempQueueURL() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("test-queue-\(UUID().uuidString).json")
    }

    private func makeClient(_ recorder: CallRecorder) -> APIClient {
        APIClient(
            login: { _, _ in LoginResponse(token: "t", refreshToken: "r", user: .preview) },
            driverRoutes: { _ in [] },
            driverInvoices: { _ in [] },
            deliveries: { _ in [] },
            driverSummary: { _ in nil },
            markStopArrived: { _, id, _ in recorder.record("arrive", id) },
            markStopDeparted: { _, id, _ in recorder.record("depart", id) },
            patchStop: { _, payload, id, _ in recorder.recordPatch(payload, id) },
            uploadProofOfDelivery: { _, _, id, _ in recorder.record("pod", id) },
            submitTemperatureLog: { _, id, _ in recorder.record("temperature", id) },
            pingDriverLocation: { _, _ in }
        )
    }

    @MainActor
    private func makeStore(_ recorder: CallRecorder) -> SessionStore {
        let store = SessionStore(apiClient: makeClient(recorder), offlineQueue: OfflineActionQueue(fileURL: tempQueueURL()))
        store.token = "token"
        return store
    }

    // DR-001 (idempotency keys on every mutating call) + DR-004 (arrive before depart)
    @MainActor
    func testMarkDeliveredArrivesBeforeDepartingWithSuffixedIdempotencyKeys() async {
        let recorder = CallRecorder()
        let store = makeStore(recorder)

        await store.markDelivered(.preview, proofImageDataURI: "data:image/jpeg;base64,AAAA", notes: "Left at dock")

        let names = recorder.names
        XCTAssertTrue(names.contains("pod"), "proof-of-delivery upload should be attempted")
        XCTAssertTrue(names.contains("arrive"), "delivery must arrive before departing")
        XCTAssertTrue(names.contains("depart"))

        let arriveIdx = names.firstIndex(of: "arrive")
        let departIdx = names.firstIndex(of: "depart")
        XCTAssertNotNil(arriveIdx)
        XCTAssertNotNil(departIdx)
        XCTAssertLessThan(arriveIdx!, departIdx!, "DR-004: /depart 404s without a prior /arrive")

        // DR-001 + DR-008: every mutating sub-call carries a suffixed key from one base.
        XCTAssertEqual(recorder.firstID(for: "pod")?.hasSuffix("-pod"), true)
        XCTAssertEqual(recorder.firstID(for: "arrive")?.hasSuffix("-arrive"), true)
        XCTAssertEqual(recorder.firstID(for: "depart")?.hasSuffix("-depart"), true)

        let departID = recorder.firstID(for: "depart")
        let base = departID?.replacingOccurrences(of: "-depart", with: "")
        XCTAssertNotNil(base)
        XCTAssertFalse(base!.isEmpty)
        XCTAssertEqual(recorder.firstID(for: "arrive"), "\(base!)-arrive", "sub-calls share one base id")
    }

    // DR-005 (structured failure reason -> "Exception: <reason>") + DR-001 (key present)
    @MainActor
    func testMarkFailedFormatsExceptionNoteAndSendsKey() async {
        let recorder = CallRecorder()
        let store = makeStore(recorder)

        await store.markFailed(.preview, reason: "Site closed", notes: "Gate locked")

        XCTAssertEqual(recorder.lastPatch?["status"], "failed")
        XCTAssertEqual(recorder.lastPatch?["driver_notes"], "Exception: Site closed\nGate locked")
        XCTAssertNotNil(recorder.firstID(for: "patchStop"), "DR-001: mark-failed must send an idempotency key")
    }

    // DR-005: pure note-formatting helper
    func testFailureNoteFormatting() {
        XCTAssertEqual(SessionStore.failureNotes(reason: "Site closed", notes: "Gate locked"), "Exception: Site closed\nGate locked")
        XCTAssertEqual(SessionStore.failureNotes(reason: "Other", notes: ""), "Exception: Other")
        XCTAssertEqual(SessionStore.failureNotes(reason: "", notes: ""), "Marked failed from iOS app")
    }

    // DR-003: pure CLLocation -> payload mapping (m/s -> mph, invalid course/speed handling)
    func testLocationPayloadMapping() {
        let handBuilt = CLLocation(latitude: 42.3601, longitude: -71.0589)
        let payload = LocationManager.payload(from: handBuilt)
        XCTAssertEqual(payload.lat, 42.3601, accuracy: 0.0001)
        XCTAssertEqual(payload.lng, -71.0589, accuracy: 0.0001)
        XCTAssertNil(payload.heading, "a negative course must map to nil heading")
        XCTAssertEqual(payload.speedMph, 0, "a negative speed must clamp to 0")

        let moving = CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: 40, longitude: -73),
            altitude: 0, horizontalAccuracy: 5, verticalAccuracy: 5,
            course: 90, speed: 10, timestamp: Date()
        )
        let movingPayload = LocationManager.payload(from: moving)
        XCTAssertEqual(movingPayload.heading, 90)
        XCTAssertEqual(movingPayload.speedMph ?? 0, 10 * 2.2369362920544, accuracy: 0.01)
    }
}
