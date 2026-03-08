const clerkSharedVariables = {
  variables: {
    // Use explicit colors for Clerk token generation to avoid low-contrast derived shades.
    colorPrimary: '#8fc9ff',
    colorPrimaryForeground: '#081526',
    colorForeground: '#edf2fa',
    colorMutedForeground: '#aab6c9',
    colorMuted: '#1a2334',
    colorNeutral: '#a5b3c9',
    colorBackground: '#121a28',
    colorInput: '#1a2334',
    colorInputForeground: '#edf2fa',
    colorBorder: '#2b364b',
    colorRing: '#8fc9ff',
    borderRadius: '0.625rem',
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
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
