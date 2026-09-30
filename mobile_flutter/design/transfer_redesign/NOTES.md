# Pivosacc Transfer tab redesign — awaiting approval

**Status:** Mockups only. **No adb install.**  
**Dock:** Option B center-notch + colored nav — **locked / unchanged**.

## Envato / ThemeForest cites
1. **Bankix** (Internal Transfer, Send to Contact, Payment Successfully) — https://themeforest.net/item/bankix-ewallet-banking-app-figma-ui-template/64085306
2. **Payple** (Transfer & Payment Flow) — https://themeforest.net/item/payple-digital-banking-fintech-app-ui-kit/62210496
3. **Envato Elements — Transfer Money Mobile App UI Kit** — https://elements.envato.com/transfer-money-mobile-app-ui-kit-34FUEEZ
4. **Money Sending Mobile App UI Kit** (confirm / fees / success pattern) — https://uiworkshop.com/product/money-sending-mobile-app-ui-kit-6767/

## Screens
| File | Purpose |
|------|---------|
| `transfer_home.png` | Landing: mode chip, From account, To member search, amount + chips, note, Continue |
| `transfer_between.png` | Own-accounts mode: From/To savings with swap, amount, Continue |
| `transfer_confirm.png` | Review amount / from / to / note · Confirm & send · Edit |
| `transfer_success.png` | Receipt-style success (ref, accounts, date, status) · Done |
| `compare_transfer.png` | Side-by-side |

Demo context: **Nakato Grace**, A/C **000000001** → **000000002**, brand `#21409A`, deposit green, teal selected Transfer tab.

## Planned interactivity (after approval)
- Segment: Other member ↔ Own accounts
- From/To pickers → account sheets
- Member search (existing Fineract `searchClients`)
- Amount chips + keypad; Continue → confirm → API `accountTransfer` → success receipt
- Edit on confirm returns to form; Done closes to Transfer/Home

## Out of scope this pass
- Dock / FAB / nav icon changes
- Phone install

## Shipped
Implemented in Flutter v1.0.10+11 — live shot `s23_transfer_live.png`.
