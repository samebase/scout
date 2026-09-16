import { CheckIcon, CircleAlertIcon, CircleIcon, XIcon } from "lucide-react";
import type { ReviewCheck } from "../../shared/reviewChecks";
import { cn } from "#lib/utils";

const checkStyles = {
  passed: { icon: CheckIcon, label: "Passed", color: "text-emerald-700" },
  failed: { icon: XIcon, label: "Failed", color: "text-amber-700" },
  untested: { icon: CircleIcon, label: "Not tested", color: "text-muted-foreground" },
};

export function ReviewCheckSummary({ checks }: { checks: ReadonlyArray<ReviewCheck> }) {
  if (!checks.length) return null;
  const passed = checks.filter((check) => check.result === "passed").length;
  const failed = checks.some((check) => check.result === "failed");
  const complete = passed === checks.length;
  const Icon = failed ? CircleAlertIcon : complete ? CheckIcon : CircleIcon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap",
        failed ? "text-amber-700" : complete ? "text-emerald-700" : "text-muted-foreground",
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {passed === 0 && !failed ? "Not tested" : `${passed}/${checks.length} passed`}
    </span>
  );
}

export function ReviewChecks({ checks }: { checks: ReadonlyArray<ReviewCheck> }) {
  return (
    <ul aria-label="Review checks" className="space-y-4 border-t pt-5">
      {checks.map((check, index) => {
        const { icon: Icon, label, color } = checkStyles[check.result];
        return (
          <li key={index} className="flex items-start gap-2.5 text-sm">
            <Icon className={cn("mt-0.5 size-4 shrink-0", color)} aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-medium wrap-anywhere">
                <span className="sr-only">{label}: </span>
                {check.label}
              </p>
              <p className="mt-1 text-xs leading-relaxed wrap-anywhere text-muted-foreground">
                {check.explanation}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
