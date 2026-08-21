import { useId, type ComponentProps } from "react";

import { cn } from "../../lib/utils.js";

function PipelineMark({
  className,
  title = "Codkesh",
  ...props
}: ComponentProps<"svg"> & { title?: string }) {
  const titleId = useId();
  const maskId = useId();

  return (
    <svg
      viewBox="0 0 36 36"
      role="img"
      aria-labelledby={titleId}
      className={cn("size-6", className)}
      {...props}
    >
      <title id={titleId}>{title}</title>
      <defs>
        <mask id={maskId}>
          <rect width="36" height="36" fill="white" />
          <g
            fill="none"
            stroke="black"
            strokeWidth="4.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M0 8h6.5c3.2 0 4.3 1.1 6.6 3.4l3.1 3.1" />
            <path d="M0 18h14.3" />
            <path d="M0 28h6.5c3.2 0 4.3-1.1 6.6-3.4l3.1-3.1" />
            <path d="M12 0v6.5c0 3.2 1.1 4.3 3.4 6.6l1.2 1.2" />
            <path d="M12 36v-6.5c0-3.2 1.1-4.3 3.4-6.6l1.2-1.2" />
          </g>
          <circle cx="20" cy="18" r="5.7" fill="black" />
          <path d="M20 15.2h16v5.6H20Z" fill="black" />
        </mask>
      </defs>
      <rect
        x="2"
        y="2"
        width="32"
        height="32"
        rx="9"
        fill="currentColor"
        mask={`url(#${maskId})`}
      />
    </svg>
  );
}

export { PipelineMark };
