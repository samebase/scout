import { Link } from "@tanstack/react-router";
import { TERMS_ACCEPTANCE_LABEL } from "../../shared/terms";

export function TermsCheckbox() {
  return (
    <div className="space-y-2 text-sm leading-6">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="termsAccepted"
          value="true"
          required
          aria-label={TERMS_ACCEPTANCE_LABEL}
          className="mt-1 size-4 shrink-0 accent-primary"
        />
        <span>
          I agree to the{" "}
          <Link
            to="/terms"
            target="_blank"
            rel="noopener"
            className="text-primary underline underline-offset-4"
          >
            Terms and conditions
          </Link>
          .
        </span>
      </label>
      <p className="text-muted-foreground">
        Read our{" "}
        <Link
          to="/privacy"
          target="_blank"
          rel="noopener"
          className="text-primary underline underline-offset-4"
        >
          Privacy policy
        </Link>
        .
      </p>
    </div>
  );
}
