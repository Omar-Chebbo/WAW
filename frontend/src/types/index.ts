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
  fixed_layout?: boolean
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
  requires_preprocessing: boolean
  selection_method: string | null
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
  selection_fraction?: number | null
  selection_count?: number | null
  cutoff_rank?: number | null
  cutoff_score_samples?: number | null
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
  selection_fraction?: number | null
  selection_count?: number | null
  cutoff_rank?: number | null
  cutoff_score_samples?: number | null
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
  | 'iterative'

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

export interface RegionConfig {
  high_pct: number
  low_pct: number
  middle_pct: number
}

export interface Scatter3DPoint {
  source: string
  target: string
  edge_key: string
  x: number    // PA anomaly score (IF score_samples)
  y: number    // LP anomaly score (IF score_samples)
  z: number    // PA+LP anomaly score (IF score_samples)
  is_backbone: boolean
  pa_rank: number
  lp_rank: number
  pa_lp_rank: number
}

export interface Scatter3DData {
  points: Scatter3DPoint[]
  backbone_count: number
  non_backbone_count: number
  backbone_contamination: number
}

export interface ExtremeSelectionBalance {
  top_10_pct: number
  bottom_10_pct: number
  middle_80_pct: number
  top_10_count?: number
  bottom_10_count?: number
  middle_80_count?: number
  selected_total?: number
  region_config?: RegionConfig
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
  multifeature_novelty: {
    value: number | null
    novel_edges: number
    multi_edges: number
  }
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
  score_source_used?: string
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
  scatter_3d: Scatter3DData
  region_config: RegionConfig
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
  selection_fraction?: number
  selection_rule?: string
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
  selection_fraction?: number
  selection_rule?: string
  transformation_metadata: Record<string, { label: string; description: string }>
  transformation_experiments: Record<string, ResearchTransformExperiment>
  algorithmic_notes: {
    computational_cost: string
    runtime_classification_limitations: string
    design_tradeoff: string
  }
}
// ── Contamination lab types ──────────────────────────────────────
export type ContaminationScoreSource = 'auto' | 'reuse' | 'recompute' | 'session_scores'

export type ScoreStrategy = 'auto' | 'reuse' | 'recompute'

export interface ScoreCacheMethodStatus {
  exists: boolean
  status: 'cached' | 'derivable' | 'missing'
  cached: boolean
  can_build_from_components: boolean
  components_available: string[]
  cached_at?: string | null
  rows?: number | null
  columns?: string[] | null
  path?: string | null
}

export interface ScoreCacheStatusResponse {
  dataset_id: string
  is_custom: boolean
  dataset_name: string
  dataset_fingerprint: string
  cache_version: string
  methods: Record<string, ScoreCacheMethodStatus>
}

export interface ContaminationNovelty {
  novelty_fraction: number | null
  novel_edges: number
  pa_lp_edges: number
  pa_edges: number
  lp_edges: number
  single_feature_union_edges: number
  overlap_pa: number
  overlap_lp: number
  jaccard_pa: number
  jaccard_lp: number
  novel_edge_keys: string[]
}

export interface ContaminationRunResult {
  contamination_label: string
  contamination_value: number | null
  preprocessing_used: string
  threshold: number | null
  cutoff_rank?: number | null
  cutoff_score_samples?: number | null
  decision_function_threshold?: number | null
  flagged_edges: number
  edge_fraction: number
  node_fraction: number
  reachability: number
  connected_components: number
  selected_edge_keys: string[]
  /** Same nine evaluation metrics, value and relative deviation, as Wizard Step 7. */
  metrics?: Record<string, MetricResult>
  /** Defined for PA+LP runs: unique joint edges against same-fraction PA and LP baselines. */
  novelty?: ContaminationNovelty
  summary: AnomalySummary
  inspector: AnomalyInspector
  rows: Record<string, any>[]
}

