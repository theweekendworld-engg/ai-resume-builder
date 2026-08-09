import { Navbar } from '@/components/marketing/Navbar';
import { Footer } from '@/components/marketing/Footer';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    // Marketing keeps the dark identity while the authenticated app defaults to
    // light (design/00 §3.1). `.dark` is a plain class, so it scopes to this subtree.
    <div className="marketing dark min-h-screen bg-background text-foreground">
      <Navbar />
      <main>{children}</main>
      <Footer />
    </div>
  );
}
