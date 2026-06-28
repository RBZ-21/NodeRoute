# NodeRoute Driver iOS

Native SwiftUI starter for the NodeRoute driver experience. It mirrors the existing `driver-app` PWA flows: login, assigned route, stop details, camera-first proof-of-delivery, invoices, and temperature logs.

## Requirements

- macOS with Xcode 16 or newer
- XcodeGen (`brew install xcodegen`)
- iOS 17+ deployment target

## Generate The Xcode Project

```sh
cd ios-driver-app
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
xcodegen generate
open NodeRouteDriver.xcodeproj
```

Set `API_BASE_URL` in `project.yml` before generating, or update the generated target build settings in Xcode. For local simulator development, use your Mac-accessible backend URL rather than `localhost` if the server is running on another machine.

## Current Scope

- SwiftUI app shell with tabs for Route, Stops, Invoices, and Temps.
- Async API client wired to the same endpoints used by the web driver app.
- In-memory route/session state with token persistence in Keychain.
- Camera-first proof-of-delivery capture with a photo-library fallback that uploads base64 image data.

Next good steps are offline cache persistence, push/route notifications, Apple Maps handoff for stop addresses, and Xcode UI tests for the stop completion flow.
