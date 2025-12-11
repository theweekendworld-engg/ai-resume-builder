'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useResumeStore } from '@/store/resumeStore';
import { LatexEditor } from '@/components/latex/LatexEditor';
import { LatexPreview } from '@/components/latex/LatexPreview';
import { ATSScoreCard } from './ATSScoreCard';
import { SectionEditor } from './SectionEditor';
import { modifyLatex, calculateATSScore, compileLatex } from '@/actions/ai';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
    FileText, 
    Code2, 
    Eye,
    Download,
    Loader2,
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
    Sparkles,
    Home,
    Trash2,
    Wand2,
    Info,
    CheckCircle2,
    AlertCircle
} from 'lucide-react';
import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
import { cn } from '@/lib/utils';
import { TEMPLATE_OPTIONS, LatexTemplateType } from '@/templates/latex';

type SectionType = 'personal' | 'experience' | 'projects' | 'education' | 'skills' | 'section-order' | 'job-target';

const sections: { id: SectionType; label: string; icon: React.ReactNode; isSmart?: boolean; tooltip?: string }[] = [
    { id: 'job-target', label: 'Job Target', icon: <Target className="w-4 h-4" />, isSmart: true, tooltip: 'Add a job description to get match scores and tailored suggestions' },
    { id: 'personal', label: 'Personal Info', icon: <User className="w-4 h-4" />, tooltip: 'Your name, contact info, and links' },
    { id: 'experience', label: 'Experience', icon: <Briefcase className="w-4 h-4" />, tooltip: 'Work history with bullet points' },
    { id: 'projects', label: 'Projects', icon: <FolderKanban className="w-4 h-4" />, tooltip: 'Personal and professional projects' },
    { id: 'education', label: 'Education', icon: <GraduationCap className="w-4 h-4" />, tooltip: 'Degrees and certifications' },
    { id: 'skills', label: 'Skills', icon: <Code className="w-4 h-4" />, tooltip: 'Technical and soft skills' },
    { id: 'section-order', label: 'Section Order', icon: <Settings className="w-4 h-4" />, tooltip: 'Rearrange resume sections' },
];

