import { ClerkProvider } from '@clerk/nextjs'
import { ThemeProvider } from 'next-themes'
import { Toaster } from '@/components/ui/sonner'
import { clerkGlobalAppearance } from '@/lib/clerkAppearance'
import { fontVariables } from './fonts'
import './globals.css'

export const metadata = {
  title: 'Patronus',
  description: 'AI-tailored resume builder with ATS scoring and live preview.',
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
