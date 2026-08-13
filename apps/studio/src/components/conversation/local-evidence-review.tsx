import { FloppyDisk } from "@phosphor-icons/react/FloppyDisk";

import type { LocalProjectFileImportResponse } from "../../../../../packages/runtime/src/local-projects.js";
import { Button } from "../ui/button.js";

type ImportedFile = LocalProjectFileImportResponse["files"][number];

export function LocalEvidenceReview(props: {
  file: ImportedFile;
  value: string;
  saved: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <div className="w-full space-y-2 pt-1">
      <label
        className="block text-[11px] font-semibold text-muted-foreground"
        htmlFor={`evidence-${props.file.evidence.sourceDigest}`}
      >
        Review extracted summary
      </label>
      <textarea
        id={`evidence-${props.file.evidence.sourceDigest}`}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        rows={2}
        maxLength={2_000}
        className="w-full resize-y rounded-2xl bg-muted px-3 py-2 text-xs leading-5 outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={props.disabled || props.saved}
          onClick={props.onSave}
        >
          <FloppyDisk />
          {props.saved ? "Correction saved" : "Save correction"}
        </Button>
        <span className="text-[11px] text-muted-foreground">
          Saving regenerates project context from the owner correction.
        </span>
      </div>
    </div>
  );
}
