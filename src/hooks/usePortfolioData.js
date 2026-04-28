// frontend/src/hooks/usePortfolioData.js
/**
 * React Query hooks wrapping all API calls.
 * Components import these — never call api.js directly.
 */

import { useQuery } from '@tanstack/react-query'
import {
  fetchPortfolio,
  fetchDrillDown,
  fetchHierarchyTable,
  fetchTraderContext,
} from '../services/api.js'

// Data stays fresh for 60 seconds before a background refetch
const STALE_TIME_MS = 60_000

// ---------------------------------------------------------------------------
// Portfolio home page
// ---------------------------------------------------------------------------

export function usePortfolio(timeRange = 'SI') {
  return useQuery({
    queryKey:  ['portfolio', timeRange],
    queryFn:   () => fetchPortfolio(timeRange),
    staleTime: STALE_TIME_MS,
  })
}

// ---------------------------------------------------------------------------
// Drill-down page (any entity_id)
// ---------------------------------------------------------------------------

export function useDrillDown(entityId, timeRange = 'SI') {
  return useQuery({
    queryKey:  ['drilldown', entityId, timeRange],
    queryFn:   () => fetchDrillDown(entityId, timeRange),
    staleTime: STALE_TIME_MS,
    enabled:   !!entityId,
  })
}

// ---------------------------------------------------------------------------
// Hierarchy table tabs (pods / strategies / traders / venues)
// ---------------------------------------------------------------------------

export function useHierarchyTable(entityType) {
  return useQuery({
    queryKey:  ['hierarchy', entityType],
    queryFn:   () => fetchHierarchyTable(entityType),
    staleTime: STALE_TIME_MS,
    enabled:   !!entityType,
  })
}

// ---------------------------------------------------------------------------
// Trader context — 3-tab breakdown (Venues | Pods | Strategies)
// Only fires when entityId is a trader — enabled guard in DrillDown.jsx
// ---------------------------------------------------------------------------

export function useTraderContext(entityId) {
  return useQuery({
    queryKey:  ['trader_context', entityId],
    queryFn:   () => fetchTraderContext(entityId),
    staleTime: STALE_TIME_MS,
    enabled:   !!entityId,
  })
}