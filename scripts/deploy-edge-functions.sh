#!/bin/bash
# ============================================================================
# deploy-edge-functions.sh — Deploy all Supabase Edge Functions
#
# Prerequisites:
#   1. Install Supabase CLI: npm install -g supabase
#   2. Login: supabase login
#   3. Link project: supabase link --project-ref edxxbtyugohtowvslbfo
#
# Usage: bash scripts/deploy-edge-functions.sh
# ============================================================================

set -e

echo "╔═══════════════════════════════════════════╗"
echo "║  PowerOn Hub — Edge Function Deployment   ║"
echo "╚═══════════════════════════════════════════╝"
echo ""

# Check CLI
if ! command -v supabase &> /dev/null; then
  echo "❌ Supabase CLI not found. Install with:"
  echo "   npm install -g supabase"
  echo "   supabase login"
  echo "   supabase link --project-ref edxxbtyugohtowvslbfo"
  exit 1
fi

# Deploy each function
echo "🚀 Deploying create-checkout..."
supabase functions deploy create-checkout --no-verify-jwt=false
echo "✅ create-checkout deployed"
echo ""

echo "🚀 Deploying daily-briefing..."
supabase functions deploy daily-briefing --no-verify-jwt=true
echo "✅ daily-briefing deployed"
echo ""

echo "🚀 Deploying stripe-webhook..."
supabase functions deploy stripe-webhook --no-verify-jwt=true
echo "✅ stripe-webhook deployed"
echo ""

echo "🚀 Deploying nightly-backup..."
supabase functions deploy nightly-backup --no-verify-jwt=true
echo "✅ nightly-backup deployed"
echo ""

# Set secrets
echo "📦 Setting Edge Function secrets..."
echo "   (Only needed once — skip if already set)"
echo ""
echo "   Run these commands manually with your real keys:"
echo ""
echo "   supabase secrets set STRIPE_SECRET_KEY=sk_live_..."
echo "   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_..."
echo "   supabase secrets set STRIPE_PRICE_SOLO_MONTHLY=price_..."
echo "   supabase secrets set STRIPE_PRICE_SOLO_ANNUAL=price_..."
echo "   supabase secrets set STRIPE_PRICE_TEAM_MONTHLY=price_..."
echo "   supabase secrets set STRIPE_PRICE_TEAM_ANNUAL=price_..."
echo "   supabase secrets set STRIPE_PRICE_ENTERPRISE_MONTHLY=price_..."
echo "   supabase secrets set STRIPE_PRICE_ENTERPRISE_ANNUAL=price_..."
echo ""

echo "════════════════════════════════════════════"
echo "✅ All Edge Functions deployed successfully!"
echo "════════════════════════════════════════════"
