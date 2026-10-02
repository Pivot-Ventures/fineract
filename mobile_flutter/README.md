# Pivosacc — member banking app (Flutter, Android)

Talks only to the member gateway (`../mobile_gateway`); it holds no staff credentials and never calls Fineract directly.

- First run: member number + activation code from a branch, then a 4-digit PIN. The phone is bound to the account.
- Every app open, 3 minutes idle or 1 minute in the background → PIN screen. The session token lives in memory only; the device key is in Android Keystore-backed secure storage.
- Every transfer and loan repayment asks for the PIN again (checked by the gateway).
- Release builds: HTTPS only, screenshots/screen recording blocked (`FLAG_SECURE`), app data excluded from backups.

## Build

The gateway URL is fixed at build time:

```bash
flutter build apk --release --dart-define=GATEWAY_URL=https://desk.example.co.ug/mobile/api
```

Release builds refuse a non-https URL. Debug builds may use plain HTTP on the LAN, e.g. against the demo gateway in `../mobile_gateway` (`tests.demo`):

```bash
flutter run --dart-define=GATEWAY_URL=http://192.168.1.123:8700
```

## Before Play Store release

- Create an upload keystore and a release `signingConfig` (`android/app/build.gradle.kts` still signs release builds with the debug key).
- Deposits, withdrawals and bill payments are "coming soon" screens until a mobile-money / biller integration exists.
