export function ScoutMark({ className }: { className: string }) {
  return (
    <img
      src="/scout-mark.png"
      width={64}
      height={64}
      alt=""
      aria-hidden="true"
      className={`inline-block shrink-0 object-contain ${className}`}
    />
  );
}
