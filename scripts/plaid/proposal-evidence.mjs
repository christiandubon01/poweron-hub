#!/usr/bin/env node
/**
 * Prints version evidence for every prepared (UNINSTALLED) Plaid/Cash OS SQL proposal: SHA-256, size, line count, and the objects each one creates.
 * Read-only: it never connects to a database. Run before and after the owner approves an install, and paste the output into the approval record
 * so the installed SQL can be proven identical to the reviewed SQL.
 *
 *   node scripts/plaid/proposal-evidence.mjs            # table for humans
 *   node scripts/plaid/proposal-evidence.mjs --json     # machine-readable
 */
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'

export const PROPOSALS = [
  { id: 'plaid1b', migration: 'plaid1b_sync_audit', file: 'docs/plaid1b/sync-audit-proposal.sql', note: 'sync_runs half only once 2C is approved (see ledger)' },
  { id: 'plaid1c', migration: 'plaid1c_resumable_sync', file: 'docs/plaid1c/resumable-sync-proposal.sql', note: 'includes PLAID-1E corrections and 2C provenance setting' },
  { id: 'plaid2a', migration: 'plaid2a_pending_posted_continuity', file: 'docs/plaid2/pending-posted-continuity-proposal.sql', note: 'independent of 1B/1C' },
  { id: 'plaid2c', migration: 'plaid2c_provider_revision_history', file: 'docs/plaid2/provider-revision-history-proposal.sql', note: 'replaces the revisions half of 1B' },
  { id: 'plaid3b', migration: 'plaid3b_match_decisions', file: 'docs/plaid2/match-decisions-proposal.sql', note: 'one service_role-only function, no table/column/index; the Matches review stays read-only until it is installed' },
  { id: 'greenlight1b1', migration: 'greenlight1_interpretation_write_lockdown', file: 'docs/plaid2/interpretation-write-lockdown-proposal.sql', note: 'revokes browser INSERT/UPDATE on interpretations (finding B-1); recommended before plaid3b' },
]
// Files added by later phases are appended here by those phases (balances, reconciliation, economic events ...).
const EXTRA = 'docs/plaid2/proposals.extra.json'
if (existsSync(EXTRA)) PROPOSALS.push(...JSON.parse(readFileSync(EXTRA, 'utf8')))

export function evidence(p) {
  const text = readFileSync(p.file, 'utf8')
  const names = (re) => [...text.matchAll(re)].map(m => m[1]).filter((v, i, a) => a.indexOf(v) === i)
  return {
    ...p,
    sha256: createHash('sha256').update(text).digest('hex'),
    bytes: Buffer.byteLength(text), lines: text.split('\n').length,
    tables: names(/CREATE TABLE IF NOT EXISTS\s+(?:public\.)?(\w+)/gi),
    functions: names(/CREATE OR REPLACE FUNCTION\s+(?:public\.)?(\w+)/gi),
    alters: names(/ALTER TABLE\s+(?:IF EXISTS\s+)?(?:public\.)?(\w+)\s+(?:ADD|DROP|ALTER)/gi),
    transactional: /^\s*BEGIN;/m.test(text) && /^\s*COMMIT;/m.test(text),
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = PROPOSALS.map(evidence)
  if (process.argv.includes('--json')) console.log(JSON.stringify(all, null, 2))
  else for (const e of all) {
    console.log(`${e.id}  ${e.migration}\n  file     ${e.file}\n  sha256   ${e.sha256}\n  size     ${e.bytes} bytes, ${e.lines} lines, single transaction: ${e.transactional}\n  tables   ${e.tables.join(', ') || '-'}\n  functions ${e.functions.join(', ') || '-'}\n  alters   ${e.alters.join(', ') || '-'}\n  note     ${e.note}\n`)
  }
}
