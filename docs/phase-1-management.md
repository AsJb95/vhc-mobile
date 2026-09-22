# VHC management Phase 1

The mobile app reuses sales, sale_items, stock_batches and transfer_orders. Home
opens existing reports with the selected period and separates sales receipts
from credit collections. Inventory values use purchase cost: warehouse stock is
packs, pharmacy stock is individual units. Missing costs are disclosed.

## Credit rollout

Apply `supabase/migrations/20260921000100_credit_payments.sql` to the shared VHC
Supabase project after the existing schema and common authentication migrations.
This migration has been prepared locally, not applied to production.

The new shared ledger references original sales. It does not copy bills or change
their payment mode. The POS can use the same `collect_credit_payment` function.
Collections support Cash, UPI and Card; caller request IDs make retries idempotent.
Row locks prevent concurrent overpayment. Direct insert/update/delete is denied
to authenticated clients. Paid sales cannot be deleted while receipts reference
them. Corrections/refunds require a later audited reversal workflow.

Before enabling collections, reconcile historical settlements. Existing Credit
bills have no repayment data, so their initial balance is the full bill amount.
Until the migration is deployed, credit is shown as unavailable; collection does
not fall back to changing a bill or storing payments locally.

The existing shared schema is single-clinic: sales have location_id, not clinic_id.
This change does not claim multi-clinic isolation. Tenant scoping must precede
onboarding another clinic. Existing database read policies allow known users
to read shared data; mobile screen restrictions are not a replacement for those
server policies. The new credit ledger enforces admin access on the server.

## Roles and checks

Platform admin: all mobile capabilities. Existing `admin` means Clinic Admin.
Existing `pharmacist` means Pharmacy Staff: stock and transfers, no reports or
credit. Transfer approval and return creation retain the existing server requirement for warehouse/admin write access; pharmacy staff can view their history. Warehouse managers retain warehouse writes. Viewers see reports and no
stock/credit actions. Unknown roles have only account/settings access.

Before production rollout, exercise collection with two concurrent sessions,
retry the same request ID, verify overpayment rejection and verify viewer/staff
denial against the deployed database. Local unit checks cover role mappings,
currency inputs, ledger reconciliation, pagination and pack/unit valuation.
Expenses and reliable historical profit remain outside this Phase 1 integration.
