import { create } from 'zustand'
import type { ContaminationExperimentResponse } from '../types'

interface ContaminationLabState {
  history: Record<string, ContaminationExperimentResponse[]>
  selectedHistoryKey: string | null
  addExperiment: (key: string, experiment: ContaminationExperimentResponse) => void
  selectHistoryKey: (key: string | null) => void
  clearHistory: (key?: string) => void
}

export const makeContaminationHistoryKey = (params: {
  datasetId: string
  methodId: string
  preprocessingMode: string
  scoreSource: string
}) =>
  [
    params.datasetId,
    params.methodId,
    params.preprocessingMode,
    params.scoreSource,
  ].join('::')

export const useContaminationLabStore = create<ContaminationLabState>((set) => ({
  history: {},
  selectedHistoryKey: null,

  addExperiment: (key, experiment) =>
    set((state) => ({
      history: {
        ...state.history,
        [key]: [...(state.history[key] ?? []), experiment],
      },
      selectedHistoryKey: key,
    })),

  selectHistoryKey: (key) => set({ selectedHistoryKey: key }),

  clearHistory: (key) =>
    set((state) => {
      if (!key) {
        return { history: {}, selectedHistoryKey: null }
      }

      const next = { ...state.history }
      delete next[key]
      return {
        history: next,
        selectedHistoryKey:
          state.selectedHistoryKey === key ? null : state.selectedHistoryKey,
      }
    }),
}))