export function EditorScreen() {
    const router = useRouter();
    const { 
        latexCode, 
        setLatexCode, 
        resumeData,
        jobDescription,
        atsScore,
        setAtsScore,
        selectedTemplate,
        setSelectedTemplate,
        setEditorMode,
        generateLatexFromData,
        isUsingSampleData,
        resetResume,
    } = useResumeStore();
    
    const [editorTab, setEditorTab] = useState<'visual' | 'latex'>('visual');
    const [showPreview, setShowPreview] = useState(true);
    const [activeSection, setActiveSection] = useState<SectionType>('job-target');
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [aiInstruction, setAiInstruction] = useState('');
    const [isModifying, setIsModifying] = useState(false);
    const [exportModalOpen, setExportModalOpen] = useState(false);
    const [exportFileName, setExportFileName] = useState('');
    const [isExporting, setIsExporting] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);
    const [exportSuccess, setExportSuccess] = useState(false);

    useEffect(() => {
        setEditorMode(editorTab);
        if (editorTab === 'visual') {
            generateLatexFromData();
        }
    }, [editorTab, setEditorMode, generateLatexFromData]);

    useEffect(() => {
        generateLatexFromData();
    }, [generateLatexFromData]);

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
            console.error("Modification failed:", error);
        } finally {
            setIsModifying(false);
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

    const openExportModal = () => {
        const defaultName = resumeData.personalInfo.fullName 
            ? `${resumeData.personalInfo.fullName.replace(/\s+/g, '_')}_Resume`
            : 'My_Resume';
        setExportFileName(defaultName);
        setExportError(null);
        setExportSuccess(false);
        setExportModalOpen(true);
    };

    const handleExport = async () => {
        if (!latexCode || !exportFileName.trim()) return;
        setIsExporting(true);
        setExportError(null);
        setExportSuccess(false);
        
        try {
            const result = await compileLatex(latexCode);
            if (result.success && result.pdfBase64) {
                const link = document.createElement('a');
                link.href = `data:application/pdf;base64,${result.pdfBase64}`;
                const fileName = exportFileName.trim().replace(/\.pdf$/i, '') + '.pdf';
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                setExportSuccess(true);
                setTimeout(() => {
                    setExportModalOpen(false);
                    setExportSuccess(false);
                }, 1500);
            } else {
                setExportError(result.error || 'Compilation failed. Check your LaTeX syntax.');
            }
        } catch (error) {
            console.error('Export error:', error);
            setExportError('Failed to export PDF. Please try again.');
        } finally {
            setIsExporting(false);
        }
    };

    const closeExportModal = () => {
        if (!isExporting) {
            setExportModalOpen(false);
            setExportError(null);
            setExportSuccess(false);
        }
    };

    const handleTabChange = (tab: 'visual' | 'latex') => {
        setEditorTab(tab);
    };

    return (
        <TooltipProvider>
            <div className="h-screen flex flex-col">
                <header className="h-14 border-b border-border/50 bg-card/50 backdrop-blur-sm flex items-center justify-between px-4 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    onClick={() => router.push('/')}
                                    className="gap-2"
                                >
                                    <Home className="w-4 h-4" />
                                    <span className="hidden sm:inline">Home</span>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Back to home page</TooltipContent>
                        </Tooltip>
                        
                        <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-border/50">
                            <div className="w-8 h-8 rounded-lg gradient-btn flex items-center justify-center">
                                <FileText className="w-4 h-4 text-white" />
                            </div>
                            <span className="font-semibold gradient-text">Resume Editor</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {atsScore && (
                            <Sheet>
                                <Tooltip>
                                    <TooltipTrigger asChild>
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
                                    </TooltipTrigger>
                                    <TooltipContent>View detailed match analysis</TooltipContent>
                                </Tooltip>
                                <SheetContent className="w-80 sm:w-96 overflow-y-auto bg-card border-border">
                                    <SheetHeader>
                                        <SheetTitle className="gradient-text flex items-center gap-2">
                                            Match Analysis
                                        </SheetTitle>
                                    </SheetHeader>
                                    <div className="space-y-4 pt-4">
                                        <ATSScoreCard />
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button 
                                                    variant="outline" 
                                                    size="sm" 
                                                    className="w-full gap-2"
                                                    onClick={handleRecalculateScore}
                                                >
                                                    <RefreshCw className="w-3 h-3" />
                                                    Recalculate Score
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>Refresh the match score based on current resume</TooltipContent>
                                        </Tooltip>
                                    </div>
                                </SheetContent>
                            </Sheet>
                        )}

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setShowPreview(!showPreview)}
                                    className="hidden lg:flex"
                                >
                                    {showPreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>{showPreview ? "Hide preview" : "Show preview"}</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button 
                                    variant="gradient" 
                                    size="sm" 
                                    className="gap-2"
                                    onClick={openExportModal}
                                    disabled={!latexCode}
                                >
                                    <Download className="w-4 h-4" />
                                    <span className="hidden sm:inline">Export</span>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Download as PDF</TooltipContent>
                        </Tooltip>

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

                <div className="h-12 border-b border-border/50 bg-card/30 flex items-center justify-between px-4 flex-shrink-0">
                    <div className="flex items-center gap-3">
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
                                <div className="p-2 flex-1">
                                    {sections.map((section) => (
                                        <Tooltip key={section.id}>
                                            <TooltipTrigger asChild>
                                                <button
                                                    onClick={() => handleSectionChange(section.id)}
                                                    className={cn(
                                                        "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all",
                                                        activeSection === section.id 
                                                            ? "bg-primary/20 text-primary" 
                                                            : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                                                        section.isSmart && "smart-feature"
                                                    )}
                                                >
                                                    {section.icon}
                                                    {section.label}
                                                    {section.isSmart && (
                                                        <Sparkles className="w-3 h-3 text-indigo-400 ml-auto" />
                                                    )}
                                                </button>
                                            </TooltipTrigger>
                                            {section.tooltip && (
                                                <TooltipContent side="right">
                                                    {section.tooltip}
                                                </TooltipContent>
                                            )}
                                        </Tooltip>
                                    ))}
                                </div>
                                <div className="p-4 border-t border-border">
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 gap-2"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                                Reset to Sample Data
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle className="flex items-center gap-2">
                                                    <Trash2 className="w-5 h-5 text-destructive" />
                                                    Reset Resume Data?
                                                </AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    This will replace all your current resume data with the sample template. 
                                                    Any changes you&apos;ve made will be lost. This action cannot be undone.
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                <AlertDialogAction
                                                    onClick={() => {
                                                        resetResume();
                                                        setSidebarOpen(false);
                                                    }}
                                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                >
                                                    Reset Data
                                                </AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </div>
                            </SheetContent>
                        </Sheet>

                        <Tabs value={editorTab} onValueChange={(v) => handleTabChange(v as 'visual' | 'latex')}>
                            <TabsList className="h-8 bg-secondary/50">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <TabsTrigger value="visual" className="text-xs gap-1.5 h-7 px-3 data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
                                            <Eye className="w-3.5 h-3.5" />
                                            Visual
                                        </TabsTrigger>
                                    </TooltipTrigger>
                                    <TooltipContent>Edit with form fields</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <TabsTrigger value="latex" className="text-xs gap-1.5 h-7 px-3 data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
                                            <Code2 className="w-3.5 h-3.5" />
                                            LaTeX
                                        </TabsTrigger>
                                    </TooltipTrigger>
                                    <TooltipContent>Edit raw LaTeX code</TooltipContent>
                                </Tooltip>
                            </TabsList>
                        </Tabs>
                    </div>

                    {editorTab === 'visual' && (
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground hidden sm:inline">Template:</span>
                            <Select 
                                value={selectedTemplate} 
                                onValueChange={(v) => setSelectedTemplate(v as LatexTemplateType)}
                            >
                                <SelectTrigger className="w-[160px] h-7 text-xs">
                                    <SelectValue placeholder="Select Template" />
                                </SelectTrigger>
                                <SelectContent>
                                    {TEMPLATE_OPTIONS.map((template) => (
                                        <SelectItem key={template.value} value={template.value}>
                                            {template.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                </div>

                {isUsingSampleData() && (
                    <div className="h-10 bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-indigo-500/10 border-b border-indigo-500/20 flex items-center justify-center gap-2 text-sm text-indigo-300 flex-shrink-0">
                        <Info className="w-4 h-4" />
                        <span>You&apos;re editing sample data. Replace it with your own information!</span>
                    </div>
                )}

                <div className="flex-1 flex overflow-hidden">
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
                                <div className="h-12 border-b border-border/50 bg-gradient-to-r from-indigo-500/5 via-purple-500/5 to-indigo-500/5 flex items-center gap-2 px-4 flex-shrink-0">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                <Wand2 className="w-4 h-4 text-indigo-400" />
                                                <span className="feature-badge hidden sm:flex">Smart Edit</span>
                                            </div>
                                        </TooltipTrigger>
                                        <TooltipContent>Describe changes in plain English</TooltipContent>
                                    </Tooltip>
                                    <Input
                                        value={aiInstruction}
                                        onChange={(e) => setAiInstruction(e.target.value)}
                                        placeholder="'Add certifications section', 'Make skills two columns'..."
                                        className="flex-1 h-8 text-xs bg-secondary/50 border-indigo-500/20 focus:border-indigo-500/50"
                                        onKeyDown={(e) => e.key === 'Enter' && handleAiModify()}
                                    />
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                onClick={handleAiModify}
                                                disabled={isModifying || !aiInstruction}
                                                variant="ai"
                                                size="sm"
                                                className="h-7 text-xs px-3"
                                            >
                                                {isModifying ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Apply'}
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Apply your changes to the LaTeX</TooltipContent>
                                    </Tooltip>
                                </div>
                                
                                <div className="flex-1 overflow-hidden">
                                    <LatexEditor
                                        code={latexCode}
                                        onChange={(val) => setLatexCode(val || '')}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {showPreview && (
                        <div className="hidden lg:flex w-[45%] border-l border-border/50 flex-col overflow-hidden bg-muted/10">
                            <div className="h-12 border-b border-border/50 bg-card/30 flex items-center justify-between px-4 flex-shrink-0">
                                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                    Live Preview
                                </span>
                                {editorTab === 'latex' && (
                                    <Select 
                                        value={selectedTemplate} 
                                        onValueChange={(v) => setSelectedTemplate(v as LatexTemplateType)}
                                    >
                                        <SelectTrigger className="w-[140px] h-7 text-xs">
                                            <SelectValue placeholder="Template" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {TEMPLATE_OPTIONS.map((template) => (
                                                <SelectItem key={template.value} value={template.value}>
                                                    {template.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            </div>
                            <div className="flex-1 overflow-hidden">
                                <div className="h-full rounded-xl overflow-hidden border border-border/50 bg-white shadow-xl m-4">
                                    <LatexPreview code={latexCode} />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Export Modal */}
            <Dialog open={exportModalOpen} onOpenChange={closeExportModal}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Download className="w-5 h-5 text-primary" />
                            Export Resume
                        </DialogTitle>
                        <DialogDescription>
                            Your resume will be compiled and downloaded as a PDF.
                        </DialogDescription>
                    </DialogHeader>
                    
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="filename">File Name</Label>
                            <div className="flex items-center gap-2">
                                <Input
                                    id="filename"
                                    value={exportFileName}
                                    onChange={(e) => setExportFileName(e.target.value)}
                                    placeholder="My_Resume"
                                    className="flex-1"
                                    disabled={isExporting || exportSuccess}
                                />
                                <span className="text-sm text-muted-foreground">.pdf</span>
                            </div>
                        </div>

                        {exportError && (
                            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-sm text-destructive flex items-start gap-2">
                                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                <span>{exportError}</span>
                            </div>
                        )}

                        {exportSuccess && (
                            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-sm text-green-400 flex items-center gap-2">
                                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                                <span>Download started!</span>
                            </div>
                        )}
                    </div>

                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button
                            variant="outline"
                            onClick={closeExportModal}
                            disabled={isExporting}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleExport}
                            disabled={isExporting || !exportFileName.trim() || exportSuccess}
                            className="gap-2"
                        >
                            {isExporting ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Compiling...
                                </>
                            ) : exportSuccess ? (
                                <>
                                    <CheckCircle2 className="w-4 h-4" />
                                    Done!
                                </>
                            ) : (
                                <>
                                    <Download className="w-4 h-4" />
                                    Download PDF
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </TooltipProvider>
    );
}
