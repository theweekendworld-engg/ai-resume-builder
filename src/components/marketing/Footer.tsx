import Link from 'next/link';

export function Footer() {
  return (
    <footer className="border-t border-border/80">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <p>© {new Date().getFullYear()} Patronus</p>
          <p className="text-xs">AI resume builder for faster, better job applications.</p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
          <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
          <a href="mailto:support@patronus.app" className="hover:text-foreground transition-colors">Contact</a>
        </div>
      </div>
    </footer>
  );
}
