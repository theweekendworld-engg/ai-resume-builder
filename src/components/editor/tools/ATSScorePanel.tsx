'use client';

import { useMemo, useState } from 'react';
import { calculateATSScore } from '@/actions/ai';
import { useResumeStore } from '@/store/resumeStore';
import { useEditorStore } from '@/store/editorStore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, Loader2, Target } from 'lucide-react';
import { toast } from 'sonner';

type EvidenceTarget = 'experience' | 'projects' | 'summary' | 'skills';

function appendEvidence(description: string, keyword: string, proofText: string): string {
  const trimmed = description.trim();
  const normalizedProof = proofText.trim().replace(/^\s*[-•]\s*/, '');
  const sentence = normalizedProof.endsWith('.') ? normalizedProof : `${normalizedProof}.`;
  const prefixed = sentence.toLowerCase().includes(keyword.toLowerCase()) ? sentence : `${keyword}: ${sentence}`;
  if (!trimmed) return `• ${prefixed}`;
  const needsNewLine = trimmed.endsWith('\n') || trimmed.endsWith('\r\n');
  return `${trimmed}${needsNewLine ? '' : '\n'}• ${prefixed}`;
}

export function ATSScorePanel() {
  const {
    resumeData,
    jobDescription,
    atsScore,
    setAtsScore,
    updateExperience,
    updateProject,
    updateSkills,
    updatePersonalInfo,
  } = useResumeStore();
  const { setActivePanel } = useEditorStore();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedKeyword, setSelectedKeyword] = useState('');
  const [targetSection, setTargetSection] = useState<EvidenceTarget>('experience');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [proofText, setProofText] = useState('');

  const experienceOptions = useMemo(
    () => resumeData.experience.map((item) => ({ id: item.id, label: `${item.role || 'Role'} @ ${item.company || 'Company'}` })),
    [resumeData.experience]
  );
  const projectOptions = useMemo(
    () => resumeData.projects.map((item) => ({ id: item.id, label: item.name || 'Untitled project' })),
    [resumeData.projects]
  );

  const handleRefresh = async () => {
    if (!jobDescription.trim()) {
      setError('Add a job description in Job Target before scoring.');
      return;
    }

    setError(null);
    setIsLoading(true);
    try {
      const score = await calculateATSScore(resumeData, jobDescription);
      setAtsScore(score);
    } catch {
      setError('Unable to calculate ATS score right now.');
    } finally {
      setIsLoading(false);
    }
  };

  const openKeywordModal = (keyword: string) => {
    setSelectedKeyword(keyword);
    const defaultTarget: EvidenceTarget = resumeData.experience.length > 0
      ? 'experience'
      : resumeData.projects.length > 0
        ? 'projects'
        : 'skills';
    setTargetSection(defaultTarget);
    setSelectedItemId(
      defaultTarget === 'experience'
        ? (resumeData.experience[0]?.id ?? '')
        : defaultTarget === 'projects'
          ? (resumeData.projects[0]?.id ?? '')
          : ''
    );
    setProofText('');
    setModalOpen(true);
  };

  const applyKeywordEvidence = () => {
    if (!selectedKeyword) return;
    if (targetSection !== 'skills' && proofText.trim().length < 8) {
      toast.error('Add one concrete sentence describing how you used this skill.');
      return;
    }

    if (targetSection === 'experience') {
      const target = resumeData.experience.find((item) => item.id === selectedItemId);
      if (!target) {
        toast.error('Select an experience entry.');
        return;
      }
      updateExperience(target.id, {
        description: appendEvidence(target.description, selectedKeyword, proofText),
      });
    } else if (targetSection === 'projects') {
      const target = resumeData.projects.find((item) => item.id === selectedItemId);
      if (!target) {
        toast.error('Select a project entry.');
        return;
      }
      updateProject(target.id, {
        description: appendEvidence(target.description, selectedKeyword, proofText),
      });
    } else if (targetSection === 'summary') {
      const summary = resumeData.personalInfo.summary.trim();
      const normalized = proofText.trim().endsWith('.') ? proofText.trim() : `${proofText.trim()}.`;
      const withKeyword = normalized.toLowerCase().includes(selectedKeyword.toLowerCase())
        ? normalized
        : `${selectedKeyword}: ${normalized}`;
      updatePersonalInfo({
        summary: summary ? `${summary} ${withKeyword}` : withKeyword,
      });
    }

    const normalizedSkill = selectedKeyword.trim();
    if (normalizedSkill) {
      const mergedSkills = Array.from(
        new Set(
          [...resumeData.skills, normalizedSkill]
            .map((skill) => skill.trim())
            .filter(Boolean)
        )
      );
      updateSkills(mergedSkills);
    }

    setModalOpen(false);
    toast.success(`Added evidence for "${selectedKeyword}". Recalculate score to see impact.`);
  };

  if (!jobDescription.trim()) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Score & Improve
          </CardTitle>
          <CardDescription>Add a job target first to unlock match scoring and keyword guidance.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed border-border bg-secondary/20 p-4">
            <p className="text-sm text-muted-foreground">
              To unlock AI Copilot and your match score, we need to know which role you&apos;re targeting.
            </p>
            <Button className="mt-3" onClick={() => setActivePanel('job-target')}>
              Add Job Description
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          ATS Match Score
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={handleRefresh} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Recalculate score'}
        </Button>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4" />
            <p>{error}</p>
          </div>
        )}

        {atsScore && (
          <div className="space-y-4 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Overall</p>
              <p className="text-2xl font-semibold">{atsScore.overall}%</p>
            </div>
            <div className="space-y-2 text-sm">
              <p>Keyword match: {atsScore.breakdown.keywordMatch}%</p>
              <p>Skills match: {atsScore.breakdown.skillsMatch}%</p>
              <p>Experience relevance: {atsScore.breakdown.experienceRelevance}%</p>
            </div>
            {atsScore.missingKeywords.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Missing keywords</p>
                <div className="flex flex-wrap gap-2">
                  {atsScore.missingKeywords.slice(0, 12).map((keyword) => (
                    <button
                      key={keyword}
                      type="button"
                      onClick={() => openKeywordModal(keyword)}
                      className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-700 transition-colors hover:bg-red-500/20 dark:text-red-300"
                    >
                      {keyword}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {atsScore.suggestions.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {atsScore.suggestions.slice(0, 5).map((suggestion, idx) => (
                  <li key={idx}>{suggestion}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <Dialog open={modalOpen} onOpenChange={setModalOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Evidence for {selectedKeyword}</DialogTitle>
              <DialogDescription>
                Share one concrete sentence and we will weave it into your resume.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Target section</Label>
                <Select
                  value={targetSection}
                  onValueChange={(value) => {
                    const next = value as EvidenceTarget;
                    setTargetSection(next);
                    if (next === 'experience') setSelectedItemId(experienceOptions[0]?.id ?? '');
                    if (next === 'projects') setSelectedItemId(projectOptions[0]?.id ?? '');
                    if (next === 'summary' || next === 'skills') setSelectedItemId('');
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="experience">Experience</SelectItem>
                    <SelectItem value="projects">Projects</SelectItem>
                    <SelectItem value="summary">Summary</SelectItem>
                    <SelectItem value="skills">Skills only</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {targetSection === 'experience' && (
                <div className="space-y-2">
                  <Label>Experience entry</Label>
                  <Select value={selectedItemId} onValueChange={setSelectedItemId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose an experience entry" />
                    </SelectTrigger>
                    <SelectContent>
                      {experienceOptions.length === 0 && <SelectItem value="none" disabled>No experience entries</SelectItem>}
                      {experienceOptions.map((item) => (
                        <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {targetSection === 'projects' && (
                <div className="space-y-2">
                  <Label>Project entry</Label>
                  <Select value={selectedItemId} onValueChange={setSelectedItemId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a project entry" />
                    </SelectTrigger>
                    <SelectContent>
                      {projectOptions.length === 0 && <SelectItem value="none" disabled>No project entries</SelectItem>}
                      {projectOptions.map((item) => (
                        <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {targetSection !== 'skills' && (
                <div className="space-y-2">
                  <Label>Evidence sentence</Label>
                  <Input
                    value={proofText}
                    onChange={(event) => setProofText(event.target.value)}
                    placeholder={`Example: Used ${selectedKeyword} to improve deployment reliability by 40%.`}
                  />
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button onClick={applyKeywordEvidence}>Apply</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

