import Foundation

/// Structured delivery-failure reasons presented to the driver, mirroring the web
/// client's `FAILURE_REASON_OPTIONS` (`driver-app/src/pages/StopDetailPage.tsx`).
/// Keeping the list identical means both platforms write the same taxonomy into
/// `driver_notes` as `Exception: <reason>` (DR-005), so exception reporting is
/// consistent across web and iOS.
enum StopFailureReason {
    static let all: [String] = [
        "Customer unavailable",
        "Site closed",
        "Access issue",
        "Customer rejected order",
        "Temperature exception",
        "Damaged product",
        "Vehicle issue",
        "Other",
    ]
}
