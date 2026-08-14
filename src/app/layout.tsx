import { ClerkProvider } from '@clerk/nextjs'
import { ThemeProvider } from 'next-themes'
import { Toaster } from '@/components/ui/sonner'
import { clerkGlobalAppearance } from '@/lib/clerkAppearance'
import { fontVariables } from './fonts'
import './globals.css'


/*
 * This is the tagline that does the most work — it is what a search result, a
 * shared link and a browser tab show, long before anyone reads the hero. It was
 * still describing the product as an "AI-tailored resume builder with ATS
 * scoring and live preview", which is both the pre-Career-OS positioning and a
 * sentence any competitor could publish verbatim. It now matches the hero.
 */
export const metadata = {
  title: 'Patronus — more interviews from work you’ve already done',
  description:
    'Your resume, assembled from work you logged and confirmed — nothing to write from scratch, nothing invented. See what a real posting makes of it: free, 60 seconds, no signup.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider appearance={{ ...clerkGlobalAppearance, cssLayerName: 'clerk' }}>
      <html lang="en" className={fontVariables} suppressHydrationWarning>
        <body className="relative z-10 min-h-screen bg-background text-foreground antialiased">
          {/*
            design/00 §3.1: light is the default for the authenticated app.
            `enableSystem` is off on purpose — the doc is explicit that this is
            not an OS preference, it is a decision about the job the surface
            does. Dark stays a first-class, user-selectable option.

            Marketing keeps dark as its default by putting the `dark` class on
            its own layout wrapper; `.dark` is a plain class, so it scopes to
            any subtree. See DEVIATIONS in the handoff notes.
          */}
          <ThemeProvider
            attribute="class"
            defaultTheme="light"
            enableSystem={false}
            disableTransitionOnChange
            storageKey="patronus-theme"
          >
            {children}
            <Toaster />
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}
