import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils.js";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full text-sm font-medium transition-[color,background-color,transform,box-shadow] duration-200 outline-none select-none hover:-translate-y-px focus-visible:ring-3 focus-visible:ring-ring/30 active:translate-y-0 disabled:pointer-events-none disabled:opacity-50 disabled:hover:translate-y-0 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm shadow-primary/15 hover:bg-primary/88 hover:shadow-md hover:shadow-primary/20",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/78 hover:shadow-sm",
        ghost: "hover:bg-muted hover:text-foreground",
        destructive: "bg-destructive/15 text-destructive hover:bg-destructive/25",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-5",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

function Button({
  className,
  variant,
  size,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
