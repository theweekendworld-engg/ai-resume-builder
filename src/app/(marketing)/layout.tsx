import { Navbar } from '@/components/marketing/Navbar';
import { Footer } from '@/components/marketing/Footer';
import './marketing.css';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    // Dossier paper, the same light tokens as the app (2026-11-08). Marketing
    // used to force `.dark` here and override the accent with its own louder
    // palette; it no longer does, so landing → sign-in → app is one product.
    // Why, in full: the header of `./marketing.css`. `.marketing` stays as the
    // scope class for that stylesheet and nothing else. `light` pins the paper
    // tokens for this subtree, so a signed-in reader who chose dark in
    // Settings still sees the public pages as designed.
    <div className="marketing light min-h-screen bg-background text-foreground">
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
