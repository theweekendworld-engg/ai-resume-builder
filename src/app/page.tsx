'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { 
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { 
    ArrowRight,
    FileText,
    Target,
    Github,
    Wand2,
    Zap,
    Shield,
    Sparkles
} from 'lucide-react';

const features = [
    {
        icon: <Wand2 className="w-5 h-5" />,
        title: "Smart Writing",
        description: "Enhance your bullets with powerful action verbs and metrics",
        tooltip: "Get suggestions to improve your bullet points with industry-standard phrasing"
    },
    {
        icon: <Target className="w-5 h-5" />,
        title: "Job Match Score",
        description: "See how well your resume matches any job description",
        tooltip: "Paste a job description and get instant feedback on keyword matches"
    },
    {
        icon: <Github className="w-5 h-5" />,
        title: "GitHub Import",
        description: "Turn your repositories into impressive project entries",
        tooltip: "Connect your GitHub to automatically import and format your best projects"
    },
    {
        icon: <FileText className="w-5 h-5" />,
        title: "Pro Templates",
        description: "Beautiful LaTeX templates with live preview and PDF export",
        tooltip: "Choose from multiple professional templates used by top companies"
    },
];

export default function Home() {
    const router = useRouter();

    return (
        <TooltipProvider>
            <div className="min-h-screen flex items-center justify-center p-4">
                <div className="w-full max-w-3xl">
                    <div className="text-center mb-10">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl gradient-btn mb-6 shadow-lg shadow-purple-500/20">
                            <FileText className="w-10 h-10 text-white" />
                        </div>
                        <h1 className="text-5xl font-bold mb-4">
                            <span className="text-foreground">Build Your </span>
                            <span className="gradient-text">Perfect Resume</span>
                        </h1>
                        <p className="text-muted-foreground text-xl max-w-xl mx-auto">
                            Create job-winning resumes in minutes. 
                            Free, fast, and tailored to land your dream role.
                        </p>
                    </div>

                    <div className="flex flex-col items-center gap-4 mb-12">
                        <Button 
                            onClick={() => router.push('/editor')}
                            size="lg"
                            className="gap-3 px-10 py-6 text-lg gradient-btn border-0 text-white hover:text-white"
                        >
                            <Zap className="w-5 h-5" />
                            Start Building
                            <ArrowRight className="w-5 h-5" />
                        </Button>
                        <p className="text-sm text-muted-foreground flex items-center gap-2">
                            <Shield className="w-4 h-4" />
                            Quick and simple. No sign-up required.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {features.map((feature, index) => (
                            <Tooltip key={index}>
                                <TooltipTrigger asChild>
                                    <div className="feature-card rounded-xl p-5 cursor-default">
                                        <div className="flex items-start gap-4">
                                            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-pink-500/20 to-blue-500/20 flex items-center justify-center text-indigo-400 flex-shrink-0">
                                                {feature.icon}
                                            </div>
                                            <div>
                                                <h3 className="font-semibold text-foreground mb-1 flex items-center gap-2">
                                                    {feature.title}
                                                    {(feature.title === "Smart Writing" || feature.title === "Job Match Score") && (
                                                        <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                                                    )}
                                                </h3>
                                                <p className="text-sm text-muted-foreground">{feature.description}</p>
                                            </div>
                                        </div>
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="max-w-xs">
                                    <p>{feature.tooltip}</p>
                                </TooltipContent>
                            </Tooltip>
                        ))}
                    </div>

                    <p className="text-center text-sm text-muted-foreground mt-10 flex items-center justify-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                        Your data stays in your browser. Always private.
                    </p>
                </div>
            </div>
        </TooltipProvider>
    );
}
