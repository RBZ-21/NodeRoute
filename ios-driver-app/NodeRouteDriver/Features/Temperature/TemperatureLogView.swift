import SwiftUI

struct TemperatureLogView: View {
    @Environment(SessionStore.self) private var session
    @State private var temperature = ""
    @State private var storageArea = "Cabin"
    @State private var unit = "F"
    @State private var checkType = "route"
    @State private var notes = ""

    var body: some View {
        Form {
            Section {
                Text("Logs submit to `/api/temperature-logs`; driver, manager, and admin submissions are accepted by the backend.")
                    .foregroundStyle(.secondary)
            }

            Section("Current context") {
                Text(session.currentRoute?.name ?? "No active route")
                Text(currentStopDescription)
                    .foregroundStyle(.secondary)
            }

            Section("Temperature") {
                TextField("Temperature", text: $temperature)
                    .keyboardType(.decimalPad)
                TextField("Storage area", text: $storageArea)
                Picker("Unit", selection: $unit) {
                    Text("F").tag("F")
                    Text("C").tag("C")
                }
                Picker("Check type", selection: $checkType) {
                    Text("Route").tag("route")
                    Text("Pickup").tag("pickup")
                    Text("Delivery").tag("delivery")
                }
                TextEditor(text: $notes)
                    .frame(minHeight: 120)
            }

            Button("Save temperature log") {
                Task {
                    await session.submitTemperatureLog(TemperatureLogPayload(
                        temperature: temperature,
                        storageArea: storageArea,
                        unit: unit,
                        checkType: checkType,
                        notes: contextualNotes
                    ))
                    temperature = ""
                    notes = ""
                }
            }
            .disabled(temperature.isEmpty)
        }
        .navigationTitle("Temps")
    }

    private var currentStop: DriverStop? {
        session.activeStops.first { !["completed", "failed"].contains($0.status ?? "") } ?? session.activeStops.first
    }

    private var currentStopDescription: String {
        guard let currentStop else { return "No current stop selected" }
        return "\(currentStop.name ?? "Stop") · \(currentStop.address ?? "Address unavailable")"
    }

    private var contextualNotes: String {
        [
            notes,
            currentStop.map { "stop_id:\($0.id)" },
            session.currentRoute.map { "route_id:\($0.id)" },
            currentStop?.name.map { "stop_name:\($0)" }
        ]
        .compactMap { $0 }
        .filter { !$0.isEmpty }
        .joined(separator: " | ")
    }
}

#Preview {
    NavigationStack {
        TemperatureLogView()
            .environment(SessionStore.previewLoaded)
    }
}
