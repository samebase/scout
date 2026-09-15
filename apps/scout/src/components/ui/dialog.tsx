import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { XIcon } from "lucide-react";
import { cn } from "#lib/utils";

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogContent({
  className,
  children,
  container,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> &
  Pick<React.ComponentProps<typeof DialogPrimitive.Portal>, "container">) {
  return (
    <DialogPrimitive.Portal container={container}>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className="fixed inset-0 z-50 bg-black/50 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=closed]:fade-out-0"
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border bg-background p-6 text-foreground shadow-lg outline-none duration-150 sm:max-w-lg motion-safe:data-[state=open]:animate-in motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=closed]:fade-out-0 motion-safe:data-[state=open]:zoom-in-95 motion-safe:data-[state=closed]:zoom-out-95",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute top-3 right-3 flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none">
          <XIcon className="size-4" aria-hidden="true" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-left", className)}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg font-semibold leading-none", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger };
