import PhotosUI
import SwiftUI
import UIKit

struct StopDetailView: View {
    @Environment(SessionStore.self) private var session
    let stop: DriverStop

    @State private var notes = ""
    @State private var selectedPhoto: PhotosPickerItem?
    @State private var proofImageDataURI: String?
    @State private var proofImage: UIImage?
    @State private var isCameraPresented = false
    @State private var isSubmitting = false
    @State private var isFailureDialogPresented = false

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

                        if let proofImage {
                            Image(uiImage: proofImage)
                                .resizable()
                                .scaledToFill()
                                .frame(maxWidth: .infinity)
                                .frame(height: 220)
                                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                                .overlay(alignment: .topTrailing) {
                                    Label("Attached", systemImage: "checkmark.circle.fill")
                                        .font(.caption.weight(.bold))
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 7)
                                        .background(.green, in: Capsule())
                                        .foregroundStyle(.white)
                                        .padding(10)
                                }
                                .accessibilityLabel("Attached proof of delivery photo")
                        }

                        HStack(spacing: 10) {
                            Button {
                                isCameraPresented = true
                            } label: {
                                Label(proofImageDataURI == nil ? "Take photo" : "Retake", systemImage: "camera")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))

                            PhotosPicker(selection: $selectedPhoto, matching: .images) {
                                Label(proofImageDataURI == nil ? "Library" : "Replace", systemImage: "photo")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                        }
                        .controlSize(.large)

                        if !UIImagePickerController.isSourceTypeAvailable(.camera) {
                            Text("Camera is unavailable in this simulator. Choose from the photo library instead.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
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
                        isFailureDialogPresented = true
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                }
                .controlSize(.large)
                .disabled(isSubmitting)
                .confirmationDialog(
                    "Why did this stop fail?",
                    isPresented: $isFailureDialogPresented,
                    titleVisibility: .visible
                ) {
                    ForEach(StopFailureReason.all, id: \.self) { reason in
                        Button(reason) {
                            submit { await session.markFailed(stop, reason: reason, notes: notes) }
                        }
                    }
                    Button("Cancel", role: .cancel) {}
                } message: {
                    Text("Pick the closest reason. It's recorded on the stop as \"Exception: <reason>\" along with any notes above.")
                }
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(stop.name ?? "Stop")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: selectedPhoto) {
            await loadSelectedPhoto()
        }
        .sheet(isPresented: $isCameraPresented) {
            CameraCaptureView { image in
                setProofImage(image)
            }
            .ignoresSafeArea()
        }
        .onAppear {
            notes = stop.driverNotes ?? ""
            // Track location only while the driver is on a stop screen — i.e. en
            // route to / at a stop — rather than for the whole shift (DR-003).
            session.startLocationTracking()
        }
        .onDisappear {
            session.stopLocationTracking()
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

        proofImage = UIImage(data: data)
        proofImageDataURI = "data:image/jpeg;base64,\(data.base64EncodedString())"
    }

    private func setProofImage(_ image: UIImage) {
        proofImage = image
        proofImageDataURI = image.jpegData(compressionQuality: 0.75).map {
            "data:image/jpeg;base64,\($0.base64EncodedString())"
        }
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

private struct CameraCaptureView: UIViewControllerRepresentable {
    var onCapture: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onCapture: onCapture, dismiss: dismiss)
    }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        private let onCapture: (UIImage) -> Void
        private let dismiss: DismissAction

        init(onCapture: @escaping (UIImage) -> Void, dismiss: DismissAction) {
            self.onCapture = onCapture
            self.dismiss = dismiss
        }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage {
                onCapture(image)
            }
            dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            dismiss()
        }
    }
}

#Preview {
    NavigationStack {
        StopDetailView(stop: .preview)
            .environment(SessionStore.previewLoaded)
    }
}
