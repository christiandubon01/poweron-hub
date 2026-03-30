#!/usr/bin/env ts-node
// @ts-nocheck
/**
 * runMigration.ts — Runner for the v15r → PowerOn Hub data migration.
 *
 * Usage:
 *   npx ts-node src/scripts/runMigration.ts
 *
 * Prerequisites:
 *   1. Run migration 017_trigger_rules.sql in Supabase SQL Editor
 *   2. Place poweron_migration.json in the project root
 *   3. Set environment variables:
 *      - SUPABASE_URL (or VITE_SUPABASE_URL)
 *      - SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_ANON_KEY)
 *
 * Environment variables can be set in .env.local or exported:
 *   export SUPABASE_URL="https://your-project.supabase.co"
 *   export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
 */

import * as dotenv from 'dotenv'
import * as path from 'path'

// Load .env.local from project root
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

import { runMigration } from './migrateFromV15r'

async function main() {
  console.log('')
  console.log('╔═══════════════════════════════════════════╗')
  console.log('║  PowerOn Hub — v15r Migration Runner      ║')
  console.log('╚═══════════════════════════════════════════╝')
  console.log('')

  try {
    await runMigration()
    process.exit(0)
  } catch (err) {
    console.error('')
    console.error('❌ Migration failed:')
    console.error(err)
    process.exit(1)
  }
}

main()
