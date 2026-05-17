import SwiftUI

@main
struct NodeRouteDriverApp: App {
    @State private var session = SessionStore(apiClient: APIClient.live)

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
        }
    }
}

struct RootView: View {
    @Environment(SessionStore.self) private var session
    @State private var selectedTab: AppTab = .route

    var body: some View {
        Group {
            if session.isAuthenticated {
                TabView(selection: $selectedTab) {
                    ForEach(AppTab.allCases) { tab in
                        NavigationStack {
                            tab.makeContentView()
                        }
                        .tabItem { tab.label }
                        .tag(tab)
                    }
                }
                .task {
                    await session.refresh(silent: true)
                }
            } else {
                LoginView()
            }
        }
        .tint(.nrOcean)
        .alert("NodeRoute", isPresented: Binding(
            get: { session.alertMessage != nil },
            set: { if !$0 { session.alertMessage = nil } }
        )) {
            Button("OK", role: .cancel) {
                session.alertMessage = nil
            }
        } message: {
            Text(session.alertMessage ?? "")
        }
    }
}
