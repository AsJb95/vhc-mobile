# Version history

All notable VHC Mobile releases are recorded here.

## 1.4.5 — 2026-10-20

- **Appearance & 6-Theme Expansion**:
  - Upgraded Settings > Appearance with 6 selectable themes: System Default, Modern Dark, Modern Light, Midnight AMOLED (pure `#000000`), Classic Light, and High Contrast (WCAG AAA).
  - Added live Theme Preview cards with category pills, color palette swatches, and instant dynamic switching.
  - Full semantic token contract parity across all palettes with persistent offline storage in `AsyncStorage`.
- **Printed Medicine Bill Scanner & OCR Engine**:
  - Added `[ Scan Bill ]` action to Warehouse Main Stock beside `[ New Entry ]`.
  - Added Camera capture and Photo Gallery selector via `expo-image-picker` with permission handling.
  - Multi-row invoice parsing service (`billOcrService.js`) extracting Distributor, Inv No, Date, Medicine Name, Batch, Expiry, Qty, Free scheme, UPP, MRP, PTR, and GST.
  - Intelligent medicine matching engine (`medicineMatcher.js`) with exact normalization, root token extraction, and fuzzy similarity scoring against VHC inventory.
  - Complete Scanned Bill Review Screen (`ScanBillReviewScreen.jsx`) with color-coded badges (Green verified, Amber review, Red incomplete), inline row editing, item removal, and manual additions.
  - Stock quantity converter (`stockConverter.js`) maintaining fractional strips, free scheme addition to warehouse strips, and unit conversions.
  - Prepared atomic transaction import SQL migration (`20261020000200_atomic_purchase_bill_import.sql`) with advisory locking and duplicate invoice protection.
  - Guarded by `ATOMIC_BILL_IMPORT_RPC_ENABLED = false` for safe sequential fallback.
- **Atomic Transfer Safety & Permissions**:
  - Prepared atomic database migration for stock transfers (`20261020000100_atomic_stock_transfers.sql`).
  - Fixed Pharmacist role permission checks on Pending Transfers and Stock Returns.
  - Added release keystore property fallback in Android build configuration.
  - 15 Jest test suites / 150 automated tests passing with 0 ESLint warnings.

## 1.4.4 — 2026-09-22

- Added the unified VHC management dashboard.
- Added Today, Yesterday, This Month, and custom-date revenue views.
- Added Cash, UPI, Card, Credit, and credit-collection breakdowns.
- Added credit part-payment, full settlement, and repayment history.
- Added combined pharmacy and warehouse stock valuation.
- Added 30, 60, 90, and 180-day expiry exposure and value-at-risk views.
- Added full transfer and return history with status and direction filters.
- Added role-based navigation and write-action enforcement.
- Corrected warehouse-strip to pharmacy-unit stock conversion.

Database note: credit collection requires the included
`supabase/migrations/20260921000100_credit_payments.sql` migration.

## 1.4.3 — 2026-09-15

- Improved warehouse and pharmacy stock workflows.
- Added units-per-strip handling to stock transfers.
- Improved transfer history and stock editing safeguards.

## 1.4.2 — 2026-09-15

- Fixed stock-value calculations and display.
- Improved Main Stock and Pharmacy Stock consistency.

## 1.4.1 — 2026-09-09

- Added Pharmacy-to-Warehouse stock returns.
- Added live pending transfer and return lists.
- Added transfer audit fields and approval history.

## 1.2.1 — 2026-09-02

- Added shared VHC authentication, clinic context, and platform-admin access.

## 1.1.0 — 2026-08-31

- Added the five-tab mobile navigation.
- Added pharmacy reports, stock alerts, patient lookup, and read-only credit views.
- Added light and dark themes.

## 1.0.0 — 2026-08-30

- Initial VHC Warehouse and Pharmacy companion app.
