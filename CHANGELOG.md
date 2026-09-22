# Version history

All notable VHC Mobile releases are recorded here.

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
