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
  edge_key?: string
  [key: string]: unknown
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
  threshold?: number | null
  contamination?: number | string | null
  distribution_skewness?: number | null
}

export interface DistributionBin {
  bin: number
  total: number
  backbone: number
  normal: number
}

export interface ScoreStats {
  min: number
  max: number
  mean: number
  median: number
  std: number
  skewness: number
}

export interface ScoreHistogramBin {
  bin_left: number
  bin_right: number
  bin_center: number
  total: number
  anomalies: number
  normal: number
}

export interface RankedPoint {
  [key: string]: number
}

export interface ScatterPoint {
  [key: string]: number
}

export interface AnomalyInspector {
  method_id: string
  score_column: string
  selected_transform?: string | null
  threshold?: number | null
  contamination?: number | string | null
  counts: AnomalySummary
  stats: {
    raw: ScoreStats
    transformed: ScoreStats
    score_samples: ScoreStats
    decision_function: ScoreStats
  }
  histograms: {
    raw: ScoreHistogramBin[]
    transformed: ScoreHistogramBin[]
    score_samples: ScoreHistogramBin[]
    decision_function: ScoreHistogramBin[]
  }
  ranked_points: RankedPoint[]
  scatter_points: ScatterPoint[]
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
  | 'contamination'
  | 'multi_feature'

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
  contaminationByMethod: Partial<Record<MethodId, number>>
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


export type MultiFeatureScalingMode = 'none' | 'zscore' | 'minmax'

export interface ExtremeEdgeRow {
  source: string
  target: string
  edge_key: string
  score: number
  pa_score: number
  lp_score: number
  selected: boolean
  selected_by_pa: boolean
  selected_by_lp: boolean
  selected_by_pa_lp: boolean
  rank: number | null
  pa_rank: number | null
  lp_rank: number | null
  pa_lp_rank: number | null
  decision_function: number | null
  score_samples: number | null
}

export interface ExtremeSelectionBalance {
  top_10_pct: number
  bottom_10_pct: number
  middle_80_pct: number
  top_10_count?: number
  bottom_10_count?: number
  middle_80_count?: number
  selected_total?: number
}

export interface MultiFeatureScoreBalance extends ExtremeSelectionBalance {
  top_10_count: number
  bottom_10_count: number
  middle_80_count: number
  selected_total: number
}

export interface MultiFeatureJointCell {
  pa_region: string
  lp_region: string
  selected_count: number
  total_count: number
  pct_of_selected: number
}

export interface MultiFeatureScoreProfile {
  selected_total: number
  pa_score_balance: MultiFeatureScoreBalance
  lp_score_balance: MultiFeatureScoreBalance
  joint_grid: MultiFeatureJointCell[]
}

export interface ExtremeAnalysis {
  lowest: ExtremeEdgeRow[]
  highest: ExtremeEdgeRow[]
  selection_balance: ExtremeSelectionBalance
}

export interface MultiFeatureCaseResult {
  method_id: string
  label: string
  metrics: {
    flagged_edges: number
    edge_fraction: number
    node_fraction: number
    reachability: number
    connected_components: number
    retained_nodes: number
  }
  summary: Record<string, any>
  selected_edge_keys: string[]
  selected_node_ids: string[]
  extremes?: ExtremeAnalysis
}

export interface MultiFeatureScatterPoint {
  source: string
  target: string
  edge_key: string
  pa: number
  lp: number
  selected_by_pa: boolean
  selected_by_lp: boolean
  selected_by_pa_lp: boolean
}

export interface MultiFeatureQuadrantCount {
  quadrant: string
  total: number
  selected: number
}

export interface MultiFeatureOverlapSummary {
  edges: {
    common_to_all: { count: number; sample: string[] }
    unique: Record<string, { count: number; sample: string[] }>
    pairwise_jaccard: Record<string, number>
  }
  nodes: {
    common_to_all: { count: number; sample: string[] }
    unique: Record<string, { count: number; sample: string[] }>
    pairwise_jaccard: Record<string, number>
  }
}

export interface MultiFeatureExperimentResponse {
  dataset_id: string
  dataset_label: string
  is_custom: boolean
  score_source: ContaminationScoreSource
  session_id?: string | null
  feature_columns: string[]
  contamination: number | string
  scaling_mode: MultiFeatureScalingMode
  original_graph: GraphData
  cases: {
    pa: MultiFeatureCaseResult
    lp: MultiFeatureCaseResult
    pa_lp: MultiFeatureCaseResult
  }
  multi_feature_profile: MultiFeatureScoreProfile
  scatter: {
    points: MultiFeatureScatterPoint[]
    quadrant_counts: MultiFeatureQuadrantCount[]
  }
  overlap: MultiFeatureOverlapSummary
  interpretation: string
}

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
// ── Contamination lab types ──────────────────────────────────────
export type ContaminationScoreSource = 'compute_fresh' | 'session_scores'

export interface ContaminationRunResult {
  contamination_label: string
  contamination_value: number | null
  preprocessing_used: string
  threshold: number | null
  decision_function_threshold: number
  flagged_edges: number
  edge_fraction: number
  node_fraction: number
  reachability: number
  connected_components: number
  selected_edge_keys: string[]
  summary: AnomalySummary
  inspector: AnomalyInspector
  rows: Record<string, any>[]
}

export interface ContaminationExperimentResponse {
  dataset_id: string
  dataset_label: string
  is_custom: boolean
  score_source: ContaminationScoreSource
  session_id?: string | null
  original_graph: GraphData
  original_edge_keys: string[]
  method_id: string
  method_label: string
  score_column: string
  preprocessing_used: string
  stable_edge_key_format: string
  run_count: number
  runs: ContaminationRunResult[]
}
