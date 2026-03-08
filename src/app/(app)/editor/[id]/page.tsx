import { EditorLayout } from '@/components/editor/EditorLayout';

export default async function ResumeEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditorLayout resumeId={id} />;
}
