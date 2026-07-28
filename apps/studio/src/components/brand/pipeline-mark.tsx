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
      <g fill="currentColor">
        <path d="M3 4h6v12l4 4v8l-6-5v-4l-4-4Z" />
        <path d="M11 7h6v11l4 4v9h-6v-6l-4-4Z" />
        <path d="M19 10h6v10l4 4v8h-6v-5l-4-4Z" />
        <path d="M27 13h6v19h-6Z" />
      </g>
    </svg>
  );
}

export { PipelineMark };
