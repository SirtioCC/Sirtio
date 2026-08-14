export default function ProbabilityBar({
  yesPriceCents,
  hidePrice = false,
}: {
  yesPriceCents: number | null;
  hidePrice?: boolean;
}) {
  const yes = yesPriceCents ?? 50;
  const clamped = Math.min(100, Math.max(0, yes));

  return (
    <div className="flex items-center gap-3 w-full">
      <div className="relative h-2 flex-1 rounded-full bg-hairline overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-signal-yes"
          style={{ width: `${clamped}%` }}
        />
      </div>
      {!hidePrice && (
        <span className="font-mono text-sm tabular-nums text-parchment w-12 text-right">
          {clamped.toFixed(0)}¢
        </span>
      )}
    </div>
  );
}
