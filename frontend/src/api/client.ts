/**
 * api/client.ts
 * Typed Axios instance + React Query hooks for every backend endpoint.
 */
import axios from 'axios'
import { useQuery } from '@tanstack/react-query'
import type {
  Dataset,
  GraphData,
  GraphStats,
  AnomalySummary,
  DistributionBin,
  BackboneSummary,
  EvaluationReport,
  MetricMeta,
  ResearchAnalysisResponse,
  ResearchNetworkId,
  MethodId,
  PreprocessingMode,
  AnomalyInspector,
  ContaminationExperimentResponse,
  ContaminationScoreSource,
  MultiFeatureExperimentResponse,
  MultiFeatureScalingMode,
  IterativeExtractionResponse,
  IterativeMethodId,
  ScoreCacheStatusResponse,
  ScoreStrategy,
  VisualComparisonResponse,
} from '../types'

const api = axios.create({ baseURL: '/api' })

// ── Datasets ──────────────────────────────────────────────────────
export const fetchDatasets = () =>
  api.get<Dataset[]>('/datasets').then(r => r.data)

export const useDatasets = () =>
  useQuery({ queryKey: ['datasets'], queryFn: fetchDatasets })

export const fetchDatasetPreview = (id: string, isCustom = false) => {
  const url = isCustom ? `/datasets/custom/${id}/preview` : `/datasets/${id}/preview`
  return api.get<GraphData>(url).then(r => r.data)
}

export const fetchDatasetStats = (id: string, isCustom = false) => {
  const url = isCustom ? `/datasets/custom/${id}/stats` : `/datasets/${id}/stats`
  return api.get<GraphStats>(url).then(r => r.data)
}

export const uploadDataset = (file: File) => {
  const form = new FormData()
  form.append('file', file)
  return api.post('/datasets/upload', form).then(r => r.data)
}

// ── Scores ────────────────────────────────────────────────────────
export const triggerCompute = (
  sessionId: string,
  datasetId: string,
  methodIds: string[],
  isCustom = false,
  scoreStrategy: ScoreStrategy = 'auto'
) =>
  api.post('/scores/compute', {
    session_id: sessionId,
    dataset_id: datasetId,
    method_ids: methodIds,
    is_custom: isCustom,
    score_strategy: scoreStrategy,
  }).then(r => r.data)

export const fetchScoreStatus = (
  datasetId: string,
  methodIds: string[],
  isCustom = false,
) =>
  api.post<ScoreCacheStatusResponse>('/scores/status', {
    dataset_id: datasetId,
    method_ids: methodIds,
    is_custom: isCustom,
  }).then(r => r.data)

export const checkScoresExist = (sessionId: string, methodId: string) =>
  api.get<{ exists: boolean }>(`/scores/${sessionId}/${methodId}/exists`).then(r => r.data)

// ── Anomalies ─────────────────────────────────────────────────────
export const runAnomalyLabeling = (
  sessionId: string,
  methodId: string,
  preprocessingMode?: PreprocessingMode,
  contamination?: number
) =>
  api.post<{ status: string; summary: AnomalySummary }>(
    '/anomalies/label',
    {
      session_id: sessionId,
      method_id: methodId,
      preprocessing_mode: preprocessingMode,
      contamination,
    }
  ).then(r => r.data)

export const runManualLabeling = (
  sessionId: string, methodId: string, percentile: number
) =>
  api.post<{ status: string; summary: AnomalySummary }>(
    '/anomalies/relabel',
    { session_id: sessionId, method_id: methodId, percentile }
  ).then(r => r.data)

export const fetchDistribution = (sessionId: string, methodId: string) =>
  api.get<DistributionBin[]>(
    `/anomalies/${sessionId}/${methodId}/distribution`
  ).then(r => r.data)

export const fetchAnomalyInspector = (sessionId: string, methodId: string) =>
  api.get<AnomalyInspector>(
    `/anomalies/${sessionId}/${methodId}/inspector`
  ).then(r => r.data)

// ── Backbone ──────────────────────────────────────────────────────
export const extractBackbones = (sessionId: string, methodIds: string[]) =>
  api.post<Record<string, BackboneSummary>>(
    '/backbone/extract', { session_id: sessionId, method_ids: methodIds }
  ).then(r => r.data)

