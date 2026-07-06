import Foundation

struct LoginResponse: Codable {
    let token: String
    let refreshToken: String
    let user: DriverUser
}

struct DriverUser: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let email: String
    let role: String
}

struct DriverStop: Codable, Identifiable, Hashable {
    let id: String
    let routeID: String?
    let name: String?
    let address: String?
    let status: String?
    let scheduledDate: String?
    let scheduledTime: String?
    let notes: String?
    let driverNotes: String?
    let doorCode: String?
    let invoiceID: String?
    let invoiceNumber: String?
    let invoiceStatus: String?
    let invoiceHasSignature: Bool?
    let invoiceHasProofOfDelivery: Bool?
    let invoiceProofOfDeliveryUploadedAt: String?
    let arrivedAt: String?
    let position: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case routeID = "route_id"
        case name
        case address
        case status
        case scheduledDate = "scheduled_date"
        case scheduledTime = "scheduled_time"
        case notes
        case driverNotes = "driver_notes"
        case doorCode = "door_code"
        case invoiceID = "invoice_id"
        case invoiceNumber = "invoice_number"
        case invoiceStatus = "invoice_status"
        case invoiceHasSignature = "invoice_has_signature"
        case invoiceHasProofOfDelivery = "invoice_has_proof_of_delivery"
        case invoiceProofOfDeliveryUploadedAt = "invoice_proof_of_delivery_uploaded_at"
        case arrivedAt = "arrived_at"
        case position
    }
}

struct DriverRoute: Codable, Identifiable, Hashable {
    let id: String
    let name: String?
    let driver: String?
    let driverEmail: String?
    let notes: String?
    let createdAt: String?
    let stops: [DriverStop]
}

struct DriverInvoice: Codable, Identifiable, Hashable {
    let id: String
    let invoiceNumber: String?
    let customerName: String?
    let customerAddress: String?
    let status: String?
    let signedAt: String?
    let sentAt: String?
    let proofOfDeliveryUploadedAt: String?
    let proofOfDeliveryImageData: String?
    let signatureData: String?
}

struct DeliveryRecord: Codable, Identifiable, Hashable {
    let orderDbId: String
    let orderId: String?
    let restaurantName: String?
    let address: String?
    let routeId: String?
    let status: String?
    let items: [String]?

    var id: String { orderDbId }
}

struct DriverSummary: Codable, Hashable {
    let onTimeRate: Double?
    let totalStopsToday: Int?
    let milesToday: Double?
    let avgStopMinutes: Double?
    let avgSpeedMph: Double?
    let status: String?
    let vehicleId: String?
}

struct TemperatureLogPayload: Codable, Equatable, Sendable {
    let temperature: String
    let storageArea: String
    let unit: String
    let checkType: String
    let notes: String
}
