'use client';

import { useState } from 'react';
import { useResumeStore } from '@/store/resumeStore';
import { ResumePreview } from '@/components/preview/ResumePreview';
import { LatexEditor } from '@/components/latex/LatexEditor';
import { LatexPreview } from '@/components/latex/LatexPreview';
import { ATSScoreCard } from './ATSScoreCard';
import { SectionEditor } from './SectionEditor';
import { modifyLatex, resumeToLatex, calculateATSScore } from '@/actions/ai';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { 
    FileText, 
    Code2, 
    Eye,
    Download,
    Wand2,
    Loader2,
    ArrowLeft,
    Target,
    RefreshCw,
    EyeOff,
    Menu,
    User,
    Briefcase,
    FolderKanban,
    GraduationCap,
    Code,
    Settings,
    Sparkles
} from 'lucide-react';
import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
import { cn } from '@/lib/utils';

interface EditorScreenProps {
    onBack: () => void;
}

type SectionType = 'personal' | 'experience' | 'projects' | 'education' | 'skills' | 'section-order';

const sections: { id: SectionType; label: string; icon: React.ReactNode }[] = [
    { id: 'personal', label: 'Personal Info', icon: <User className="w-4 h-4" /> },
    { id: 'experience', label: 'Experience', icon: <Briefcase className="w-4 h-4" /> },
    { id: 'projects', label: 'Projects', icon: <FolderKanban className="w-4 h-4" /> },
    { id: 'education', label: 'Education', icon: <GraduationCap className="w-4 h-4" /> },
    { id: 'skills', label: 'Skills', icon: <Code className="w-4 h-4" /> },
    { id: 'section-order', label: 'Section Order', icon: <Settings className="w-4 h-4" /> },
];

