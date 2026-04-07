#!/usr/bin/env node
// done.js — task completion reporter for PowerOn Hub scheduled tasks
const [,, taskId, hash] = process.argv
if (!taskId || !hash) {
  console.log('Usage: node done.js <TASK_ID> <commit_hash>')
  process.exit(0)
}
const ts = new Date().toISOString()
console.log(`[${ts}] ✅ ${taskId} COMPLETE — commit: ${hash}`)
