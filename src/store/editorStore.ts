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
  | 'ats'
  | 'copilot'
  | 'latex'
  | 'github'
  | 'knowledge'
  | 'settings';

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
      partialize: (state) => ({
        activePanel: state.activePanel,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    }
  )
);
