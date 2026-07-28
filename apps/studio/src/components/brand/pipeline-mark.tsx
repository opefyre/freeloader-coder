import { useId, type ComponentProps } from "react";

import { cn } from "../../lib/utils.js";

function PipelineMark({
  className,
  title = "Pipeline Studio",
  ...props
}: ComponentProps<"svg"> & { title?: string }) {
  const titleId = useId();

  return (
    <svg
      viewBox="0 0 36 36"
      role="img"
      aria-labelledby={titleId}
      className={cn("size-6", className)}
      {...props}
    >
      <title id={titleId}>{title}</title>
      <path
        d="M10 28V9.5C10 8.67 10.67 8 11.5 8H19c4.42 0 8 3.13 8 7s-3.58 7-8 7h-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="28" r="2.5" fill="currentColor" />
      <circle cx="10" cy="8" r="2.5" fill="currentColor" />
      <circle cx="27" cy="15" r="2.5" fill="currentColor" />
      <path
        d="m20.5 27 2.3 2.3 4.7-5.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity=".72"
      />
    </svg>
  );
}

export { PipelineMark };
