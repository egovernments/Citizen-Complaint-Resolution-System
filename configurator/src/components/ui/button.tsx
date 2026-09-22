import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        // DIGIT's Secondary: a stroke and no fill, in the primary colour.
        // Neutral `border-input` was the shadcn default and read as a disabled
        // control next to a solid primary rather than as the complementary
        // action the system intends.
        outline:
          "border border-primary bg-transparent text-primary shadow-sm hover:bg-accent",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        // DIGIT's Tertiary: text only, and in its own blue rather than the
        // theme's primary. Bomet ships `--color-button-tertiary-text: #2563EB`
        // separately from its primary, so tertiary is not "primary without the
        // fill" — it is a distinct, quieter action colour. Kept apart from
        // `ghost` too: ghost carries the icon buttons here (67 of them), and
        // those want neutral ink, not a coloured glyph.
        tertiary: "text-[#2563EB] hover:bg-accent",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        // DIGIT's Link: underlined always, not on hover. The underline is what
        // marks it as navigation, so revealing it on hover hides the only
        // signal a reader has.
        link: "text-primary underline underline-offset-4",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
