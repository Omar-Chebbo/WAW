/**
 * constants/methods.ts
 * Client-side copy of the method metadata so we don't need
 * an extra API call just to render the method selection cards.
 */
import type { MethodInfo } from '../types'

export const METHODS: MethodInfo[] = [
  {
    id: 'hss',
    label: 'High Salience Skeleton',
    short: 'HSS',
    description: 'Keeps edges that appear in the shortest-path trees of most node pairs. No anomaly detection needed — uses a fixed salience threshold.',
    requires_anomaly: false,
    color: '#0F6E56',
  },
  {
    id: 'df',
    label: 'Disparity Filter',
    short: 'DF',
    description: 'A statistical test that checks whether an edge weight is anomalously large relative to its node\'s total connection strength.',
    requires_anomaly: false,
    color: '#BA7517',
  },
  {
    id: 'pa',
    label: 'Preferential Attachment',
    short: 'PA',
    description: 'Scores edges by the product of their endpoint degrees. High-scoring edges connect well-connected hubs and form the backbone.',
    requires_anomaly: true,
    color: '#3C3489',
  },
  {
    id: 'lp',
    label: 'Local Path Index',
    short: 'LP',
    description: 'Scores edges by counting alternative 2-hop and 3-hop paths between their endpoints. Edges with no alternatives are backbone candidates.',
    requires_anomaly: true,
    color: '#993C1D',
  },
]

export const METHOD_MAP = Object.fromEntries(METHODS.map(m => [m.id, m]))
