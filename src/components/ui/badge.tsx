import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/*
 * Dossier badges: a small ruled tag, 4px corners, 12px medium. Colour only
 * where it means something — `attention` (amber) is "this needs you", and
 * nothing else uses amber. Tints are measured: teal on its 10% tint 4.81:1,
 * amber 5.00:1, accent-foreground on accent 7.34:1.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-medium leading-4 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-accent text-accent-foreground",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive/10 text-destructive",
        outline: "border-border bg-card text-foreground",
        attention: "border-warning/25 bg-warning/10 text-warning",
        success: "border-success/25 bg-success/10 text-success",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
