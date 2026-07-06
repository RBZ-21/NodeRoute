import Foundation
import Observation
import Security

@MainActor
@Observable
final class SessionStore {
    private let apiClient: APIClient
    private let tokenStore = KeychainTokenStore()
    private let offlineQueue: OfflineActionQueue
    private let reachability: Reachability
    let locationManager: LocationManager

    var token: String?
    var user: DriverUser?
    var routes: [DriverRoute] = []
    var invoices: [DriverInvoice] = []
    var deliveries: [DeliveryRecord] = []
    var summary: DriverSummary?
    var selectedRouteID: String?
    var isLoading = false
    var isRefreshing = false
    var alertMessage: String?
    /// Number of mutating actions waiting in the offline queue (DR-002).
    var pendingSyncCount = 0

    private var isDraining = false

    init(
        apiClient: APIClient,
        offlineQueue: OfflineActionQueue = OfflineActionQueue(),
        reachability: Reachability = Reachability(),
        locationManager: LocationManager? = nil
    ) {
        self.apiClient = apiClient
        self.offlineQueue = offlineQueue
        self.reachability = reachability
        // LocationManager is @MainActor; it cannot be built in a default argument
        // (those are evaluated in a nonisolated context). Construct it here, inside
        // the @MainActor init body, where main-actor isolation is available.
        self.locationManager = locationManager ?? LocationManager()
        self.token = try? tokenStore.read(.access)

        // Upload throttled location fixes while en route (DR-003).
        self.locationManager.onLocation = { [weak self] payload in
            guard let self, let token = self.token else { return }
            let client = self.apiClient
            Task { try? await client.pingDriverLocation(payload, token) }
        }
        self.locationManager.onPermissionDenied = { [weak self] in
            self?.alertMessage = "Location access is off. Turn it on in Settings so dispatch can track your position while you're en route."
        }

        // Drain the offline queue as soon as connectivity is restored (DR-002).
        self.reachability.setOnBecameOnline { [weak self] in
            Task { await self?.drainOfflineQueue() }
        }

        Task {
            await self.refreshPendingSyncCount()
            await self.drainOfflineQueue()
        }
    }

    var isAuthenticated: Bool {
        token != nil
    }

    var currentRoute: DriverRoute? {
        if let selectedRouteID {
            return routes.first { $0.id == selectedRouteID } ?? routes.first
        }

        return routes.first
    }

    var activeStops: [DriverStop] {
        currentRoute?.stops ?? []
    }

    var routeInvoices: [DriverInvoice] {
        let invoiceIDs = Set(activeStops.compactMap(\.invoiceID))
        return invoices.filter { invoiceIDs.contains($0.id) }
    }

