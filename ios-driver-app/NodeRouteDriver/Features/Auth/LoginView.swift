import SwiftUI

struct LoginView: View {
    @Environment(SessionStore.self) private var session
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        ZStack {
            LinearGradient(colors: [.nrMist, Color(.systemGroupedBackground)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()

            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Driver sign in")
                        .font(.caption.weight(.bold))
                        .textCase(.uppercase)
                        .foregroundStyle(.secondary)
                    Text("NodeRoute Driver")
                        .font(.largeTitle.weight(.bold))
                        .foregroundStyle(.nrInk)
                    Text("Sync routes, invoices, and proof-of-delivery updates before the wheels start turning.")
                        .foregroundStyle(.secondary)
                }

                TextField("driver@noderoute.com", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)

                SecureField("Password", text: $password)
                    .textContentType(.password)
                    .textFieldStyle(.roundedBorder)

                Button {
                    Task { await session.login(email: email, password: password) }
                } label: {
                    if session.isLoading {
                        ProgressView()
                            .tint(.white)
                    } else {
                        Text("Sign in")
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .frame(maxWidth: .infinity)
                .disabled(email.isEmpty || password.isEmpty || session.isLoading)
            }
            .padding(24)
            .background(.white, in: RoundedRectangle(cornerRadius: 32, style: .continuous))
            .padding()
        }
    }
}

#Preview {
    LoginView()
        .environment(SessionStore(apiClient: .preview))
}
