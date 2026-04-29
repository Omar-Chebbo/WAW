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
    requires_preprocessing: false,
    selection_method: null,
    color: '#0F6E56',
  },
  {
    id: 'df',
    label: 'Disparity Filter',
    short: 'DF',
    description: 'A statistical test that checks whether an edge weight is anomalously large relative to its node\'s total connection strength.',
    requires_anomaly: false,
    requires_preprocessing: false,
    selection_method: null,
    color: '#BA7517',
  },
  {
    id: 'pa',
    label: 'Preferential Attachment + IF',
    short: 'PA+IF',
    description: 'Scores edges by the product of their endpoint degrees. High-scoring edges connect well-connected hubs and form the backbone.',
    requires_anomaly: true,
    requires_preprocessing: true,
    selection_method: 'if',
    color: '#3C3489',
  },
  {
    id: 'lp',
    label: 'Local Path Index + IF',
    short: 'LP+IF',
    description: 'Scores edges by counting alternative 2-hop and 3-hop paths between their endpoints. Edges with no alternatives are backbone candidates.',
    requires_anomaly: true,
    requires_preprocessing: true,
    selection_method: 'if',
    color: '#993C1D',
  },
  {
    id: 'pa_lp',
    label: 'PA + LP (Multi-Feature)',
    short: 'PA+LP',
    description: 'Combines Preferential Attachment and Local Path as a two-feature anomaly-detection input for comparative research in the Lab.',
    requires_anomaly: true,
    requires_preprocessing: false,
    selection_method: 'if',
    color: '#0F766E',
  },
  // ── Direct Thresholding Methods (no Isolation Forest) ───────────
  {
    id: 'high_pa',
    label: 'High PA (Direct Threshold)',
    short: 'High PA',
    description: 'Directly selects the top X% of edges with the highest PA scores as backbone. No Isolation Forest is used.',
    requires_anomaly: true,
    requires_preprocessing: false,
    selection_method: 'direct_high',
    color: '#4F46E5',
  },
  {
    id: 'low_pa',
    label: 'Low PA (Direct Threshold)',
    short: 'Low PA',
    description: 'Directly selects the bottom X% of edges with the lowest PA scores as backbone. No Isolation Forest is used.',
    requires_anomaly: true,
    requires_preprocessing: false,
    selection_method: 'direct_low',
    color: '#7C3AED',
  },
  {
    id: 'high_lp',
    label: 'High LP (Direct Threshold)',
    short: 'High LP',
    description: 'Directly selects the top X% of edges with the highest LP scores as backbone. No Isolation Forest is used.',
    requires_anomaly: true,
    requires_preprocessing: false,
    selection_method: 'direct_high',
    color: '#DC2626',
  },
  {
    id: 'low_lp',
    label: 'Low LP (Direct Threshold)',
    short: 'Low LP',
    description: 'Directly selects the bottom X% of edges with the lowest LP scores as backbone. No Isolation Forest is used.',
    requires_anomaly: true,
    requires_preprocessing: false,
    selection_method: 'direct_low',
    color: '#EA580C',
  },
]

export const METHOD_MAP = Object.fromEntries(METHODS.map(m => [m.id, m]))
