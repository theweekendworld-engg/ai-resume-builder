import { JobTargetEditor } from '@/components/editor/JobTargetEditor';

interface JobTargetPanelProps {
  resumeId: string;
}

export function JobTargetPanel({ resumeId }: JobTargetPanelProps) {
  return <JobTargetEditor resumeId={resumeId} />;
}
