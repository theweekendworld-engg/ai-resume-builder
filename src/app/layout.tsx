import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className="relative z-10">
          {children}
        </body>
      </html>
    </ClerkProvider>
  )
}
