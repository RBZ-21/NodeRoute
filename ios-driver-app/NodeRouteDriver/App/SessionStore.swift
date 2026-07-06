import Foundation
import Observation
import Security

@MainActor
@Observable
final class SessionStore {
    private let apiClient: APIClient
    private let tokenStore = KeychainTokenStore()

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

    init(apiClient: APIClient) {
        self.apiClient = apiClient
        self.token = try? tokenStore.read(.access)
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
            let response = try await apiClient.login(email, password)
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
            async let routes = apiClient.driverRoutes(token)
            async let invoices = apiClient.driverInvoices(token)
            async let deliveries = apiClient.deliveries(token)
            async let summary = apiClient.driverSummary(token)

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

        do {
            try await apiClient.markStopArrived(stop.id, token)
            await refresh(silent: true)
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    func markDelivered(_ stop: DriverStop, proofImageDataURI: String?, notes: String) async {
        guard let token else { return }

        do {
            if let invoiceID = stop.invoiceID, let proofImageDataURI {
                try await apiClient.uploadProofOfDelivery(invoiceID, proofImageDataURI, token)
            }

            if !notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                try await apiClient.patchStop(stop.id, ["driver_notes": notes], token)
            }

            try await apiClient.markStopDeparted(stop.id, token)
            await refresh(silent: true)
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    func markFailed(_ stop: DriverStop, notes: String) async {
        guard let token else { return }

        do {
            let failureNotes = notes.isEmpty ? "Marked failed from iOS app" : notes
            try await apiClient.patchStop(stop.id, [
                "status": "failed",
                "driver_notes": failureNotes
            ], token)
            await refresh(silent: true)
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    func submitTemperatureLog(_ payload: TemperatureLogPayload) async {
        guard let token else { return }

        do {
            try await apiClient.submitTemperatureLog(payload, token)
            alertMessage = "Temperature log saved."
        } catch {
            alertMessage = error.localizedDescription
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
