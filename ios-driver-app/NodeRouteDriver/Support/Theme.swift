import SwiftUI

extension Color {
    static let nrInk = Color(red: 0.07, green: 0.12, blue: 0.17)
    static let nrOcean = Color(red: 0.00, green: 0.48, blue: 0.58)
    static let nrMist = Color(red: 0.89, green: 0.96, blue: 0.95)
    static let nrSand = Color(red: 0.99, green: 0.86, blue: 0.55)
}

extension ShapeStyle where Self == Color {
    static var nrInk: Color { .nrInk }
    static var nrOcean: Color { .nrOcean }
}

struct DriverCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.white, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
            .shadow(color: .black.opacity(0.08), radius: 18, y: 8)
    }
}

struct StatusPill: View {
    let status: String?

    var body: some View {
        Text(statusLabel)
            .font(.caption.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(color.opacity(0.13), in: Capsule())
    }

    private var statusLabel: String {
        guard let status, !status.isEmpty else { return "Pending" }
        return status.replacingOccurrences(of: "-", with: " ").capitalized
    }

    private var color: Color {
        switch status?.lowercased() {
        case "completed", "delivered":
            .green
        case "failed":
            .red
        case "in-transit", "arrived":
            .orange
        default:
            .secondary
        }
    }
}
