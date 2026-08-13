import { Navbar } from '@/components/marketing/Navbar';
import { Footer } from '@/components/marketing/Footer';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    // Marketing keeps the dark identity while the authenticated app defaults to
    // light (design/00 §3.1). `.dark` is a plain class, so it scopes to this subtree.
    // `.marketing` sits on the same element and overrides the accent tokens to the
    // landing page's louder palette — see the block in globals.css.
    <div className="marketing dark min-h-screen bg-background text-foreground">
      {/*
        Scroll reveals start at opacity 0 and are promoted by an
        IntersectionObserver (`Reveal`). With scripting unavailable that promotion
        never happens and the entire page renders blank — the content is in the
        HTML, it is just invisible. One rule restores it, and it costs nothing to
        anyone whose JS did load.
      */}
      <noscript>
        <style>{`.marketing [data-reveal]{opacity:1!important;transform:none!important}`}</style>
      </noscript>

      <Navbar />
      <main>{children}</main>
      <Footer />
    </div>
  );
}
