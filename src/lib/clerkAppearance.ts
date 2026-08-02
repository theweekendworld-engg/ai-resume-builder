/**
 * Clerk's palette, bound to the app's theme tokens.
 *
 * These were eight hardcoded dark hexes, and because `ClerkProvider` carries
 * this appearance in the ROOT layout, that palette shipped on every page. Once
 * the authenticated app defaulted to light, the result was a widget split down
 * the middle: `variables` painted a navy card with near-white text, while the
 * `elements` map below overrode *some* nodes with semantic classes that
 * correctly flipped light — near-white text on a near-white card, across every
 * UserButton, both auth pages and the whole UserProfile.
 *
 * Clerk accepts any valid CSS color string, so `hsl(var(--token))` resolves at
 * paint time against whichever theme is active. One source of truth, and the
 * widget can no longer disagree with the page it sits on.
 */
const clerkSharedVariables = {
  variables: {
    colorPrimary: 'hsl(var(--primary))',
    colorPrimaryForeground: 'hsl(var(--primary-foreground))',
    colorForeground: 'hsl(var(--foreground))',
    colorMutedForeground: 'hsl(var(--muted-foreground))',
    colorMuted: 'hsl(var(--muted))',
    colorNeutral: 'hsl(var(--muted-foreground))',
    colorBackground: 'hsl(var(--card))',
    colorInput: 'hsl(var(--input))',
    colorInputForeground: 'hsl(var(--foreground))',
    colorBorder: 'hsl(var(--border))',
    colorRing: 'hsl(var(--ring))',
    borderRadius: 'var(--radius)',
    // next/font hashes the family name, so the literal "Inter" no longer
    // resolves and this silently fell back to system-ui.
    fontFamily: 'var(--font-inter), -apple-system, BlinkMacSystemFont, sans-serif',
  },
} as const;

export const clerkGlobalAppearance = {
  ...clerkSharedVariables,
  elements: {
    userButtonAvatarBox: 'h-8 w-8 ring-1 ring-border',
    userButtonTrigger:
      'rounded-full outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    userButtonPopoverCard:
      'border border-border bg-card text-card-foreground shadow-xl backdrop-blur supports-[backdrop-filter]:bg-card/95',
    userButtonPopoverMain: 'bg-card text-foreground',
    userButtonPopoverFooter: 'border-t border-border bg-card/90',
    userButtonPopoverActionButton:
      'rounded-md !text-foreground transition-colors hover:bg-secondary hover:!text-secondary-foreground',
    userButtonPopoverActionButtonText: '!text-foreground text-sm font-medium',
    userButtonPopoverActionButtonIcon: '!text-muted-foreground',
    userPreviewMainIdentifier: '!text-foreground',
    userPreviewSecondaryIdentifier: '!text-muted-foreground',

    userProfileRootBox: 'w-full',
    userProfileCard:
      'w-full border border-border bg-card text-card-foreground shadow-xl backdrop-blur',
    userProfileNavbar: 'border-r border-border bg-card/70',
    userProfileContentMain: 'bg-card',
    profileSection__connectedAccounts: 'border border-border/70 rounded-lg bg-background/70',
    profileSectionTitleText__connectedAccounts: '!text-foreground',
    profileSectionSubtitleText__connectedAccounts: '!text-muted-foreground',
    profileSectionContent__connectedAccounts: 'space-y-2',
    profileSectionItem__connectedAccounts:
      'rounded-md border border-border/70 bg-card/80 !text-foreground opacity-100',
    profileSectionItemList__connectedAccounts: 'space-y-2',
    profileSectionPrimaryButton__connectedAccounts:
      'h-9 !text-primary hover:!text-primary/90 hover:bg-secondary/70',
    identityPreviewText: '!text-foreground',
    navbarButton:
      'rounded-md text-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground',
    navbarButtonActive: 'bg-secondary text-secondary-foreground',
    profileSectionTitleText: 'font-heading text-foreground',
    profileSectionContent: 'border border-border bg-background/70 rounded-lg',
    formButtonPrimary:
      'h-10 bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0',
    formFieldInput:
      'h-10 border border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0',
    badge: 'border border-border bg-secondary text-secondary-foreground',
  },
} as const;

export const clerkAuthAppearance = {
  ...clerkSharedVariables,
  elements: {
    rootBox: '',
    cardBox: '',
    card: 'max-w-md border border-border bg-card/95 shadow-xl backdrop-blur flex-col',
    headerTitle: 'font-heading text-2xl text-foreground',
    headerSubtitle: 'text-muted-foreground',
    socialButtonsBlockButton:
      'border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors',
    socialButtonsBlockButtonText: 'text-sm font-medium',
    dividerLine: 'bg-border',
    dividerText: 'text-muted-foreground',
    formFieldLabel: 'text-foreground',
    formFieldInput:
      'h-10 border border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0',
    formButtonPrimary:
      'h-10 bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0',
    footerActionText: 'text-muted-foreground',
    footerActionLink: 'text-primary hover:text-primary/90',
    formResendCodeLink: 'text-primary hover:text-primary/90',
    otpCodeFieldInput:
      'border border-input bg-background text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0',
    alertText: 'text-foreground',
    formFieldWarningText: 'text-destructive',
  },
} as const;
