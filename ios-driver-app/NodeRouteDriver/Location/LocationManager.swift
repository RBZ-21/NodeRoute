import Foundation
import CoreLocation

/// Wraps `CLLocationManager` for the driver app (DR-003). Tracking is started and
/// stopped explicitly by the app so location is only captured **while the driver is
/// en route to / at a stop** — not for the whole shift. This keeps to when-in-use
/// authorization (no background-location capability required) because updates only
/// flow while the stop screen is on-screen and the app is in the foreground.
@MainActor
final class LocationManager: NSObject, @preconcurrency CLLocationManagerDelegate {
    private let manager: CLLocationManager
    private let minInterval: TimeInterval
    private var lastSentAt: Date = .distantPast
    private var isTracking = false

    /// Called with a throttled payload ready to POST to `/api/driver/location`.
    var onLocation: (@MainActor (DriverLocationPayload) -> Void)?
    /// Called when the user denies/restricts location permission.
    var onPermissionDenied: (@MainActor () -> Void)?

    init(manager: CLLocationManager = CLLocationManager(), minInterval: TimeInterval = 5) {
        self.manager = manager
        self.minInterval = minInterval
        super.init()
        self.manager.delegate = self
        self.manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        self.manager.distanceFilter = 25
    }

    /// Begin tracking. Requests permission on first use; no-op if already tracking.
    func start() {
        guard !isTracking else { return }
        isTracking = true

        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            onPermissionDenied?()
        default:
            manager.startUpdatingLocation()
        }
    }

    func stop() {
        isTracking = false
        manager.stopUpdatingLocation()
    }

    // MARK: - CLLocationManagerDelegate

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            if isTracking { manager.startUpdatingLocation() }
        case .denied, .restricted:
            onPermissionDenied?()
        default:
            break
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard isTracking, let location = locations.last else { return }
        let now = Date()
        guard now.timeIntervalSince(lastSentAt) >= minInterval else { return }
        lastSentAt = now
        onLocation?(Self.payload(from: location))
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Transient CoreLocation errors are ignored; the next update will retry.
    }

    /// Pure mapping from a `CLLocation` to the backend payload. `nonisolated` and
    /// side-effect-free so it can be unit-tested without a device or the main actor
    /// (mirrors the web client's m/s → mph conversion and heading handling).
    nonisolated static func payload(from location: CLLocation) -> DriverLocationPayload {
        DriverLocationPayload(
            lat: location.coordinate.latitude,
            lng: location.coordinate.longitude,
            heading: location.course >= 0 ? location.course : nil,
            speedMph: location.speed >= 0 ? location.speed * 2.2369362920544 : 0
        )
    }
}
