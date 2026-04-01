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
  selected_transform?: string | null
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
  anomaliesReady: Record<string, boolean>
  backbonesReady: Record<string, boolean>
  evaluationReady: boolean
  currentStep: WizardStep

  currentView: AppView
  labTab: LabTab
  preprocessingByMethod: Partial<Record<MethodId, PreprocessingMode>>
  
}

export type PreprocessingMode =
  | 'none'
  | 'log'
  | 'minmax'
  | 'zscore'
  | 'log_minmax'


export type AppView = 'wizard' | 'lab'

export type LabTab =
  | 'scores'
  | 'preprocessing'
  | 'labeling'
  | 'backbone'
  | 'visualization'
  | 'exports'

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

// ── Research analysis types ───────────────────────────────────────
export type ResearchNetworkId = 'karate' | 'lesmis'
export type ResearchTransformId =
  | 'raw'
  | 'log'
  | 'minmax'
  | 'zscore'
  | 'log_minmax'
  | 'log_zscore'

export interface ResearchHistogramBin {
  bin_left: number
  bin_right: number
  bin_center: number
  count: number
}

export interface ResearchDistributionStats {
  mean: number
  median: number
  variance: number
  std: number
  min: number
  max: number
  skewness: number
  kurtosis: number
  zero_ratio: number
  unique_ratio: number
  histogram: ResearchHistogramBin[]
}

export interface ResearchDecisionSummary {
  feasible: boolean
  selected_transform: string
  reason: string
  shape_class: string
  decision_features: {
    skewness: number
    zero_ratio: number
    unique_ratio: number
  }
}

export interface ResearchBackboneSummary {
  n_total: number
  n_backbone: number
  pct_backbone: number
  node_count: number
  component_count: number
  edge_retention: number
  backbone_score_mean: number
  normal_score_mean: number
  jaccard_vs_raw?: number
  sample_edge_count_listed?: number
}

export interface ResearchTransformExperiment {
  transform_id: string
  label: string
  description: string
  transformed_stats?: ResearchDistributionStats
  backbone?: ResearchBackboneSummary
  selected_edges?: string[][]
  error?: string
}

export interface ResearchAnalysisResponse {
  network: string
  method: string
  score_column: string
  n_nodes: number
  n_edges: number
  distribution: ResearchDistributionStats & {
    shape_class: string
    recommended_transform: string
    auto_decision_reason: string
  }
  preprocessing_recommendation: ResearchDecisionSummary
  transformation_metadata: Record<string, { label: string; description: string }>
  transformation_experiments: Record<string, ResearchTransformExperiment>
  algorithmic_notes: {
    computational_cost: string
    runtime_classification_limitations: string
    design_tradeoff: string
  }
}