export interface ContaminationExperimentResponse {
  dataset_id: string
  dataset_label: string
  is_custom: boolean
  score_source: ContaminationScoreSource
  score_source_used?: string
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


// ── Iterative extraction lab types ───────────────────────────────
export type IterativeMethodId = 'pa' | 'lp' | 'pa_lp'

export interface IterativeMetrics {
  final_edges: number
  retained_nodes: number
  edge_fraction: number
  node_fraction: number
  reachability: number
  connected_components: number
  transitivity: number
  transitivity_deviation: number
  avg_clustering: number
  avg_clustering_deviation: number
  degree_entropy: number
  degree_entropy_deviation: number
  weight_entropy: number
  weight_entropy_deviation: number
  avg_path_length: number
  avg_path_length_deviation: number
  degree_ks: number
  weight_ks: number
  extraction?: string
  target_percent?: number
  target_edges?: number
  stage_count?: number
}

export interface IterativeStageResult {
  stage_index: number
  stage_percent_from_original: number
  stage_target_edges: number
  input_table_size: number
  selected_edges: number
  cutoff_rank: number
  cutoff_score_samples: number | null
  score_stats: Record<string, { min: number | null; max: number | null; mean: number | null; median: number | null }>
  model_output_histogram?: IterativeFeatureHistogram
  selected_edge_keys: string[]
  selected_rows: Record<string, any>[]
  auto_completion?: boolean
}

export interface IterativeRegionRow {
  region: string
  total_edges: number
  one_shot_selected: number
  iterative_selected: number
  common: number
  one_shot_only: number
  iterative_only: number
  one_shot_pct_of_region: number
  iterative_pct_of_region: number
  [stageKey: string]: string | number
}

export interface IterativeHistogramBin {
  bin_index: number
  start: number | null
  end: number | null
  all_count: number
  selected_count: number
}

export interface IterativeFeatureHistogram {
  feature: string
  label: string
  input_edges: number
  selected_edges: number
  selected_share_percent: number
  min: number | null
  max: number | null
  bins: IterativeHistogramBin[]
}

export interface IterativeHistogramGroup {
  label: string
  input_table_size: number
  selected_edges: number
  stage_index?: number
  stage_percent_from_original?: number
  histograms: IterativeFeatureHistogram[]
  model_output_histogram?: IterativeFeatureHistogram
}

export interface IterativeScatterPoint {
  edge_key: string
  source: string
  target: string
  score?: number | null
  pa_score?: number | null
  lp_score?: number | null
  pa?: number | null
  lp?: number | null
  one_shot_rank?: number | null
  one_shot_score_samples?: number | null
  one_shot_decision_function?: number | null
  stage?: number | null
  stage_rank?: number | null
  selection_category: 'common' | 'one_shot_only' | 'iterative_only' | 'not_selected' | string
  region?: string
  region_3x3?: string
}

export interface IterativeMethodResult {
  method_id: IterativeMethodId
  label: string
  short: string
  features: string[]
  target_percent: number
  target_edges: number
  stage_percents: number[]
  region_config?: { low_percent: number; high_percent: number; middle_percent: number }
  summary_rows: Record<string, any>[]
  one_shot: { metrics: IterativeMetrics; selected_edge_keys: string[] }
  iterative: { metrics: IterativeMetrics; selected_edge_keys: string[] }
  stages: IterativeStageResult[]
  overlap: {
    common: number
    only_one_shot: number
    only_iterative: number
    one_shot_edges: number
    iterative_edges: number
    jaccard: number
    common_sample: string[]
    only_iterative_sample: string[]
    only_one_shot_sample: string[]
  }
  region_analysis: {
    region_type: string
    thresholds: Record<string, any>
    rows: IterativeRegionRow[]
    high_tail_domination: Record<string, any>
  }
  score_histograms?: {
    one_shot: IterativeHistogramGroup
    stages: IterativeHistogramGroup[]
  }
  rank_scatter: {
    mode: string
    x_axis: string
    y_axis: string
    thresholds: Record<string, any>
    points: IterativeScatterPoint[]
  }
  feature_scatter?: {
    mode: string
    x_axis: string
    y_axis: string
    thresholds: Record<string, any>
    points: IterativeScatterPoint[]
  } | null
  graph_overlay: GraphData
  edge_inspector: Record<string, any>[]
  interpretation: string
}

export interface IterativeCompareAll {
  entries: Record<string, any>[]
  jaccard_keys: string[]
  jaccard_matrix: Record<string, any>[]
  region_summary: Record<string, any>[]
  interpretation: string
}

export interface IterativeExtractionResponse {
  dataset_id: string
  dataset_label: string
  is_custom: boolean
  score_source: ContaminationScoreSource
  score_source_used?: string
  session_id?: string | null
  selection_rule: string
  stage_percent_reference: string
  region_percent_reference?: string
  region_config?: { low_percent: number; high_percent: number; middle_percent: number }
  supported_methods: IterativeMethodId[]
  target_percent: number
  stage_percents: number[]
  original_edges: number
  original_nodes: number
  original_graph: GraphData
  methods: Partial<Record<IterativeMethodId, IterativeMethodResult>>
  compare_all: IterativeCompareAll
}

export interface VisualComparisonResponse {
  method_id: string
  score_column: string
  low_percent: number
  high_percent: number
  low_count: number
  high_count: number
  if_count: number
  nodes: number
  edges: number
  graph: GraphData
}
