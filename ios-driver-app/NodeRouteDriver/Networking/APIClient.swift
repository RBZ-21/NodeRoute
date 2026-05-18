import Foundation

enum APIError: LocalizedError {
    case invalidBaseURL
    case invalidResponse
    case unauthorized
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL:
            "Set API_BASE_URL before running the app."
        case .invalidResponse:
            "The server returned an unexpected response."
        case .unauthorized:
            "Your session expired. Please sign in again."
        case .server(let message):
            message
        }
    }
}

struct APIClient {
    var login: @Sendable (_ email: String, _ password: String) async throws -> LoginResponse
    var driverRoutes: @Sendable (_ token: String) async throws -> [DriverRoute]
    var driverInvoices: @Sendable (_ token: String) async throws -> [DriverInvoice]
    var deliveries: @Sendable (_ token: String) async throws -> [DeliveryRecord]
    var driverSummary: @Sendable (_ token: String) async throws -> DriverSummary?
    var markStopArrived: @Sendable (_ stopID: String, _ token: String) async throws -> Void
    var markStopDeparted: @Sendable (_ stopID: String, _ token: String) async throws -> Void
    var patchStop: @Sendable (_ stopID: String, _ payload: [String: String], _ token: String) async throws -> Void
    var uploadProofOfDelivery: @Sendable (_ invoiceID: String, _ imageDataURI: String, _ token: String) async throws -> Void
    var submitTemperatureLog: @Sendable (_ payload: TemperatureLogPayload, _ token: String) async throws -> Void
}

extension APIClient {
    static let live = APIClient(
        login: { email, password in
            try await HTTPClient.shared.request("/auth/driver/login", method: "POST", body: ["email": email, "password": password])
        },
        driverRoutes: { token in
            try await HTTPClient.shared.request("/api/driver/routes", token: token)
        },
        driverInvoices: { token in
            try await HTTPClient.shared.request("/api/driver/invoices", token: token)
        },
        deliveries: { token in
            try await HTTPClient.shared.request("/api/deliveries/deliveries", token: token)
        },
        driverSummary: { token in
            try await HTTPClient.shared.request("/api/deliveries/driver/summary", token: token)
        },
        markStopArrived: { stopID, token in
            let _: EmptyResponse = try await HTTPClient.shared.request("/api/stops/\(stopID)/arrive", method: "POST", token: token)
        },
        markStopDeparted: { stopID, token in
            let _: EmptyResponse = try await HTTPClient.shared.request("/api/stops/\(stopID)/depart", method: "POST", token: token)
        },
        patchStop: { stopID, payload, token in
            let _: EmptyResponse = try await HTTPClient.shared.request("/api/stops/\(stopID)", method: "PATCH", token: token, body: payload)
        },
        uploadProofOfDelivery: { invoiceID, imageDataURI, token in
            let _: EmptyResponse = try await HTTPClient.shared.request(
                "/api/invoices/\(invoiceID)/proof-of-delivery",
                method: "POST",
                token: token,
                body: ["proof_image_data": imageDataURI]
            )
        },
        submitTemperatureLog: { payload, token in
            let _: EmptyResponse = try await HTTPClient.shared.request("/api/temperature-logs", method: "POST", token: token, body: payload)
        }
    )
}

private struct EmptyResponse: Decodable {}
private struct EmptyBody: Encodable {}

private final class HTTPClient: Sendable {
    static let shared = HTTPClient()

    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    private init() {
        decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
    }

    func request<Response: Decodable>(
        _ path: String,
        method: String = "GET",
        token: String? = nil
    ) async throws -> Response {
        try await request(path, method: method, token: token, body: Optional<EmptyBody>.none)
    }

    func request<Response: Decodable, Body: Encodable>(
        _ path: String,
        method: String = "GET",
        token: String? = nil,
        body: Body? = Optional<String>.none
    ) async throws -> Response {
        guard let baseURLString = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String,
              let baseURL = URL(string: baseURLString),
              let url = URL(string: path, relativeTo: baseURL) else {
            throw APIError.invalidBaseURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try encoder.encode(body)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            let message = (try? decoder.decode(ServerError.self, from: data).resolvedMessage) ?? "\(httpResponse.statusCode) server error"
            throw APIError.server(message)
        }

        if data.isEmpty {
            return EmptyResponse() as! Response
        }

        return try decoder.decode(Response.self, from: data)
    }
}

private struct ServerError: Decodable {
    let error: String?
    let message: String?

    var resolvedMessage: String {
        error ?? message ?? "Server error"
    }
}