export const fetchBackbone = (sessionId: string, methodId: string) =>
  api.get<GraphData>(`/backbone/${sessionId}/${methodId}`).then(r => r.data)

export const fetchVisualComparison = (sessionId: string, methodId: string) =>
  api.get<VisualComparisonResponse>(`/backbone/${sessionId}/${methodId}/visual-comparison`).then(r => r.data)
// ── Evaluation ────────────────────────────────────────────────────
export const fetchMetricsList = () =>
  api.get<MetricMeta[]>('/evaluation/metrics').then(r => r.data)

export const useMetricsList = () =>
  useQuery({ queryKey: ['metrics'], queryFn: fetchMetricsList })

export const runEvaluation = (
  sessionId: string, datasetId: string,
  methodIds: string[], metricIds: string[], isCustom = false
) =>
  api.post<EvaluationReport>('/evaluation/run', {
    session_id: sessionId, dataset_id: datasetId,
    method_ids: methodIds, metric_ids: metricIds, is_custom: isCustom
  }).then(r => r.data)

export const downloadEvaluationCsv = (sessionId: string) => {
  window.open(`/api/evaluation/${sessionId}/export/csv`, '_blank')
}

// ── Distributions ─────────────────────────────────────────────────
export const fetchDistributions = (
  sessionId: string,
  datasetId: string,
  methodIds: string[],
  isCustom = false,
) =>
  api
    .get(`/evaluation/${sessionId}/distributions`, {
      params: {
        dataset_id: datasetId,
        method_ids: methodIds.join(','),
        is_custom: isCustom,
      },
    })
    .then((r) => r.data)


export const runContaminationExperiment = (params: {
  datasetId: string
  methodId: string
  contaminationValues: string[]
  preprocessingMode?: PreprocessingMode
  scoreSource?: ContaminationScoreSource
  sessionId?: string | null
  isCustom?: boolean
}) =>
  api.post<ContaminationExperimentResponse>('/research/contamination', {
    dataset_id: params.datasetId,
    method_id: params.methodId,
    contamination_values: params.contaminationValues,
    preprocessing_mode: params.preprocessingMode ?? 'none',
    score_source: params.scoreSource ?? 'auto',
    session_id: params.sessionId ?? null,
    is_custom: params.isCustom ?? false,
  }).then(r => r.data)


export const runMultiFeatureExperiment = (params: {
  datasetId: string
  contamination?: number
  scoreSource?: ContaminationScoreSource
  sessionId?: string | null
  isCustom?: boolean
  scalingMode?: MultiFeatureScalingMode
}) =>
  api.post<MultiFeatureExperimentResponse>('/research/multi-feature', {
    dataset_id: params.datasetId,
    contamination: params.contamination ?? null,
    score_source: params.scoreSource ?? 'auto',
    session_id: params.sessionId ?? null,
    is_custom: params.isCustom ?? false,
    scaling_mode: params.scalingMode ?? 'none',
  }).then(r => r.data)

// ── Research analysis ─────────────────────────────────────────────
export const runResearchAnalysis = (
  networkId: ResearchNetworkId,
  methodId: MethodId,
  contamination?: number
) =>
  api.post<ResearchAnalysisResponse>('/research/run', {
    network_id: networkId,
    method_id: methodId,
    contamination: contamination ?? null,
  }).then(r => r.data)

export const runIterativeExtractionExperiment = (params: {
  datasetId: string
  methodIds: IterativeMethodId[]
  targetPercent: number
  stagePercents: number[]
  lowRegionPercent?: number
  highRegionPercent?: number
  scoreSource?: ContaminationScoreSource
  sessionId?: string | null
  isCustom?: boolean
}) =>
  api.post<IterativeExtractionResponse>('/research/iterative-extraction', {
    dataset_id: params.datasetId,
    method_ids: params.methodIds,
    target_percent: params.targetPercent,
    stage_percents: params.stagePercents,
    low_region_percent: params.lowRegionPercent ?? 10,
    high_region_percent: params.highRegionPercent ?? 10,
    score_source: params.scoreSource ?? 'auto',
    session_id: params.sessionId ?? null,
    is_custom: params.isCustom ?? false,
  }).then(r => r.data)
