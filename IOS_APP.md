# SmartFolio for iOS

Native iOS app built with **Ionic React 8** on **Capacitor 8**. One codebase
serves both the app and the web build.

The UI is an app, not a responsive webpage: routes push and pop with sliding
transitions, the iOS edge-swipe goes back, titles collapse on scroll, and the
controls are native pickers, segmented controls, and swipe-to-delete lists.
Ionic is pinned to `ios` mode everywhere (`setupIonicReact({ mode: 'ios' })`)
so the browser demo matches the app rather than rendering Material styling.

**Layout.** One tree, two form factors: `IonSplitPane` opens a persistent
sidebar at `lg` and the tab bar hides at the same breakpoint. Below `lg` the
menu is *disabled*, not merely hidden, so its edge-swipe cannot compete with
swipe-back.

**Navigation.** The router is the source of truth. `lib/nav.ts` registers the
router's push with the store, so the existing `setScreen()` call sites keep
working, and `ScreenSync` mirrors the URL back into `screen`.

## Status

| Phase | State |
|---|---|
| 0 — Capacitor shell, config, CORS | Done |
| 1 — Mobile redesign (tab bar, touch charts, holdings, CSS) | Done |
| 1b — Ionic React app UI (routes, transitions, native controls) | Done |
| 2 — Native capabilities (share, haptics, in-app browser, offline boot) | Done |
| 3 — Icon, privacy policy, privacy manifest | Done |
| 3b — Xcode project generation, Simulator run, screenshots | **Blocked: needs Xcode** |
| 4 — Enroll ($99/yr), TestFlight, submit | Not started |

## Blocked on Xcode

Only Command Line Tools are installed, so there is no `xcodebuild`, no
Simulator, and no CocoaPods. To unblock:

1. Install **Xcode** from the Mac App Store (~7–15 GB).
2. Point the toolchain at it (needs your password, so run this yourself):

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

3. Install CocoaPods:

```bash
brew install cocoapods
```

Then generate and open the project:

```bash
cd frontend
npm run build
npx cap add ios
npm run icons          # generates the full iOS icon + splash set from public/icon.svg
npx cap open ios
```

Finally, copy the privacy manifest into the target and add it to the App
target in Xcode (it must be a bundled resource):

```bash
cp frontend/resources/ios/PrivacyInfo.xcprivacy frontend/ios/App/App/
```

## Day-to-day

```bash
cd frontend
npm run dev            # web dev server, still the fastest loop
npm run ios:sync       # build + copy web assets into the iOS project
npx cap open ios       # run on Simulator or device from Xcode
```

The web layout can be checked at phone size in any browser at 393×852 — the
mobile breakpoint is 720px, so everything below that is the app layout.

## What makes this a real app, not a wrapped website

App Store Guideline 4.2 rejects repackaged websites. These are the
capabilities that answer it — all in `frontend/src/lib/native.ts`, each with a
web fallback so one build serves both targets:

- **Offline-first launch.** `lib/calculations/` is a complete deterministic
  mirror of the backend engine, so the app is fully usable with no network.
  It boots into local mode instantly and upgrades when the API answers. This
  also hides the free-tier backend's cold start.
- **Native launch destination.** The web build opens on the marketing landing
  page; the app opens straight into the dashboard.
- **System share sheet** for exports. The web path used `a.download`, which
  **iOS Safari ignores** — so this fixes a real bug rather than adding polish.
- **In-app browser** for external links. `window.open` in a Capacitor webview
  strands the user with no way back.
- **Haptics** on analysis completion, the app's one long-running action.

## Configuration

`frontend/capacitor.config.ts` — appId `com.adiarora.smartfolio`,
`webDir: dist`, `ios.contentInset: 'always'`.

**Backend CORS:** the app's webview origin is `capacitor://localhost`. It is
unioned into the allowlist in `backend/app/main.py` rather than added to
`DEFAULT_CORS_ORIGINS`, because `SMARTFOLIO_CORS_ORIGINS` *replaces* the
defaults and production sets it — the native app would otherwise be locked
out. Two tests guard this (`test_native_origin_allowed_alongside_configured`,
`test_web_origin_still_allowed`).

## Before submitting

- **Privacy policy URL:** `https://smartfolio-lemon.vercel.app/privacy.html`
  (a static file, served ahead of the SPA rewrite). Support URL: the repo's
  issues page.
- **Data disclosure:** holdings and values are **Financial Info**, collected
  for app functionality, *not* linked to identity (there are no accounts) and
  *not* used for tracking. `resources/ios/PrivacyInfo.xcprivacy` already
  declares this.
- **Category:** Finance.
- **Screenshots:** 6.7" (1290×2796) from the Simulator.

### Two risks worth deciding on deliberately

1. **Plaid and Guideline 5.1.1.** Apple expects apps in "highly regulated
   fields (such as banking and financial services)" to come from a legal
   entity, not an individual developer. SmartFolio is educational analysis and
   executes no trades — the right side of that line — but connecting real
   brokerage accounts changes how a reviewer reads it. **Recommended: ship v1
   with Plaid sandbox-only, or omit it.** It is the highest-risk element and
   the least essential to the app. There is also no authentication: anyone
   holding a workspace id has full read/write, which is fine for anonymous
   demo data and not fine for real imported holdings.

2. **Market-data quota.** The deep provider's free tier is roughly **25
   requests/day**, serialized ~1.3s apart. That is 25 *cache-missing* analyses
   per day across all users combined. The cache and stale-fallback make this
   fine for a demo; a public listing with real traffic exhausts it quickly and
   users past the cap see stale or offline data. The `stale_inputs` plumbing
   already exists to say so honestly in the UI — otherwise budget a paid data
   plan before real distribution.
