'use client';

import { useState } from 'react';
import { extractKeywords } from '@/actions/ai';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search } from 'lucide-react';
import { useResumeStore } from '@/store/resumeStore';

export function JobTailor() {
    const [jobDescription, setJobDescription] = useState('');
    const [keywords, setKeywords] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const { resumeData } = useResumeStore();

    const handleExtract = async () => {
        if (!jobDescription) return;
        setLoading(true);
        try {
            const extracted = await extractKeywords(jobDescription);
            setKeywords(extracted);
        } catch (error: unknown) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    // Simple check if keyword exists in resume (case-insensitive)
    const checkMatch = (keyword: string) => {
        const resumeText = JSON.stringify(resumeData).toLowerCase();
        return resumeText.includes(keyword.toLowerCase());
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Search className="w-4 h-4" /> Job Tailoring
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Textarea
                        value={jobDescription}
                        onChange={(e) => setJobDescription(e.target.value)}
                        placeholder="Paste job description here..."
                        className="min-h-[100px]"
                    />
                    <Button
                        onClick={handleExtract}
                        disabled={loading || !jobDescription}
                        className="w-full"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : "Extract Keywords"}
                    </Button>
                </div>

                {keywords.length > 0 && (
                    <div className="space-y-2">
                        <h3 className="font-semibold text-sm">Keywords Found:</h3>
                        <div className="flex flex-wrap gap-2">
                            {keywords.map((keyword) => {
                                const isMatch = checkMatch(keyword);
                                return (
                                    <Badge
                                        key={keyword}
                                        variant={isMatch ? "default" : "outline"}
                                        className={isMatch ? "bg-primary/20 text-primary border-primary/50" : ""}
                                    >
                                        {keyword} {isMatch && "✓"}
                                    </Badge>
                                );
                            })}
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                            Highlighted tags are already in your resume. Add the others to increase ATS score.
                        </p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
