# NodeRoute Driver iOS

Native SwiftUI starter for the NodeRoute driver experience. It mirrors the existing `driver-app` PWA flows: login, assigned route, stop details, proof-of-delivery, invoices, and temperature logs.

## Requirements

- macOS with Xcode 16 or newer
- XcodeGen (`brew install xcodegen`)
- iOS 17+ deployment target

## Generate The Xcode Project

```sh
cd ios-driver-app
xcodegen generate
open NodeRouteDriver.xcodeproj
```

Set `API_BASE_URL` in `project.yml` before generating, or update the generated target build settings in Xcode. For local simulator development, use your Mac-accessible backend URL rather than `localhost` if the server is running on another machine.

## Current Scope

- SwiftUI app shell with tabs for Route, Stops, Invoices, and Temps.
- Async API client wired to the same endpoints used by the web driver app.
- In-memory route/session state with token persistence in `UserDefaults`.
- Starter proof-of-delivery photo picker that uploads base64 image data.

Next good steps are Keychain token storage, camera-first capture, offline cache persistence, and Xcode UI tests for the stop completion flow.
