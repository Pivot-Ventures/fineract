# Pivosacc member app (native Flutter)

Material 3 native member banking — **no WebView**. Talks to Apache Fineract through the LAN mobile proxy:

```
http://192.168.1.123:5174/fineract-provider/api/v1
```

Keep `mobile/server.py` on `*:5174` while demoing.

## Demo

- Member: `000000001` (Nakato Grace)
- PIN: `1234`
- Peer transfer: `000000002` (Okello James)

## Screens

Login · Home balances · Deposit (green) · Withdraw (red) · Transfer · Pay utilities (NWSC / UMEME / DStv / School logos) · Statement · Loans + repay · Profile / More

## Build / install (S23)

```bash
export PATH="$HOME/development/flutter/bin:$HOME/Library/Android/sdk/platform-tools:$PATH"
cd ~/Projects/sacco/fineract/mobile_flutter
flutter pub get
flutter build apk --release
adb -s adb-R5CX51683ZA-eNPG4Z._adb-tls-connect._tcp install -r build/app/outputs/flutter-apk/app-release.apk
adb -s adb-R5CX51683ZA-eNPG4Z._adb-tls-connect._tcp shell am start -n tech.pivotventures.pivosacc/.MainActivity
```

Long-press the app title to change API base URL.