export function EditorScreen({ onBack }: EditorScreenProps) {
    const { 
        latexCode, 
        setLatexCode, 
        resumeData,
        jobDescription,
        atsScore,
        setAtsScore
    } = useResumeStore();
    
    const [editorTab, setEditorTab] = useState<'visual' | 'latex'>('visual');
    const [showPreview, setShowPreview] = useState(true);
    const [activeSection, setActiveSection] = useState<SectionType>('personal');
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [aiInstruction, setAiInstruction] = useState('');
    const [isModifying, setIsModifying] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);

    const handleAiModify = async () => {
        if (!aiInstruction || !latexCode) return;
        setIsModifying(true);
        try {
            const newCode = await modifyLatex(latexCode, aiInstruction);
            if (newCode && newCode !== latexCode) {
                setLatexCode(newCode);
                setAiInstruction('');
            }
        } catch (error) {
            console.error("AI modification failed:", error);
        } finally {
            setIsModifying(false);
        }
    };

    const handleSyncToLatex = async () => {
        setIsSyncing(true);
        try {
            const latex = await resumeToLatex(resumeData);
            setLatexCode(latex);
        } catch (error) {
            console.error("Failed to sync to LaTeX:", error);
        } finally {
            setIsSyncing(false);
        }
    };

    const handleRecalculateScore = async () => {
        if (!jobDescription) return;
        try {
            const score = await calculateATSScore(resumeData, jobDescription);
            setAtsScore(score);
        } catch (error) {
            console.error("Failed to recalculate:", error);
        }
    };

    const handleSectionChange = (section: SectionType) => {
        setActiveSection(section);
        setSidebarOpen(false);
    };

    return (
        <div className="h-screen flex flex-col">
            {/* Header */}
            <header className="h-14 border-b border-border/50 bg-card/50 backdrop-blur-sm flex items-center justify-between px-4 flex-shrink-0">
                <div className="flex items-center gap-3">
                    <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={onBack}
                        className="gap-2"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        <span className="hidden sm:inline">New Job</span>
                    </Button>
                    
                    <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-border/50">
                        <div className="w-8 h-8 rounded-lg gradient-btn flex items-center justify-center">
                            <FileText className="w-4 h-4 text-white" />
                        </div>
                        <span className="font-semibold gradient-text">Resume Editor</span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* ATS Score Badge */}
                    {atsScore && (
                        <Sheet>
                            <SheetTrigger asChild>
                                <Button 
                                    variant="outline" 
                                    size="sm" 
                                    className={cn(
                                        "gap-2 font-semibold border-2",
                                        atsScore.overall >= 80 ? "text-green-400 border-green-500/30 bg-green-500/10 hover:bg-green-500/20" :
                                        atsScore.overall >= 60 ? "text-yellow-400 border-yellow-500/30 bg-yellow-500/10 hover:bg-yellow-500/20" :
                                        "text-red-400 border-red-500/30 bg-red-500/10 hover:bg-red-500/20"
                                    )}
                                >
                                    <Target className="w-4 h-4" />
                                    <span>{atsScore.overall}%</span>
                                </Button>
                            </SheetTrigger>
                            <SheetContent className="w-80 sm:w-96 overflow-y-auto bg-card border-border">
                                <SheetHeader>
                                    <SheetTitle className="gradient-text">ATS Analysis</SheetTitle>
                                </SheetHeader>
                                <div className="space-y-4 pt-4">
                                    <ATSScoreCard />
                                    <Button 
                                        variant="outline" 
                                        size="sm" 
                                        className="w-full gap-2"
                                        onClick={handleRecalculateScore}
                                    >
                                        <RefreshCw className="w-3 h-3" />
                                        Recalculate Score
                                    </Button>
                                </div>
                            </SheetContent>
                        </Sheet>
                    )}

                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setShowPreview(!showPreview)}
                        className="hidden lg:flex"
                        title={showPreview ? "Hide Preview" : "Show Preview"}
                    >
                        {showPreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>

                    <Button variant="gradient" size="sm" className="gap-2">
                        <Download className="w-4 h-4" />
                        <span className="hidden sm:inline">Export</span>
                    </Button>

                    <SignedOut>
                        <SignInButton mode="modal">
                            <Button size="sm" variant="outline">Sign In</Button>
                        </SignInButton>
                    </SignedOut>
                    <SignedIn>
                        <UserButton />
                    </SignedIn>
                </div>
            </header>

            {/* Sub Header - Tabs */}
            <div className="h-12 border-b border-border/50 bg-card/30 flex items-center justify-between px-4 flex-shrink-0">
                <div className="flex items-center gap-3">
                    {/* Section Drawer Trigger */}
                    <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
                        <SheetTrigger asChild>
                            <Button variant="outline" size="sm" className="gap-2">
                                <Menu className="w-4 h-4" />
                                <span className="hidden sm:inline">{sections.find(s => s.id === activeSection)?.label}</span>
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="left" className="w-72 p-0 bg-card border-border">
                            <SheetHeader className="p-4 border-b border-border">
                                <SheetTitle className="text-left gradient-text">Sections</SheetTitle>
                            </SheetHeader>
                            <div className="p-2">
                                {sections.map((section) => (
                                    <button
                                        key={section.id}
                                        onClick={() => handleSectionChange(section.id)}
                                        className={cn(
                                            "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all",
                                            activeSection === section.id 
                                                ? "bg-primary/20 text-primary" 
                                                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                                        )}
                                    >
                                        {section.icon}
                                        {section.label}
                                    </button>
                                ))}
                            </div>
                        </SheetContent>
                    </Sheet>

                    <Tabs value={editorTab} onValueChange={(v) => setEditorTab(v as 'visual' | 'latex')}>
                        <TabsList className="h-8 bg-secondary/50">
                            <TabsTrigger value="visual" className="text-xs gap-1.5 h-7 px-3 data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
                                <Eye className="w-3.5 h-3.5" />
                                Visual
                            </TabsTrigger>
                            <TabsTrigger value="latex" className="text-xs gap-1.5 h-7 px-3 data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
                                <Code2 className="w-3.5 h-3.5" />
                                LaTeX
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>
                </div>

                {editorTab === 'visual' && (
                    <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={handleSyncToLatex}
                        disabled={isSyncing}
                        className="text-xs gap-1.5 h-7"
                    >
                        {isSyncing ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                            <RefreshCw className="w-3 h-3" />
                        )}
                        Sync to LaTeX
                    </Button>
                )}
            </div>

            {/* Main Content */}
            <div className="flex-1 flex overflow-hidden">
                {/* Editor Panel */}
                <div className={cn(
                    "flex flex-col overflow-hidden transition-all duration-300",
                    showPreview ? "w-full lg:w-[55%]" : "w-full"
                )}>
                    {editorTab === 'visual' ? (
                        <div className="flex-1 overflow-y-auto p-4 md:p-6">
                            <div className="max-w-3xl mx-auto">
                                <SectionEditor section={activeSection} />
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col">
                            {/* AI Toolbar for LaTeX */}
                            <div className="h-12 border-b border-border/50 bg-card/30 flex items-center gap-2 px-4 flex-shrink-0">
                                <Sparkles className="w-4 h-4 text-primary flex-shrink-0" />
                                <Input
                                    value={aiInstruction}
                                    onChange={(e) => setAiInstruction(e.target.value)}
                                    placeholder="AI: 'Add certifications section' or 'Make skills two columns'..."
                                    className="flex-1 h-8 text-xs bg-secondary/50 border-border/50"
                                    onKeyDown={(e) => e.key === 'Enter' && handleAiModify()}
                                />
                                <Button
                                    onClick={handleAiModify}
                                    disabled={isModifying || !aiInstruction}
                                    size="sm"
                                    className="h-7 text-xs px-3"
                                >
                                    {isModifying ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Apply'}
                                </Button>
                            </div>
                            
                            {/* LaTeX Editor */}
                            <div className="flex-1 overflow-hidden">
                                <LatexEditor
                                    code={latexCode}
                                    onChange={(val) => setLatexCode(val || '')}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Preview Panel */}
                {showPreview && (
                    <div className="hidden lg:flex w-[45%] border-l border-border/50 flex-col overflow-hidden bg-muted/10">
                        <div className="h-12 border-b border-border/50 bg-card/30 flex items-center px-4 flex-shrink-0">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                {editorTab === 'latex' ? 'PDF Preview' : 'Live Preview'}
                            </span>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4">
                            {editorTab === 'latex' ? (
                                <div className="h-full rounded-xl overflow-hidden border border-border/50 bg-white shadow-xl">
                                    <LatexPreview code={latexCode} />
                                </div>
                            ) : (
                                <div className="bg-white rounded-xl border border-border/50 shadow-xl overflow-hidden">
                                    <ResumePreview />
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
