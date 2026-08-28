import { useState } from "react";
import { cn } from "#lib/utils";

type ServiceIconProps = {
  serviceName: string;
  serviceDomain: string;
  className?: string;
};

export function ServiceIcon({ serviceName, serviceDomain, className }: ServiceIconProps) {
  const [failedDomain, setFailedDomain] = useState<string>();
  const failed = failedDomain === serviceDomain;
  const initial = Array.from(serviceName.trim())[0]?.toLocaleUpperCase() ?? "?";

  return (
    <span
      className={cn(
        "bg-muted text-muted-foreground inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-md border text-[0.625rem] font-semibold",
        className,
      )}
      aria-hidden="true"
    >
      {failed ? (
        initial
      ) : (
        <img
          key={serviceDomain}
          src={`https://${serviceDomain}/favicon.ico`}
          alt=""
          className="size-full object-contain"
          referrerPolicy="no-referrer"
          loading="lazy"
          decoding="async"
          onError={() => setFailedDomain(serviceDomain)}
        />
      )}
    </span>
  );
}
