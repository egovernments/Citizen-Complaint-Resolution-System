# CMS Mozambique

Flutter WebView wrapper for the DIGIT employee + citizen portal at
`http://digit.mctd.gov.mz/digit-ui/`.

## What it does
- Branded splash screen that stays visible until the WebView finishes loading.
- Loads the configured login URL (citizen by default) inside a native WebView.
- Subtle right-edge toggle between citizen and employee logins.
- Pull-to-refresh, offline snackbar, page-load error screen, double-back-to-exit.
- External links (`mailto:` / `tel:` / off-host URLs) open in the OS default app.

## Configuration

Everything user-facing is driven from
[assets/config/app_config.json](assets/config/app_config.json):

```json
{
  "appName": "CMS Mozambique",
  "url": "http://digit.mctd.gov.mz/digit-ui/employee/user/login",
  "citizenUrl": "http://digit.mctd.gov.mz/digit-ui/citizen/login",
  "startWithCitizen": true,
  "showCitizenSwitch": true,
  "logoAsset": "assets/icons/app_icon.png",
  "primaryColorHex": "#0B4F6C",
  "allowMixedContent": true,
  "javascriptEnabled": true,
  "showAppBar": false,
  "pullToRefresh": true
}
```

| Key | Purpose |
|---|---|
| `appName` | Title used in splash screen and `MaterialApp` |
| `url` | Employee login URL |
| `citizenUrl` | Citizen login URL |
| `startWithCitizen` | `true` → open citizen URL on launch; `false` → open employee URL |
| `showCitizenSwitch` | Show the right-edge toggle tab on login pages |
| `logoAsset` | Asset path of the logo shown on the splash |
| `primaryColorHex` | Theme seed color (e.g. `#0B4F6C`) |
| `allowMixedContent` | Allow `http` resources inside the page |
| `javascriptEnabled` | Toggle JS in the WebView |
| `showAppBar` | Show an app bar with refresh button |
| `pullToRefresh` | Enable pull-to-refresh gesture |

### Change the launcher icon / app display name

1. Replace [assets/icons/app_icon.png](assets/icons/app_icon.png) with a square PNG (>= 1024x1024).
2. Run `flutter pub run flutter_launcher_icons` to regenerate Android/iOS/web icons.
3. Update `android:label` in [android/app/src/main/AndroidManifest.xml](android/app/src/main/AndroidManifest.xml) and `CFBundleDisplayName` in [ios/Runner/Info.plist](ios/Runner/Info.plist) if you change the visible app name.

## Run locally

```bash
flutter pub get
flutter run                                       # debug, connected device
flutter run --release                             # release on device
flutter build apk --release --target-platform android-arm64
flutter build appbundle --release                 # Play Store
flutter build ios --release                       # iOS (macOS + Xcode required)
```

Release builds are renamed via [android/app/build.gradle.kts](android/app/build.gradle.kts) to:
`CMS_Mozambique-v<versionName>-b<versionCode>[-<abi>]-release.apk`

## Versioning

Version lives in [pubspec.yaml](pubspec.yaml) as `version: <name>+<code>`:
- **name** (`1.0.0`) → user-facing `versionName` / Play Store version
- **code** (`+1`) → integer `versionCode`, must increase for every upload

Bump it locally with `vim pubspec.yaml`, or trigger the
[`Bump Version` GitHub Action](.github/workflows/bump-version.yml) — choose
`patch` / `minor` / `major`, it edits `pubspec.yaml`, commits, and (optionally)
pushes a `vX.Y.Z` tag that auto-triggers a release build.

## CI / CD

Two workflows in [.github/workflows](.github/workflows):

| Workflow | Trigger | Output |
|---|---|---|
| **Build APK** | push to `main`, PR, `v*.*.*` tag, manual dispatch | APK artifact on every run; **GitHub Release** with attached APK on tags |
| **Bump Version** | manual dispatch (patch/minor/major) | Commit + optional tag, which triggers a release build |

### Required GitHub Secrets (for signed release APKs)

In **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
|---|---|
| `KEYSTORE_BASE64` | Base64 of `android/app/cms_mozambique-release.keystore` — produce with `base64 -w0 android/app/cms_mozambique-release.keystore` |
| `KEYSTORE_PASSWORD` | Store password |
| `KEY_PASSWORD` | Key password |
| `KEY_ALIAS` | `cms_mozambique` |

Without these secrets, the build will fall back to debug signing (per [build.gradle.kts](android/app/build.gradle.kts)) — fine for CI smoke testing but the APK won't be Play Store / production signed.

### Cutting a release
```bash
# Local:
git tag v1.0.1 && git push origin v1.0.1
# Or via the GitHub UI:
# Actions → "Bump Version" → Run workflow → choose patch/minor/major
```
The release workflow attaches the APK to a GitHub Release named after the tag.

## Notes
- Android cleartext traffic is enabled (`android:usesCleartextTraffic="true"`) because the target URL uses `http://`. Remove this once the backend serves HTTPS.
- iOS App Transport Security has a specific exception for `digit.mctd.gov.mz` in [ios/Runner/Info.plist](ios/Runner/Info.plist).
- Keystore + signing credentials are **gitignored** ([android/.gitignore](android/.gitignore), root [.gitignore](.gitignore)). Back up the keystore separately — losing it means you can never publish updates to the same Play Store listing.
- Source layout:
  - [lib/main.dart](lib/main.dart) - entry point, splash + WebView bootstrap
  - [lib/src/app_config.dart](lib/src/app_config.dart) - config loader
  - [lib/src/splash_screen.dart](lib/src/splash_screen.dart) - splash UI + version footer
  - [lib/src/web_view_screen.dart](lib/src/web_view_screen.dart) - WebView, error / offline / pull-to-refresh / audience toggle
