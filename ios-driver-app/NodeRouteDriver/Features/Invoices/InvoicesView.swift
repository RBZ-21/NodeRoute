import SwiftUI

struct InvoicesView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        List {
            if session.routeInvoices.isEmpty {
                Text("No invoices are linked to the current route.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(session.routeInvoices) { invoice in
                    VStack(alignment: .leading, spacing: 10) {
                        Text(invoice.invoiceNumber ?? "Invoice \(invoice.id.prefix(6))")
                            .font(.caption.weight(.bold))
                            .textCase(.uppercase)
                            .foregroundStyle(.secondary)
                        Text(invoice.customerName ?? "Customer invoice")
                            .font(.headline)
                        Text(invoice.customerAddress ?? "Address unavailable")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        StatusPill(status: invoice.status)
                    }
                    .padding(.vertical, 8)
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Invoices")
        .refreshable {
            await session.refresh()
        }
    }
}

#Preview {
    NavigationStack {
        InvoicesView()
            .environment(SessionStore.previewLoaded)
    }
}
