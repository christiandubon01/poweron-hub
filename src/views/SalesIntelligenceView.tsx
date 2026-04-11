// @ts-nocheck
/**
 * SalesIntelligenceView.tsx
 * INT-1 — Unified Sales Intelligence view wrapper.
 *
 * Wraps SalesIntelligencePanel with a route-compatible view shell.
 * Contains 5 tabs: Practice, Live Call, Leads, Pipeline, Coach
 *   Practice → SparkTraining (ST1-3)
 *   Leads    → HunterPanel (HT1-14)
 */

import React from 'react'
import { SalesIntelligencePanel } from '@/components/salesIntel/SalesIntelligencePanel'

export default function SalesIntelligenceView() {
  return <SalesIntelligencePanel />
}
