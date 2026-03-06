import { ClerkProvider } from '@clerk/nextjs'
import { Toaster } from '@/components/ui/sonner'
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
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body className="relative z-10 min-h-screen bg-background text-foreground antialiased">
          {children}
          <Toaster />
        </body>
      </html>
    </ClerkProvider>
  )
}
