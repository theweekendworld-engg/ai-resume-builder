import { Card, CardContent } from '@/components/ui/card';

export function StepImport() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Import context</h2>
      <p className="text-sm text-muted-foreground">
        This step is optional. Continue to generate your resume, then import sources from the editor tools.
      </p>
      <Card>
        <CardContent className="space-y-2 p-4 text-sm text-muted-foreground">
          <p>Available after generation: GitHub import, LinkedIn context, and file-based content import.</p>
          <p>After opening the editor, use the left sidebar tools to connect and import.</p>
        </CardContent>
      </Card>
    </div>
  );
}
