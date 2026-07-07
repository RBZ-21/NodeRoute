import SwiftUI

struct RouteDashboardView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                if session.routes.count > 1 {
                    Picker("Assigned route", selection: Binding(
                        get: { session.selectedRouteID ?? session.currentRoute?.id ?? "" },
                        set: { session.selectedRouteID = $0 }
                    )) {
                        ForEach(session.routes) { route in
                            Text(route.name ?? "Route \(route.id.prefix(6))").tag(route.id)
                        }
                    }
                    .pickerStyle(.menu)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                DriverCard {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Today's route")
                            .font(.caption.weight(.bold))
                            .textCase(.uppercase)
                            .foregroundStyle(.white.opacity(0.64))
                        Text(session.currentRoute?.name ?? "No active route")
                            .font(.title.weight(.bold))
                        Text(session.currentRoute?.notes ?? "Your route is ready for driver updates.")
                            .foregroundStyle(.white.opacity(0.78))

                        HStack(spacing: 12) {
                            MetricTile(title: "Stops", value: "\(session.activeStops.count)")
                            MetricTile(title: "Ready", value: "\(session.activeStops.filter { !["completed", "failed"].contains($0.status ?? "") }.count)")
                        }
                    }
                    .foregroundStyle(.white)
                }
                .background(Color.nrInk, in: RoundedRectangle(cornerRadius: 28, style: .continuous))

                ForEach(session.activeStops) { stop in
                    NavigationLink {
                        StopDetailView(stop: stop)
                    } label: {
                        StopRow(stop: stop)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Route")
        .refreshable {
            await session.refresh()
        }
        .toolbar {
            Button("Logout") {
                session.logout()
            }
        }
    }
}

private struct MetricTile: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.caption.weight(.bold))
                .textCase(.uppercase)
                .foregroundStyle(.white.opacity(0.6))
            Text(value)
                .font(.title2.weight(.bold))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

#Preview {
    NavigationStack {
        RouteDashboardView()
            .environment(SessionStore.previewLoaded)
    }
}
