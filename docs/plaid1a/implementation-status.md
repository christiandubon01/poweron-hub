# PLAID-1A — existing connection safety foundation

Status: code complete, **not activated**. No production SQL, Plaid Link session, account connection, Item change, or financial data change.

## What exists now

- **Add accounts to the existing Item** (`mode: 'add_accounts'`): Plaid Link update mode with `update.account_selection_enabled: true` on the stored access token of a healthy Item. No products, no history request, no new Item, no public-token exchange. Off unless the server sets `PLAID_ACCOUNT_ADDITIONS_ENABLED=true`.
- **Duplicate Item guard** (active): a new connection needs the owner's statement that it is a different bank when one is already connected; the exchange refuses an institution that already has a live Item in the same environment, first from Link's institution id (before any access token exists), then authoritatively from Plaid's `/item/get` (the extra Item is removed at Plaid and never saved). Institution names are never compared. An existing Item without an institution id makes new connections stop for owner review.
- **Read-only preview** (`plaid-accounts` action `preview`): confirms Plaid still reports the same item id, then lists connected / newly shared / no longer shared accounts. Saves nothing; returns no provider ids, balances or tokens.
- **Explicit save** (`plaid-accounts` action `save_new`, switched): stores only the previewed newly shared accounts on the same Item, unmapped. Existing account rows are never changed or retired; nothing is mapped, synced or classified.
- After a brand-new connection, account discovery now runs only for the connection just created, never as a side effect on other connections.

## Limitations

- `transactions.days_requested` is fixed once Transactions is on an Item (Plaid SDK documentation). The existing Item keeps its original 90-day request; accounts added through update mode cannot receive more history without a new Item, which the owner has ruled out. Exact backfill for added Wells Fargo accounts: verify in Sandbox/Production observation.
- For US OAuth institutions with their own account-selection screen (most, likely including Wells Fargo), Plaid shows Account Select in update mode regardless of the flag; the bank's consent screen decides which accounts are shared. Previously shared accounts must stay selected; the preview flags any that stop being shared and never retires them automatically.
- Sync is unchanged: owner-triggered, 8-second budget, all-or-nothing cursor. Transactions for a shared-but-unsaved account fail the whole sync closed (`ACCOUNT_UNKNOWN`, cursor kept) until the account is saved. A large first backfill may exceed the time budget; see the next phase.

## Activation checklist (separate owner approval)

1. Sandbox: enable the switch, run Add accounts on a Sandbox Item, check preview, save, sync; confirm existing provider account ids and mappings are unchanged.
2. Production: create the Cash OS accounts first; set `PLAID_ACCOUNT_ADDITIONS_ENABLED=true`; Add accounts at Wells Fargo keeping existing accounts selected; preview; save; sync; keep new accounts unmapped until account-type-aware reporting ships.
3. Rollback: unset the switch (UI hides the controls; server refuses). Saved accounts stay as unmapped evidence.

Tests: `src/services/bankProvider/__tests__/plaid1aExistingConnection.test.ts`.
