import PhotosUI
import SwiftUI

struct StopDetailView: View {
    @Environment(SessionStore.self) private var session
    let stop: DriverStop

    @State private var notes = ""
    @State private var selectedPhoto: PhotosPickerItem?
    @State private var proofImageDataURI: String?
    @State private var isSubmitting = false

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                DriverCard {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Customer")
                                    .font(.caption.weight(.bold))
                                    .textCase(.uppercase)
                                    .foregroundStyle(.secondary)
                                Text(stop.name ?? "Customer stop")
                                    .font(.title2.weight(.bold))
                                Text(stop.address ?? "Address unavailable")
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            StatusPill(status: stop.status)
                        }

                        DetailLine(title: "Delivery window", value: stop.scheduledTime ?? "Not scheduled")
                        DetailLine(title: "Door code", value: stop.doorCode ?? "No code on file")
                        DetailLine(title: "Invoice", value: stop.invoiceNumber ?? "Not linked")
                    }
                }

                DriverCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Proof of delivery")
                            .font(.headline)
                        PhotosPicker(selection: $selectedPhoto, matching: .images) {
                            Label(proofImageDataURI == nil ? "Attach photo" : "Replace photo", systemImage: "camera")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                    }
                }

                DriverCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Driver notes")
                            .font(.headline)
                        TextEditor(text: $notes)
                            .frame(minHeight: 120)
                            .padding(8)
                            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18))
                    }
                }

                VStack(spacing: 10) {
                    Button("Mark Arrived") {
                        submit { await session.markArrived(stop) }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.orange)

                    Button("Mark Delivered") {
                        submit { await session.markDelivered(stop, proofImageDataURI: proofImageDataURI, notes: notes) }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)

                    Button("Mark Failed") {
                        submit { await session.markFailed(stop, notes: notes) }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                }
                .controlSize(.large)
                .disabled(isSubmitting)
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(stop.name ?? "Stop")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: selectedPhoto) {
            await loadSelectedPhoto()
        }
        .onAppear {
            notes = stop.driverNotes ?? ""
        }
    }

    private func submit(_ action: @escaping () async -> Void) {
        isSubmitting = true
        Task {
            await action()
            isSubmitting = false
        }
    }

    private func loadSelectedPhoto() async {
        guard let selectedPhoto,
              let data = try? await selectedPhoto.loadTransferable(type: Data.self) else {
            return
        }

        proofImageDataURI = "data:image/jpeg;base64,\(data.base64EncodedString())"
    }
}

private struct DetailLine: View {
    let title: String
    let value: String

    var body: some View {
        HStack {
            Text(title)
                .fontWeight(.medium)
            Spacer()
            Text(value)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.trailing)
        }
        .font(.subheadline)
        .padding(.top, 4)
    }
}

#Preview {
    NavigationStack {
        StopDetailView(stop: .preview)
            .environment(SessionStore.previewLoaded)
    }
}
