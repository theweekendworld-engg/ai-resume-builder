import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type EditorPanelId =
  | 'job-target'
  | 'personal'
  | 'experience'
  | 'projects'
  | 'education'
  | 'skills'
  | 'section-order'
  | 'score-improve'
  | 'latex'
  | 'settings';

function normalizeActivePanel(panel: unknown): EditorPanelId {
  if (typeof panel !== 'string') return 'job-target';

  if (panel === 'ats' || panel === 'copilot') return 'score-improve';
  if (panel === 'github' || panel === 'knowledge') return 'projects';

  const allowed: EditorPanelId[] = [
    'job-target',
    'personal',
    'experience',
    'projects',
    'education',
    'skills',
    'section-order',
    'score-improve',
    'latex',
    'settings',
  ];
  return allowed.includes(panel as EditorPanelId) ? (panel as EditorPanelId) : 'job-target';
}

interface EditorStore {
  activePanel: EditorPanelId;
  sidebarCollapsed: boolean;
  mobilePreviewOpen: boolean;
  setActivePanel: (panel: EditorPanelId) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setMobilePreviewOpen: (open: boolean) => void;
}

export const useEditorStore = create<EditorStore>()(
  persist(
    (set) => ({
      activePanel: 'job-target',
      sidebarCollapsed: false,
      mobilePreviewOpen: false,
      setActivePanel: (panel) => set({ activePanel: panel }),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      setMobilePreviewOpen: (open) => set({ mobilePreviewOpen: open }),
    }),
    {
      name: 'editor-ui-store',
      version: 2,
      migrate: (persistedState) => {
        if (!persistedState || typeof persistedState !== 'object') {
          return {
            activePanel: 'job-target',
            sidebarCollapsed: false,
          };
        }
        const state = persistedState as { activePanel?: unknown; sidebarCollapsed?: unknown };
        return {
          ...state,
          activePanel: normalizeActivePanel(state.activePanel),
          sidebarCollapsed: typeof state.sidebarCollapsed === 'boolean' ? state.sidebarCollapsed : false,
        };
      },
      partialize: (state) => ({
        activePanel: state.activePanel,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    }
  )
);
