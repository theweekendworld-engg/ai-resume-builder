import { create } from 'zustand';

interface PreviewStore {
  isCompiling: boolean;
  compileError: string | null;
  setIsCompiling: (isCompiling: boolean) => void;
  setCompileError: (compileError: string | null) => void;
}

export const usePreviewStore = create<PreviewStore>((set) => ({
  isCompiling: false,
  compileError: null,
  setIsCompiling: (isCompiling) => set({ isCompiling }),
  setCompileError: (compileError) => set({ compileError }),
}));
