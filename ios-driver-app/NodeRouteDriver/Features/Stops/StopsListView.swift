import SwiftUI

struct StopsListView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        List {
            Section {
                Text("Tap a stop for customer details, order items, proof-of-delivery capture, and status actions.")
                    .foregroundStyle(.secondary)
            }

            Section("Assigned stops") {
                ForEach(session.activeStops) { stop in
                    NavigationLink {
                        StopDetailView(stop: stop)
                    } label: {
                        StopRow(stop: stop)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Stops")
        .refreshable {
            await session.refresh()
        }
    }
}

struct StopRow: View {
    let stop: DriverStop

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(stop.name ?? "Customer stop")
                        .font(.headline)
                        .foregroundStyle(Color.nrInk)
                    Text(stop.address ?? "Address unavailable")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                StatusPill(status: stop.status)
            }

            HStack {
                Label(stop.scheduledTime ?? "No window", systemImage: "clock")
                Spacer()
                if let invoiceNumber = stop.invoiceNumber {
                    Label(invoiceNumber, systemImage: "doc.text")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 6)
    }
}

#Preview {
    NavigationStack {
        StopsListView()
            .environment(SessionStore.previewLoaded)
    }
}
