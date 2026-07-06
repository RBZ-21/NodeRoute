import Foundation

extension APIClient {
    static let preview = APIClient(
        login: { _, _ in LoginResponse(token: "preview", refreshToken: "preview", user: .preview) },
        driverRoutes: { _ in [.preview] },
        driverInvoices: { _ in [.preview] },
        deliveries: { _ in [.preview] },
        driverSummary: { _ in .preview },
        markStopArrived: { _, _ in },
        markStopDeparted: { _, _ in },
        patchStop: { _, _, _ in },
        uploadProofOfDelivery: { _, _, _ in },
        submitTemperatureLog: { _, _ in }
    )
}

extension SessionStore {
    static var previewLoaded: SessionStore {
        let store = SessionStore(apiClient: .preview)
        store.token = "preview"
        store.user = .preview
        store.routes = [.preview]
        store.invoices = [.preview]
        store.deliveries = [.preview]
        store.summary = .preview
        store.selectedRouteID = DriverRoute.preview.id
        return store
    }
}

extension DriverUser {
    static let preview = DriverUser(id: "user-1", name: "Riley Driver", email: "driver@noderoute.com", role: "driver")
}

extension DriverStop {
    static let preview = DriverStop(
        id: "stop-1",
        routeID: "route-1",
        name: "Harbor Market",
        address: "100 Dock Street",
        status: "in-transit",
        scheduledDate: "2026-05-15",
        scheduledTime: "10:30 AM",
        notes: "Use the receiving entrance.",
        driverNotes: nil,
        doorCode: "2486",
        invoiceID: "invoice-1",
        invoiceNumber: "INV-1004",
        invoiceStatus: "pending",
        invoiceHasSignature: false,
        invoiceHasProofOfDelivery: false,
        invoiceProofOfDeliveryUploadedAt: nil,
        arrivedAt: nil,
        position: 1
    )
}

extension DriverRoute {
    static let preview = DriverRoute(
        id: "route-1",
        name: "Boston Cold Chain",
        driver: "Riley Driver",
        driverEmail: "driver@noderoute.com",
        notes: "Keep frozen totes below threshold and call ahead for dock access.",
        createdAt: nil,
        stops: [.preview]
    )
}

extension DriverInvoice {
    static let preview = DriverInvoice(
        id: "invoice-1",
        invoiceNumber: "INV-1004",
        customerName: "Harbor Market",
        customerAddress: "100 Dock Street",
        status: "pending",
        signedAt: nil,
        sentAt: nil,
        proofOfDeliveryUploadedAt: nil,
        proofOfDeliveryImageData: nil,
        signatureData: nil
    )
}

extension DeliveryRecord {
    static let preview = DeliveryRecord(
        orderDbId: "delivery-1",
        orderId: "ORDER-901",
        restaurantName: "Harbor Market",
        address: "100 Dock Street",
        routeId: "route-1",
        status: "in-transit",
        items: ["Frozen dumplings", "Produce crate"]
    )
}

extension DriverSummary {
    static let preview = DriverSummary(
        onTimeRate: 0.96,
        totalStopsToday: 8,
        milesToday: 42.5,
        avgStopMinutes: 11,
        avgSpeedMph: 28,
        status: "active",
        vehicleId: "VAN-12"
    )
}
