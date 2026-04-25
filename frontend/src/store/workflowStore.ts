/**
 * store/workflowStore.ts
 * The single source of truth for the wizard's state.
 * Persisted to localStorage so the user can refresh the page
 * and continue where they left off.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  SessionState,
  WizardStep,
  MethodId,
  GraphStats,
  AppView,
  LabTab,
  PreprocessingMode,
} from '../types'

function makeSessionId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return 'sess_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
  }
}

interface WorkflowActions {
  setDataset: (id: string, isCustom: boolean, stats: GraphStats) => void
  setSelectedMethods: (methods: MethodId[]) => void
  setScoresReady: (v: boolean) => void
  setAnomalyReady: (method: string, v: boolean) => void
  setBackboneReady: (method: string, v: boolean) => void
  setEvaluationReady: (v: boolean) => void
  goToStep: (step: WizardStep) => void
  setView: (view: AppView) => void
  setLabTab: (tab: LabTab) => void
  openExperimentLab: (tab?: LabTab) => void
  resetSession: () => void
  setPreprocessingMode: (method: MethodId, mode: PreprocessingMode) => void
  setContaminationMode: (method: MethodId, value: number) => void
}

const initialState: SessionState = {
  sessionId: makeSessionId(),
  datasetId: null,
  isCustomDataset: false,
  datasetStats: null,
  selectedMethods: [],
  scoresReady: false,
  anomaliesReady: {},
  backbonesReady: {},
  evaluationReady: false,
  currentStep: 1,
  currentView: 'wizard',
  labTab: 'contamination',
  preprocessingByMethod: {},
  contaminationByMethod: {},
}

export const useWorkflowStore = create<SessionState & WorkflowActions>()(
  persist(
    (set) => ({
      ...initialState,

      setView: (view) =>
        set({ currentView: view }),

      setPreprocessingMode: (method, mode) =>
        set((s) => ({
          preprocessingByMethod: {
            ...s.preprocessingByMethod,
            [method]: mode,
          },
        })),

      setContaminationMode: (method, value) =>
        set((s) => ({
          contaminationByMethod: {
            ...s.contaminationByMethod,
            [method]: value,
          },
        })),

      setLabTab: (tab) =>
        set({ labTab: tab }),

      openExperimentLab: (tab = 'contamination') =>
        set({ currentView: 'lab', labTab: tab }),

      setDataset: (id, isCustom, stats) =>
        set((s) => {
          const changed = s.datasetId !== id || s.isCustomDataset !== isCustom
          if (!changed) {
            return { datasetId: id, isCustomDataset: isCustom, datasetStats: stats }
          }
          return {
            datasetId: id,
            isCustomDataset: isCustom,
            datasetStats: stats,
            scoresReady: false,
            anomaliesReady: {},
            backbonesReady: {},
            evaluationReady: false,
          }
        }),

      setSelectedMethods: (methods) =>
        set({ selectedMethods: methods }),

      setScoresReady: (v) =>
        set({ scoresReady: v }),

      setAnomalyReady: (method, v) =>
        set((s) => ({ anomaliesReady: { ...s.anomaliesReady, [method]: v } })),

      setBackboneReady: (method, v) =>
        set((s) => ({ backbonesReady: { ...s.backbonesReady, [method]: v } })),

      setEvaluationReady: (v) =>
        set({ evaluationReady: v }),

      goToStep: (step) =>
        set({ currentStep: step }),

      resetSession: () =>
        set({ ...initialState, sessionId: makeSessionId() }),
    }),
    { name: 'backbone-explorer-session' }
  )
)