import Link from 'next/link';

export function Footer() {
  return (
    <footer className="border-t border-border/40">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-10 text-[13px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="Patronus Logo" className="h-7 w-auto drop-shadow-[0_0_6px_rgba(143,201,255,0.5)]" />
            <p className="font-medium text-foreground/80" style={{ fontFamily: "'Sora', system-ui, sans-serif" }}>
              Patronus
            </p>
          </div>
          <p className="text-xs text-muted-foreground/60 leading-relaxed">
            AI resume builder for faster, better job applications.
          </p>
        </div>
        <div className="flex items-center gap-5">
          <Link href="/privacy" className="transition-colors hover:text-foreground">
            Privacy
          </Link>
          <Link href="/terms" className="transition-colors hover:text-foreground">
            Terms
          </Link>
          <a href="mailto:support@patronus.app" className="transition-colors hover:text-foreground">
            Contact
          </a>
        </div>
      </div>
    </footer>
  );
}
