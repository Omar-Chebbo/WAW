// ── Graph types ───────────────────────────────────────────────────
export interface GraphNode {
  id: string
  degree: number
  x?: number
  y?: number
}

export interface GraphLink {
  source: string | GraphNode
  target: string | GraphNode
  weight: number
  [key: string]: unknown   // extra score columns
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
  sampled?: boolean
}

export interface GraphStats {
  nodes: number
  edges: number
  density: number
  avg_degree: number
  components: number
  is_weighted: boolean
  max_degree: number
}

// ── Dataset types ─────────────────────────────────────────────────
export interface Dataset {
  id: string
  filename: string
  path: string
  stats: GraphStats
}

// ── Method types ──────────────────────────────────────────────────
export type MethodId = 'hss' | 'df' | 'pa' | 'lp' | string

export interface MethodInfo {
  id: MethodId
  label: string
  short: string
  description: string
  requires_anomaly: boolean
  color: string
}

// ── Anomaly types ─────────────────────────────────────────────────
export interface AnomalySummary {
  flagged: number
  total: number
  pct: number
  score_min: number
  score_max: number
  score_mean: number
}

export interface DistributionBin {
  bin: number
  total: number
  backbone: number
  normal: number
}

// ── Backbone types ────────────────────────────────────────────────
export interface BackboneSummary {
  method_id: string
  nodes: number
  edges: number
  original_edges: number
  edge_retention: number
  node_retention: number
}

// ── Evaluation types ──────────────────────────────────────────────
export interface MetricResult {
  label: string
  value: number
  deviation: number
}

export interface EvaluationReport {
  [methodId: string]: {
    [metricId: string]: MetricResult
  }
}

export interface MetricMeta {
  id: string
  label: string
}

// ── WebSocket progress ────────────────────────────────────────────
export interface ProgressEvent {
  type: 'progress' | 'complete' | 'error'
  method?: string
  stage?: string
  progress?: number
  message: string
  session?: string
}

// ── Session / wizard state ────────────────────────────────────────
export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6 | 7

export interface SessionState {
  sessionId: string
  datasetId: string | null
  isCustomDataset: boolean
  datasetStats: GraphStats | null
  selectedMethods: MethodId[]
  scoresReady: boolean
  anomaliesReady: Record<string, boolean>   // { method_id: true/false }
  backbonesReady: Record<string, boolean>
  evaluationReady: boolean
  currentStep: WizardStep
}


// ── Distribution types ────────────────────────────────────────────
export interface DistributionSeries {
  original: number[]
  backbone: number[]
  ks: number
}

export interface MethodDistributions {
  degree: DistributionSeries
  weight: DistributionSeries
}

export type DistributionReport = Record<string, MethodDistributions>