import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// Pill buttons, ADHDesigns house style. Generous heights for comfortable touch
// targets (≥44px on md).
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-opacity disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
  {
    variants: {
      variant: {
        primary: "bg-gold text-ink hover:opacity-90",
        secondary: "bg-teal text-surface hover:opacity-90",
        calm: "bg-mint text-ink hover:opacity-90",
        ghost: "bg-lavender text-ink hover:opacity-90",
        outline: "border border-lavender bg-card text-ink hover:bg-lavender/40",
        danger: "bg-[var(--color-overdue)] text-surface hover:opacity-90",
      },
      size: {
        sm: "h-9 px-4 text-sm",
        md: "h-11 px-6 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
)

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { buttonVariants }
