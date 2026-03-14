import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type GenerationMonitorStatus =
  | 'idle'
  | 'awaiting_clarification'
  | 'generating'
  | 'completed'
  | 'failed';

type GenerationMonitorState = {
  sessionId: string | null;
  status: GenerationMonitorStatus;
  sourcePath: string | null;
  stageLabel: string;
  progressPercent: number;
  elapsedMs: number;
  step: string | null;
  detailLines: string[];
  atsScore: number | null;
  resumeId: string | null;
  errorMessage: string | null;
  trackSession: (params: {
    sessionId: string;
    status: Exclude<GenerationMonitorStatus, 'idle' | 'completed' | 'failed'>;
    sourcePath?: string | null;
  }) => void;
  updateProgress: (params: {
    step?: string | null;
    stageLabel?: string;
    progressPercent?: number;
    elapsedMs?: number;
    detailLines?: string[];
    atsScore?: number | null;
  }) => void;
  markCompleted: (params: { resumeId?: string | null; atsScore?: number | null }) => void;
  markFailed: (message: string) => void;
  clear: () => void;
};

const initialState = {
  sessionId: null,
  status: 'idle' as const,
  sourcePath: null,
  stageLabel: 'Preparing your session',
  progressPercent: 5,
  elapsedMs: 0,
  step: null,
  detailLines: [] as string[],
  atsScore: null,
  resumeId: null,
  errorMessage: null,
};

export const useGenerationMonitorStore = create<GenerationMonitorState>()(
  persist(
    (set) => ({
      ...initialState,
      trackSession: ({ sessionId, status, sourcePath }) => set((state) => ({
        sessionId,
        status,
        sourcePath: sourcePath ?? state.sourcePath,
        stageLabel: status === 'awaiting_clarification' ? 'Waiting for your clarification' : 'Preparing your session',
        progressPercent: status === 'awaiting_clarification' ? Math.max(state.progressPercent, 30) : Math.max(state.progressPercent, 5),
        errorMessage: null,
        ...(status === 'awaiting_clarification'
          ? { detailLines: ['Answer the clarification prompt to continue the generation.'] }
          : {}),
      })),
      updateProgress: (params) => set((state) => ({
        ...state,
        status: 'generating',
        step: params.step ?? state.step,
        stageLabel: params.stageLabel ?? state.stageLabel,
        progressPercent: typeof params.progressPercent === 'number' ? params.progressPercent : state.progressPercent,
        elapsedMs: typeof params.elapsedMs === 'number' ? params.elapsedMs : state.elapsedMs,
        detailLines: params.detailLines ?? state.detailLines,
        atsScore: typeof params.atsScore === 'number' ? params.atsScore : state.atsScore,
        errorMessage: null,
      })),
      markCompleted: ({ resumeId, atsScore }) => set((state) => ({
        ...state,
        status: 'completed',
        stageLabel: 'Resume ready',
        progressPercent: 100,
        detailLines: typeof atsScore === 'number'
          ? [`ATS estimate: ${atsScore}%`]
          : [],
        resumeId: resumeId ?? state.resumeId,
        atsScore: typeof atsScore === 'number' ? atsScore : state.atsScore,
        errorMessage: null,
      })),
      markFailed: (message) => set((state) => ({
        ...state,
        status: 'failed',
        stageLabel: 'Generation failed',
        errorMessage: message,
        detailLines: [],
      })),
      clear: () => set(initialState),
    }),
    {
      name: 'generation-monitor-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sessionId: state.sessionId,
        status: state.status,
        sourcePath: state.sourcePath,
        stageLabel: state.stageLabel,
        progressPercent: state.progressPercent,
        elapsedMs: state.elapsedMs,
        step: state.step,
        detailLines: state.detailLines,
        atsScore: state.atsScore,
        resumeId: state.resumeId,
        errorMessage: state.errorMessage,
      }),
    }
  )
);