    func login(email: String, password: String) async {
        isLoading = true
        defer { isLoading = false }

        do {
            let response = try await apiClient.login(email: email, password: password)
            token = response.token
            user = response.user
            try tokenStore.save(response.token, kind: .access)
            try tokenStore.save(response.refreshToken, kind: .refresh)
            await refresh(silent: true)
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    func logout() {
        token = nil
        user = nil
        routes = []
        invoices = []
        deliveries = []
        summary = nil
        selectedRouteID = nil
        try? tokenStore.delete(.access)
        try? tokenStore.delete(.refresh)
    }

    func refresh(silent: Bool = false) async {
        guard let token else { return }
        if silent {
            isLoading = true
        } else {
            isRefreshing = true
        }

        defer {
            isLoading = false
            isRefreshing = false
        }

        do {
            async let routes = apiClient.driverRoutes(token: token)
            async let invoices = apiClient.driverInvoices(token: token)
            async let deliveries = apiClient.deliveries(token: token)
            async let summary = apiClient.driverSummary(token: token)

            self.routes = try await routes
            self.invoices = try await invoices
            self.deliveries = try await deliveries
            self.summary = try await summary

            if selectedRouteID == nil {
                selectedRouteID = self.routes.first?.id
            }
        } catch APIError.unauthorized {
            logout()
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    func markArrived(_ stop: DriverStop) async {
        guard let token else { return }
        let actionID = UUID().uuidString

        do {
            try await apiClient.markStopArrived(stop.id, actionID, token)
            await refresh(silent: true)
        } catch {
            await handleMutationFailure(error, enqueue: QueuedDriverAction(
                id: actionID, kind: .arrive, stopID: stop.id, invoiceID: nil,
                proofImageDataURI: nil, notes: nil, reason: nil, temperature: nil,
                createdAt: Date(), attempts: 0
            ))
        }
    }

    func markDelivered(_ stop: DriverStop, proofImageDataURI: String?, notes: String) async {
        guard let token else { return }
        let actionID = UUID().uuidString

        do {
            try await Self.performDelivery(
                stopID: stop.id, invoiceID: stop.invoiceID, proofImageDataURI: proofImageDataURI,
                notes: notes, actionID: actionID, apiClient: apiClient, token: token
            )
            await refresh(silent: true)
        } catch {
            await handleMutationFailure(error, enqueue: QueuedDriverAction(
                id: actionID, kind: .delivered, stopID: stop.id, invoiceID: stop.invoiceID,
                proofImageDataURI: proofImageDataURI, notes: notes, reason: nil, temperature: nil,
                createdAt: Date(), attempts: 0
            ))
        }
    }

    func markFailed(_ stop: DriverStop, reason: String, notes: String) async {
        guard let token else { return }
        let actionID = UUID().uuidString
        let driverNotes = Self.failureNotes(reason: reason, notes: notes)

        do {
            try await apiClient.patchStop(stop.id, ["status": "failed", "driver_notes": driverNotes], actionID, token)
            await refresh(silent: true)
        } catch {
            await handleMutationFailure(error, enqueue: QueuedDriverAction(
                id: actionID, kind: .failed, stopID: stop.id, invoiceID: nil,
                proofImageDataURI: nil, notes: notes, reason: reason, temperature: nil,
                createdAt: Date(), attempts: 0
            ))
        }
    }

    func submitTemperatureLog(_ payload: TemperatureLogPayload) async {
        guard let token else { return }
        let actionID = UUID().uuidString

        do {
            try await apiClient.submitTemperatureLog(payload, actionID, token)
            alertMessage = "Temperature log saved."
        } catch {
            await handleMutationFailure(
                error,
                enqueue: QueuedDriverAction(
                    id: actionID, kind: .temperatureLog, stopID: nil, invoiceID: nil,
                    proofImageDataURI: nil, notes: nil, reason: nil, temperature: payload,
                    createdAt: Date(), attempts: 0
                ),
                offlineMessage: "Temperature log saved offline — it'll sync when you're back online."
            )
        }
    }

    // MARK: - Location tracking (en route to / at a stop)

    func startLocationTracking() {
        locationManager.start()
    }

    func stopLocationTracking() {
        locationManager.stop()
    }

    // MARK: - Offline queue

    func refreshPendingSyncCount() async {
        pendingSyncCount = await offlineQueue.count()
    }

    /// Replay queued actions when online. Re-issues each with its stored client
    /// action id so the backend dedupes any that already landed.
    func drainOfflineQueue() async {
        guard let token, reachability.isOnline, !isDraining else { return }
        isDraining = true
        defer { isDraining = false }

        let client = apiClient
        let authToken = token
        let remaining = await offlineQueue.drain { action in
            await Self.replay(action, apiClient: client, token: authToken)
        }
        pendingSyncCount = remaining
        await refresh(silent: true)
    }

    /// Decide whether a failed mutation should be queued for retry or surfaced.
    /// Mirrors the web client: transport/offline errors are queued; explicit HTTP
    /// errors are surfaced (retrying the same payload won't help); 401 logs out.
    private func handleMutationFailure(
        _ error: Error,
        enqueue action: QueuedDriverAction,
        offlineMessage: String = "Saved offline — it'll sync automatically when you're back online."
    ) async {
        if let apiError = error as? APIError {
            switch apiError {
            case .unauthorized:
                logout()
            case .server, .invalidBaseURL, .invalidResponse:
                alertMessage = apiError.localizedDescription
            }
            return
        }

        // Non-HTTP error (offline / transport) — queue for retry on reconnect.
        await offlineQueue.enqueue(action)
        await refreshPendingSyncCount()
        alertMessage = offlineMessage
    }

    // MARK: - Pure helpers (unit-testable, no actor/UI state)

    /// Executes the full delivery sequence with per-sub-call idempotency keys, and
    /// arrives before departing — the backend `/depart` returns 404 without an open
    /// dwell record (DR-004). `/arrive` is idempotent, so a redundant arrive is safe
    /// to ignore (mirrors the web client).
    nonisolated static func performDelivery(
        stopID: String,
        invoiceID: String?,
        proofImageDataURI: String?,
        notes: String,
        actionID: String,
        apiClient: APIClient,
        token: String
    ) async throws {
        if let invoiceID, let proofImageDataURI {
            try await apiClient.uploadProofOfDelivery(invoiceID, proofImageDataURI, "\(actionID)-pod", token)
        }

        let trimmedNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedNotes.isEmpty {
            try await apiClient.patchStop(stopID, ["driver_notes": trimmedNotes], "\(actionID)-notes", token)
        }

        do {
            try await apiClient.markStopArrived(stopID, "\(actionID)-arrive", token)
        } catch {
            // An open dwell record may already exist (driver tapped "Mark Arrived"
            // earlier). The backend arrive is idempotent, so continue to departure.
        }

        try await apiClient.markStopDeparted(stopID, "\(actionID)-depart", token)
    }

    /// `Exception: <reason>` note format shared with the web client (DR-005).
    nonisolated static func failureNotes(reason: String, notes: String) -> String {
        let trimmedReason = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        let combined = [
            trimmedReason.isEmpty ? nil : "Exception: \(trimmedReason)",
            trimmedNotes.isEmpty ? nil : trimmedNotes,
        ]
        .compactMap { $0 }
        .joined(separator: "\n")

        return combined.isEmpty ? "Marked failed from iOS app" : combined
    }

    /// Re-issue a queued action, mapping the result to a drain outcome.
    nonisolated static func replay(_ action: QueuedDriverAction, apiClient: APIClient, token: String) async -> OfflineActionQueue.SendOutcome {
        do {
            switch action.kind {
            case .arrive:
                guard let stopID = action.stopID else { return .drop }
                try await apiClient.markStopArrived(stopID, action.id, token)
            case .delivered:
                guard let stopID = action.stopID else { return .drop }
                try await performDelivery(
                    stopID: stopID, invoiceID: action.invoiceID, proofImageDataURI: action.proofImageDataURI,
                    notes: action.notes ?? "", actionID: action.id, apiClient: apiClient, token: token
                )
            case .failed:
                guard let stopID = action.stopID else { return .drop }
                let notes = failureNotes(reason: action.reason ?? "", notes: action.notes ?? "")
                try await apiClient.patchStop(stopID, ["status": "failed", "driver_notes": notes], action.id, token)
            case .temperatureLog:
                guard let payload = action.temperature else { return .drop }
                try await apiClient.submitTemperatureLog(payload, action.id, token)
            }
            return .delivered
        } catch APIError.unauthorized {
            return .retry // keep; will retry after re-auth
        } catch let apiError as APIError {
            if case .server = apiError { return .drop } // permanent rejection
            return .retry
        } catch {
            return .retry // transport error — try again later
        }
    }
}

private final class KeychainTokenStore {
    enum TokenKind: String {
        case access = "noderoute.driver.token"
        case refresh = "noderoute.driver.refreshToken"
    }

    func save(_ token: String, kind: TokenKind) throws {
        let data = Data(token.utf8)
        let query = baseQuery(kind)
        SecItemDelete(query as CFDictionary)

        var attributes = query
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let status = SecItemAdd(attributes as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError.unhandled(status) }
    }

    func read(_ kind: TokenKind) throws -> String? {
        var query = baseQuery(kind)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainError.unhandled(status) }
        guard let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func delete(_ kind: TokenKind) throws {
        let status = SecItemDelete(baseQuery(kind) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unhandled(status)
        }
    }

    private func baseQuery(_ kind: TokenKind) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.noderoute.driver",
            kSecAttrAccount as String: kind.rawValue,
        ]
    }
}

private enum KeychainError: Error {
    case unhandled(OSStatus)
}
