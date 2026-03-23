/**
 * store/workflowStore.ts
 * The single source of truth for the wizard's state.
 * Persisted to localStorage so the user can refresh the page
 * and continue where they left off.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SessionState, WizardStep, MethodId, GraphStats } from '../types'

// Generate a unique session ID using the browser's built-in crypto API
function makeSessionId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    // Fallback for older browsers
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
  resetSession: () => void
}

const initialState: SessionState = {
  sessionId:       makeSessionId(),
  datasetId:       null,
  isCustomDataset: false,
  datasetStats:    null,
  selectedMethods: [],
  scoresReady:     false,
  anomaliesReady:  {},
  backbonesReady:  {},
  evaluationReady: false,
  currentStep:     1,
}

export const useWorkflowStore = create<SessionState & WorkflowActions>()(
  persist(
    (set) => ({
      ...initialState,

      setDataset: (id, isCustom, stats) =>
        set({ datasetId: id, isCustomDataset: isCustom, datasetStats: stats }),

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
