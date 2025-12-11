'use client';

import { useResumeStore } from '@/store/resumeStore';
import { Badge } from '@/components/ui/badge';
import { Target, TrendingUp, AlertCircle, CheckCircle2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ATSScoreCard() {
    const { atsScore, jobDescription } = useResumeStore();

    if (!jobDescription) {
        return (
            <div className="gradient-border rounded-xl p-6 text-center">
                <Target className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">
                    Enter a job description to see your ATS match score
                </p>
            </div>
        );
    }

    if (!atsScore) {
        return (
            <div className="gradient-border rounded-xl p-6 text-center animate-pulse">
                <Sparkles className="w-10 h-10 mx-auto text-primary/50 mb-3 animate-spin" />
                <p className="text-sm text-muted-foreground">
                    Analyzing your resume...
                </p>
            </div>
        );
    }

    const getScoreColor = (score: number) => {
        if (score >= 80) return 'text-green-400';
        if (score >= 60) return 'text-yellow-400';
        return 'text-red-400';
    };

    const getScoreLabel = (score: number) => {
        if (score >= 80) return 'Excellent Match';
        if (score >= 60) return 'Good Match';
        if (score >= 40) return 'Fair Match';
        return 'Needs Work';
    };

    const getProgressColor = (score: number) => {
        if (score >= 80) return 'bg-gradient-to-r from-green-500 to-emerald-400';
        if (score >= 60) return 'bg-gradient-to-r from-yellow-500 to-orange-400';
        return 'bg-gradient-to-r from-red-500 to-pink-400';
    };

    return (
        <div className="space-y-6">
            {/* Main Score */}
            <div className="text-center">
                <div className={cn("text-5xl font-bold mb-1", getScoreColor(atsScore.overall))}>
                    {atsScore.overall}%
                </div>
                <p className={cn("text-sm font-medium", getScoreColor(atsScore.overall))}>
                    {getScoreLabel(atsScore.overall)}
                </p>
            </div>

            {/* Breakdown */}
            <div className="space-y-4">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Score Breakdown</h4>
                
                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Keyword Match</span>
                            <span className="font-medium">{atsScore.breakdown.keywordMatch}%</span>
                        </div>
                        <div className="h-2 bg-secondary rounded-full overflow-hidden">
                            <div 
                                className={cn("h-full transition-all duration-500 rounded-full", getProgressColor(atsScore.breakdown.keywordMatch))}
                                style={{ width: `${atsScore.breakdown.keywordMatch}%` }}
                            />
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Skills Match</span>
                            <span className="font-medium">{atsScore.breakdown.skillsMatch}%</span>
                        </div>
                        <div className="h-2 bg-secondary rounded-full overflow-hidden">
                            <div 
                                className={cn("h-full transition-all duration-500 rounded-full", getProgressColor(atsScore.breakdown.skillsMatch))}
                                style={{ width: `${atsScore.breakdown.skillsMatch}%` }}
                            />
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Experience Relevance</span>
                            <span className="font-medium">{atsScore.breakdown.experienceRelevance}%</span>
                        </div>
                        <div className="h-2 bg-secondary rounded-full overflow-hidden">
                            <div 
                                className={cn("h-full transition-all duration-500 rounded-full", getProgressColor(atsScore.breakdown.experienceRelevance))}
                                style={{ width: `${atsScore.breakdown.experienceRelevance}%` }}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Matched Keywords */}
            {atsScore.matchedKeywords.length > 0 && (
                <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                        <CheckCircle2 className="w-3 h-3 text-green-400" />
                        Matched Keywords
                    </h4>
                    <div className="flex flex-wrap gap-2">
                        {atsScore.matchedKeywords.slice(0, 8).map((keyword) => (
                            <Badge key={keyword} variant="secondary" className="text-xs bg-green-500/10 text-green-400 border-green-500/20">
                                {keyword}
                            </Badge>
                        ))}
                        {atsScore.matchedKeywords.length > 8 && (
                            <Badge variant="outline" className="text-xs">
                                +{atsScore.matchedKeywords.length - 8} more
                            </Badge>
                        )}
                    </div>
                </div>
            )}

            {/* Missing Keywords */}
            {atsScore.missingKeywords.length > 0 && (
                <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                        <AlertCircle className="w-3 h-3 text-orange-400" />
                        Missing Keywords
                    </h4>
                    <div className="flex flex-wrap gap-2">
                        {atsScore.missingKeywords.slice(0, 8).map((keyword) => (
                            <Badge key={keyword} variant="outline" className="text-xs text-orange-400 border-orange-500/30">
                                {keyword}
                            </Badge>
                        ))}
                        {atsScore.missingKeywords.length > 8 && (
                            <Badge variant="outline" className="text-xs">
                                +{atsScore.missingKeywords.length - 8} more
                            </Badge>
                        )}
                    </div>
                </div>
            )}

            {/* Suggestions */}
            {atsScore.suggestions.length > 0 && (
                <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                        <TrendingUp className="w-3 h-3 text-primary" />
                        Suggestions to Improve
                    </h4>
                    <ul className="space-y-2">
                        {atsScore.suggestions.slice(0, 3).map((suggestion, idx) => (
                            <li key={idx} className="text-xs text-muted-foreground flex gap-2 items-start">
                                <span className="text-primary mt-0.5">•</span>
                                <span>{suggestion}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
