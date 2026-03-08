'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ATSScorePanel } from '@/components/editor/tools/ATSScorePanel';
import { ResumeCopilot } from '@/components/copilot';

export function ScoreImprovePanel() {
  return (
    <div className="h-full">
      <Tabs defaultValue="score" className="flex h-full flex-col gap-3">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="score">Match Score</TabsTrigger>
          <TabsTrigger value="improve">Copilot</TabsTrigger>
        </TabsList>
        <TabsContent value="score" className="min-h-0 flex-1">
          <ATSScorePanel />
        </TabsContent>
        <TabsContent value="improve" className="min-h-0 flex-1">
          <ResumeCopilot embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}

