import SwiftUI

enum AppTab: String, CaseIterable, Identifiable {
    case route
    case stops
    case invoices
    case temperature

    var id: String { rawValue }

    @ViewBuilder
    func makeContentView() -> some View {
        switch self {
        case .route:
            RouteDashboardView()
        case .stops:
            StopsListView()
        case .invoices:
            InvoicesView()
        case .temperature:
            TemperatureLogView()
        }
    }

    @ViewBuilder
    var label: some View {
        switch self {
        case .route:
            Label("Route", systemImage: "map")
        case .stops:
            Label("Stops", systemImage: "shippingbox")
        case .invoices:
            Label("Invoices", systemImage: "doc.text")
        case .temperature:
            Label("Temps", systemImage: "thermometer.medium")
        }
    }
}
