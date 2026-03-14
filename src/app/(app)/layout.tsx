import { GlobalGenerationBanner } from '@/components/app/GlobalGenerationBanner';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <GlobalGenerationBanner />
      {children}
    </div>
  );
}
