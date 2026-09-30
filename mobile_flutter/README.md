# Pivosacc (Flutter WebView shell)

Thin Flutter Android wrapper around the **Pivosacc mobile web UI** at
`~/Projects/sacco/fineract/mobile` (port **5174**, bind `0.0.0.0`).

## Why WebView first

Ships a installable APK so the Samsung S23 (and other devices) can use the
existing member banking UI on the LAN. A full native Flutter UI can replace
this shell later without changing the Fineract / mobile API surface.

## Default URL

`http://192.168.1.123:5174/` (Mac `en0` LAN IP at build time)

Long-press the app title (or tap the link icon) to override and persist a
different base URL.

## Prerequisites

- Mobile server running: `screen` session `pivosacc-mobile` or
  `cd ~/Projects/sacco/fineract/mobile && ./start-mobile.sh`
- Phone and Mac on the same LAN; Mac firewall must allow inbound TCP 5174

## Build & install

```bash
export PATH="$HOME/development/flutter/bin:$PATH"
export JAVA_HOME="$HOME/development/jdk/jdk-17.0.20.1+1/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"

cd ~/Projects/sacco/fineract/mobile_flutter
flutter pub get
flutter build apk --release

adb -s adb-R5CX51683ZA-eNPG4Z._adb-tls-connect._tcp install -r \
  build/app/outputs/flutter-apk/app-release.apk

adb -s adb-R5CX51683ZA-eNPG4Z._adb-tls-connect._tcp shell am start \
  -n tech.pivotventures.pivosacc/.MainActivity
```

Package id: `tech.pivotventures.pivosacc` · App name: **Pivosacc**

## Cleartext HTTP

`android:usesCleartextTraffic="true"` plus
`res/xml/network_security_config.xml` so the WebView can load `http://` LAN URLs.
