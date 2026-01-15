'use client';

import { useState } from 'react';
import { useResumeStore } from '@/store/resumeStore';
import { fetchGitHubRepos } from '@/actions/github';
import { generateTailoredResume, calculateATSScore, resumeToLatex } from '@/actions/ai';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
    Sparkles,
    Github,
    Loader2,
    ArrowRight,
    FileText,
    CheckCircle2,
    Zap
} from 'lucide-react';

interface GenerateScreenProps {
    onComplete: () => void;
}

export function GenerateScreen({ onComplete }: GenerateScreenProps) {
    const {
        resumeData,
        jobDescription,
        githubUsername,
        setJobDescription,
        setGithubUsername,
        setResumeData,
        setAtsScore,
        setLatexCode,
    } = useResumeStore();

    const [githubRepos, setGithubRepos] = useState<any[]>([]);
    const [fetchingRepos, setFetchingRepos] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [step, setStep] = useState<'input' | 'generating' | 'done'>('input');

    const handleFetchGitHub = async () => {
        if (!githubUsername) return;
        setFetchingRepos(true);
        setError(null);
        try {
            const repos = await fetchGitHubRepos({ username: githubUsername });
            setGithubRepos(repos.slice(0, 10));
        } catch (err) {
            setError('Failed to fetch GitHub repos');
        } finally {
            setFetchingRepos(false);
        }
    };

    const handleGenerate = async () => {
        if (!jobDescription.trim()) {
            setError('Please enter a job description');
            return;
        }

        setError(null);
        setIsGenerating(true);
        setStep('generating');

        try {
            const githubData = githubRepos.map(r => ({
                name: r.name,
                description: r.description || '',
                language: r.language || '',
                url: r.html_url
            }));

            const tailoredResume = await generateTailoredResume(
                jobDescription,
                resumeData,
                githubData.length > 0 ? githubData : undefined
            );

            setResumeData(tailoredResume);

            const [score, latex] = await Promise.all([
                calculateATSScore(tailoredResume, jobDescription),
                resumeToLatex(tailoredResume)
            ]);

            setAtsScore(score);
            setLatexCode(latex);
            setStep('done');

            setTimeout(() => {
                onComplete();
            }, 1500);

        } catch (err) {
            console.error(err);
            setError('Failed to generate resume. Please try again.');
            setStep('input');
        } finally {
            setIsGenerating(false);
        }
    };

    const hasExistingData = resumeData.personalInfo.fullName || resumeData.experience.length > 0;

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <div className="w-full max-w-2xl">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl gradient-btn mb-4 shadow-lg shadow-primary/20">
                        <FileText className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-4xl font-bold mb-2">
                        <span className="text-foreground">Free </span>
                        <span className="gradient-text">AI Resume</span>
                        <span className="text-foreground"> Generation</span>
                    </h1>
                    <p className="text-muted-foreground text-lg">
                        Instantly, tailored to your dream job.
                    </p>
                </div>

                {/* Main Card */}
                <div className="gradient-border bg-card rounded-2xl shadow-2xl overflow-hidden">
                    {step === 'generating' ? (
                        <div className="p-12 text-center">
                            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full gradient-btn mb-6 animate-pulse">
                                <Loader2 className="w-10 h-10 text-white animate-spin" />
                            </div>
                            <h2 className="text-xl font-semibold mb-2">Generating Your Resume</h2>
                            <p className="text-muted-foreground text-sm">
                                Analyzing job requirements and tailoring your experience...
                            </p>
                            <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                                <Sparkles className="w-3 h-3 text-primary" />
                                <span>This usually takes 10-20 seconds</span>
                            </div>
                        </div>
                    ) : step === 'done' ? (
                        <div className="p-12 text-center">
                            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-500/20 mb-6">
                                <CheckCircle2 className="w-10 h-10 text-green-400" />
                            </div>
                            <h2 className="text-xl font-semibold mb-2">Resume Generated!</h2>
                            <p className="text-muted-foreground text-sm">
                                Taking you to the editor...
                            </p>
                        </div>
                    ) : (
                        <div className="p-6 space-y-6">
                            {/* Job Description */}
                            <div className="space-y-3">
                                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                                    <Zap className="w-4 h-4 text-primary" />
                                    Job Description
                                    <span className="text-pink-500">*</span>
                                </label>
                                <Textarea
                                    value={jobDescription}
                                    onChange={(e) => setJobDescription(e.target.value)}
                                    placeholder="Paste the job posting here. Include requirements, responsibilities, and qualifications for best results..."
                                    className="min-h-[180px] resize-none text-sm bg-secondary/30 border-border/50 focus:border-primary/50"
                                />
                                <p className="text-xs text-muted-foreground">
                                    The more details you provide, the better we can tailor your resume.
                                </p>
                            </div>

                            {/* GitHub Import */}
                            <div className="space-y-3">
                                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                                    <Github className="w-4 h-4" />
                                    GitHub Username
                                    <span className="text-muted-foreground text-xs font-normal">(optional)</span>
                                </label>
                                <div className="flex gap-2">
                                    <Input
                                        value={githubUsername}
                                        onChange={(e) => setGithubUsername(e.target.value)}
                                        placeholder="your-username"
                                        className="text-sm bg-secondary/30 border-border/50 focus:border-primary/50"
                                    />
                                    <Button
                                        onClick={handleFetchGitHub}
                                        disabled={fetchingRepos || !githubUsername}
                                        variant="secondary"
                                        size="default"
                                    >
                                        {fetchingRepos ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            'Fetch'
                                        )}
                                    </Button>
                                </div>
                                {githubRepos.length > 0 && (
                                    <p className="text-xs text-green-400 flex items-center gap-1">
                                        <CheckCircle2 className="w-3 h-3" />
                                        {githubRepos.length} repositories loaded
                                    </p>
                                )}
                            </div>

                            {/* Existing Data Notice */}
                            {hasExistingData && (
                                <div className="bg-primary/10 border border-primary/20 rounded-xl p-3 text-sm">
                                    <p className="text-foreground">
                                        <strong className="text-primary">Note:</strong> We'll use your existing resume data as a base and enhance it for this job.
                                    </p>
                                </div>
                            )}

                            {/* Error */}
                            {error && (
                                <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3 text-sm text-destructive">
                                    {error}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Footer */}
                    {step === 'input' && (
                        <div className="px-6 py-4 bg-secondary/20 border-t border-border/50 flex items-center justify-between">
                            <Button
                                variant="ghost"
                                onClick={onComplete}
                                className="text-muted-foreground hover:text-foreground"
                            >
                                Skip to Editor
                                <ArrowRight className="w-4 h-4 ml-2" />
                            </Button>

                            <Button
                                onClick={handleGenerate}
                                disabled={!jobDescription.trim() || isGenerating}
                                size="lg"
                                className="gap-2 px-8"
                            >
                                <Sparkles className="w-4 h-4" />
                                Get Tailored Resume
                            </Button>
                        </div>
                    )}
                </div>

                {/* Footer Info */}
                <p className="text-center text-xs text-muted-foreground mt-6">
                    Quick and simple. No catch.
                </p>
            </div>
        </div>
    );
}
