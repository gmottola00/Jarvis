/**
 * Ultron's eye: a ring around a red core. It breathes while a run is live, so
 * "working" reads at a glance without a spinner.
 */
export function UltronCore({ size = 28, live = false }: { size?: number; live?: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full bg-ink-950 ${live ? "pulse-core" : "glow-box"}`}
      style={{ width: size, height: size }}
    >
      <span
        className={`absolute inset-[3px] rounded-full border border-dashed border-ultron-500/60 ${live ? "spin-slow" : ""}`}
      />
      <span
        className="rounded-full bg-ultron-500 shadow-[0_0_10px_2px] shadow-ultron-500/70"
        style={{ width: size * 0.3, height: size * 0.3 }}
      />
    </span>
  );
}
