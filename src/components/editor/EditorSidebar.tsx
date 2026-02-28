'use client';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EditorPanelId } from '@/store/editorStore';
import {
  Briefcase,
  Code,
  FileCode2,
  FolderKanban,
  GraduationCap,
  PanelLeft,
  Sparkles,
  Target,
  User,
  Wrench,
  Brain,
  Github,
  Book,
  Settings,
  ListOrdered,
} from 'lucide-react';

interface EditorSidebarProps {
  activePanel: EditorPanelId;
  onSelect: (panel: EditorPanelId) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const sectionItems: { id: EditorPanelId; label: string; icon: React.ReactNode }[] = [
  { id: 'job-target', label: 'Job Target', icon: <Target className="h-4 w-4" /> },
  { id: 'personal', label: 'Personal', icon: <User className="h-4 w-4" /> },
  { id: 'experience', label: 'Experience', icon: <Briefcase className="h-4 w-4" /> },
  { id: 'projects', label: 'Projects', icon: <FolderKanban className="h-4 w-4" /> },
  { id: 'education', label: 'Education', icon: <GraduationCap className="h-4 w-4" /> },
  { id: 'skills', label: 'Skills', icon: <Code className="h-4 w-4" /> },
  { id: 'section-order', label: 'Order', icon: <ListOrdered className="h-4 w-4" /> },
];

const toolItems: { id: EditorPanelId; label: string; icon: React.ReactNode }[] = [
  { id: 'ats', label: 'ATS Score', icon: <Target className="h-4 w-4" /> },
  { id: 'copilot', label: 'Copilot', icon: <Sparkles className="h-4 w-4" /> },
  { id: 'latex', label: 'LaTeX', icon: <FileCode2 className="h-4 w-4" /> },
  { id: 'github', label: 'GitHub Import', icon: <Github className="h-4 w-4" /> },
  { id: 'knowledge', label: 'Knowledge', icon: <Book className="h-4 w-4" /> },
  { id: 'settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
];

function NavSection({
  title,
  items,
  activePanel,
  onSelect,
  collapsed,
}: {
  title: string;
  items: { id: EditorPanelId; label: string; icon: React.ReactNode }[];
  activePanel: EditorPanelId;
  onSelect: (panel: EditorPanelId) => void;
  collapsed: boolean;
}) {
  return (
    <div className="space-y-1">
      {!collapsed && <p className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>}
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item.id)}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors',
            activePanel === item.id ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
          )}
          title={collapsed ? item.label : undefined}
        >
          {item.icon}
          {!collapsed && <span className="truncate">{item.label}</span>}
        </button>
      ))}
    </div>
  );
}

export function EditorSidebar({ activePanel, onSelect, collapsed, onToggleCollapsed }: EditorSidebarProps) {
  return (
    <aside className={cn('hidden border-r border-border bg-card/40 p-2 lg:flex lg:flex-col', collapsed ? 'w-16' : 'w-60')}>
      <div className="mb-2 flex items-center justify-between">
        {!collapsed && <span className="px-2 text-sm font-semibold">Editor</span>}
        <Button variant="ghost" size="icon" onClick={onToggleCollapsed} aria-label="Toggle sidebar">
          {collapsed ? <Wrench className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
        </Button>
      </div>

      <div className="space-y-4 overflow-auto pb-2">
        <NavSection title="Sections" items={sectionItems} activePanel={activePanel} onSelect={onSelect} collapsed={collapsed} />
        <NavSection title="Tools" items={toolItems} activePanel={activePanel} onSelect={onSelect} collapsed={collapsed} />
      </div>

      {!collapsed && (
        <div className="mt-auto rounded-md border border-border bg-secondary/40 p-2 text-xs text-muted-foreground">
          <div className="mb-1 flex items-center gap-1 text-foreground">
            <Brain className="h-3 w-3" />
            Invisible Sync
          </div>
          Visual edits and LaTeX stay aligned automatically.
        </div>
      )}
    </aside>
  );
}
