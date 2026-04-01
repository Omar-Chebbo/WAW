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
} from '../types'

// Base URL — in dev, Vite proxies /api to localhost:8000
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
  sessionId: string, datasetId: string, methodIds: string[], isCustom = false
) =>
  api.post('/scores/compute', {
    session_id: sessionId, dataset_id: datasetId,
    method_ids: methodIds, is_custom: isCustom
  }).then(r => r.data)

export const checkScoresExist = (sessionId: string, methodId: string) =>
  api.get<{ exists: boolean }>(`/scores/${sessionId}/${methodId}/exists`).then(r => r.data)

// ── Anomalies ─────────────────────────────────────────────────────
export const runAnomalyLabeling = (
  sessionId: string,
  methodId: string,
  preprocessingMode?: PreprocessingMode
) =>
  api.post<{ status: string; summary: AnomalySummary }>(
    '/anomalies/label',
    {
      session_id: sessionId,
      method_id: methodId,
      preprocessing_mode: preprocessingMode,
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

// ── Backbone ──────────────────────────────────────────────────────
export const extractBackbones = (sessionId: string, methodIds: string[]) =>
  api.post<Record<string, BackboneSummary>>(
    '/backbone/extract', { session_id: sessionId, method_ids: methodIds }
  ).then(r => r.data)

export const fetchBackbone = (sessionId: string, methodId: string) =>
  api.get<GraphData>(`/backbone/${sessionId}/${methodId}`).then(r => r.data)

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

// ── Research analysis ─────────────────────────────────────────────
export const runResearchAnalysis = (
  networkId: ResearchNetworkId,
  methodId: MethodId
) =>
  api.post<ResearchAnalysisResponse>('/research/run', {
    network_id: networkId,
    method_id: methodId,
  }).then(r => r.data)

  