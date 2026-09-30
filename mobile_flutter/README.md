# Pivosacc — native Flutter member app

Material 3 banking UI (no WebView). Talks to Fineract via LAN proxy:

`http://192.168.1.123:5174/fineract-provider/api/v1`

Demo login: member `000000001`, PIN `1234`.

## UI notes (v1.0.2)

- Statement amounts: **deposits green**, **withdrawals red** (no meta/dev labels)
- Deposit screen green-themed; withdraw screen red-themed
- Native bottom dock + home Deposit FAB
- Approval gallery: `~/Projects/sacco/proposals/flutter-ui-approval/`

**Do not** ship APK to phone until Osbert approves the gallery PNGs.
