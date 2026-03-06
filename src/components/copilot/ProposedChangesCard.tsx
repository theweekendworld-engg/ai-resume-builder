'use client';

import { useState } from 'react';
import { useResumeStore, CopilotProposal, CopilotSectionKey } from '@/store/resumeStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
    Check, 
    X, 
    Sparkles,
    User,
    Briefcase,
    FolderKanban,
    Code,
    ChevronRight,
    Target,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ProposedChangesCardProps {
    proposal: CopilotProposal;
    onApplyAll: () => void;
    onReject: () => void;
}

const sectionConfig: { key: CopilotSectionKey; label: string; icon: React.ReactNode }[] = [
    { key: 'summary', label: 'Summary', icon: <User className="w-4 h-4" /> },
    { key: 'experience', label: 'Experience', icon: <Briefcase className="w-4 h-4" /> },
    { key: 'projects', label: 'Projects', icon: <FolderKanban className="w-4 h-4" /> },
    { key: 'skills', label: 'Skills', icon: <Code className="w-4 h-4" /> },
];

export function ProposedChangesCard({ proposal, onApplyAll, onReject }: ProposedChangesCardProps) {
    const { applyCopilotSection } = useResumeStore();
    const [appliedSections, setAppliedSections] = useState<Set<CopilotSectionKey>>(new Set());

    const handleApplySection = (section: CopilotSectionKey) => {
        applyCopilotSection(section);
        setAppliedSections(prev => new Set(prev).add(section));
        toast.success(`${section.charAt(0).toUpperCase() + section.slice(1)} updated!`);
    };

    const getScoreColor = (score: number) => {
        if (score >= 80) return 'text-green-400';
        if (score >= 60) return 'text-yellow-400';
        return 'text-red-400';
    };

    const changedSections = sectionConfig.filter(
        s => proposal.diffs[s.key]?.changed
    );

    return (
        <Card className="border-primary/20 bg-card/50">
            <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                    <span className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-primary" />
                        Proposed Changes
                    </span>
                    <div className="flex items-center gap-2">
                        <Target className="w-4 h-4 text-muted-foreground" />
                        <span className={cn("font-bold", getScoreColor(proposal.proposedAtsScore))}>
                            {proposal.proposedAtsScore}%
                        </span>
                    </div>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Rationale */}
                {proposal.rationale.length > 0 && (
                    <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Key Changes
                        </p>
                        <ul className="space-y-1">
                            {proposal.rationale.slice(0, 3).map((item, i) => (
                                <li key={i} className="text-xs text-foreground flex items-start gap-2">
                                    <ChevronRight className="w-3 h-3 mt-0.5 text-primary flex-shrink-0" />
                                    <span>{item}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Section Tabs */}
                <Tabs defaultValue={changedSections[0]?.key || 'summary'} className="w-full">
                    <TabsList className="w-full grid grid-cols-4 h-auto">
                        {sectionConfig.map(({ key, label, icon }) => {
                            const isChanged = proposal.diffs[key]?.changed;
                            const isApplied = appliedSections.has(key);
                            
                            return (
                                <TabsTrigger
                                    key={key}
                                    value={key}
                                    className={cn(
                                        "flex flex-col items-center gap-1 py-2 px-1 text-[10px]",
                                        !isChanged && "opacity-50"
                                    )}
                                    disabled={!isChanged}
                                >
                                    <div className="relative">
                                        {icon}
                                        {isApplied && (
                                            <Check className="w-2.5 h-2.5 absolute -top-1 -right-1 text-green-400" />
                                        )}
                                    </div>
                                    <span>{label}</span>
                                    {isChanged && !isApplied && (
                                        <Badge variant="secondary" className="text-[8px] px-1 py-0 h-3">
                                            Updated
                                        </Badge>
                                    )}
                                </TabsTrigger>
                            );
                        })}
                    </TabsList>

                    {sectionConfig.map(({ key }) => {
                        const diff = proposal.diffs[key];
                        const isApplied = appliedSections.has(key);

                        if (!diff?.changed) return null;

                        return (
                            <TabsContent key={key} value={key} className="mt-4 space-y-3">
                                {/* Before */}
                                <div className="space-y-1">
                                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                                        Before
                                    </p>
                                    <ScrollArea className="h-24 rounded-md border border-border/50 bg-secondary/30 p-2">
                                        <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                                            {diff.before || '(empty)'}
                                        </p>
                                    </ScrollArea>
                                </div>

                                {/* After */}
                                <div className="space-y-1">
                                    <p className="text-[10px] font-medium text-primary uppercase tracking-wider">
                                        After (Proposed)
                                    </p>
                                    <ScrollArea className="h-24 rounded-md border border-primary/30 bg-primary/5 p-2">
                                        <p className="text-xs text-foreground whitespace-pre-wrap">
                                            {diff.after || '(empty)'}
                                        </p>
                                    </ScrollArea>
                                </div>

                                {/* Apply Section Button */}
                                <Button
                                    size="sm"
                                    variant={isApplied ? "secondary" : "default"}
                                    className="w-full"
                                    onClick={() => handleApplySection(key)}
                                    disabled={isApplied}
                                >
                                    {isApplied ? (
                                        <>
                                            <Check className="w-3 h-3 mr-2" />
                                            Applied
                                        </>
                                    ) : (
                                        <>
                                            <Check className="w-3 h-3 mr-2" />
                                            Apply {key.charAt(0).toUpperCase() + key.slice(1)}
                                        </>
                                    )}
                                </Button>
                            </TabsContent>
                        );
                    })}
                </Tabs>

                {/* Action Buttons */}
                <div className="flex gap-2 pt-2 border-t border-border">
                    <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={onReject}
                    >
                        <X className="w-3 h-3 mr-2" />
                        Reject All
                    </Button>
                    <Button
                        size="sm"
                        className="flex-1"
                        onClick={onApplyAll}
                    >
                        <Check className="w-3 h-3 mr-2" />
                        Apply All
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
