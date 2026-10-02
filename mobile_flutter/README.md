# Pivosacc — native Flutter member app

Material 3 banking UI (no WebView). Default API base is live Fineract:

`https://sacco.pivotventures.tech/fineract-provider/api/v1`

A previously saved LAN or desk-demo base (private IP, localhost, or port `5174`) is migrated to that URL on startup. Long-press the home title to override it.

Demo login: member `000000001`, PIN `1234` (also accepts `0000`). There is no live member-gateway PIN setup.

## UI notes (v1.0.12)

- Option B center-notch dock: Home, Transfer, Deposit FAB, Bills, Loans, More
- Home account carousel and activity receipt
- Full deposit, bills, transfer, and loans flows; loan repay confirms with PIN
- Statement amounts: **deposits green**, **withdrawals red**
