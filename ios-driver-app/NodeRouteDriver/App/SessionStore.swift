import Foundation
import Observation

@MainActor
@Observable
final class SessionStore {
    private let apiClient: APIClient
    private let tokenStorageKey = "noderoute.driver.token"

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
        self.token = UserDefaults.standard.string(forKey: tokenStorageKey)
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
            UserDefaults.standard.set(response.token, forKey: tokenStorageKey)
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
        UserDefaults.standard.removeObject(forKey: tokenStorageKey)
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

        do {
            try await apiClient.markStopArrived(stopID: stop.id, token: token)
            await refresh(silent: true)
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    func markDelivered(_ stop: DriverStop, proofImageDataURI: String?, notes: String) async {
        guard let token else { return }

        do {
            if let invoiceID = stop.invoiceID, let proofImageDataURI {
                try await apiClient.uploadProofOfDelivery(invoiceID: invoiceID, imageDataURI: proofImageDataURI, token: token)
            }

            if !notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                try await apiClient.patchStop(stopID: stop.id, payload: ["driver_notes": notes], token: token)
            }

            try await apiClient.markStopDeparted(stopID: stop.id, token: token)
            await refresh(silent: true)
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    func markFailed(_ stop: DriverStop, notes: String) async {
        guard let token else { return }

        do {
            let failureNotes = notes.isEmpty ? "Marked failed from iOS app" : notes
            try await apiClient.patchStop(stopID: stop.id, payload: [
                "status": "failed",
                "driver_notes": failureNotes
            ], token: token)
            await refresh(silent: true)
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    func submitTemperatureLog(_ payload: TemperatureLogPayload) async {
        guard let token else { return }

        do {
            try await apiClient.submitTemperatureLog(payload, token: token)
            alertMessage = "Temperature log saved."
        } catch {
            alertMessage = error.localizedDescription
        }
    }
}
