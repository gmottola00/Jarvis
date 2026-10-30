/**
 * The HUD kit: everything a console page is built from. Presentational only,
 * no data fetching. A new page should need nothing outside this folder,
 * `ui/tone` and `ui/primitives` (states: Loading, ErrorNote, Learn) to look
 * like the others:
 *
 *   <HudPage title="…" subtitle="…" live={refreshing}
 *            status={<LiveStamp error={!!error} every={POLL_MS} at={data?.fetched_at} />}
 *            actions={<RefreshButton onClick={refresh} refreshing={refreshing} />}>
 *     <Readouts readouts={…} />
 *     <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
 *       <HudCard eyebrow="…" title="…">…</HudCard>          main column
 *       <div className="min-w-0 space-y-4"><HudPanel title="…">…</HudPanel></div>   side column
 *     </div>
 *   </HudPage>
 *
 * Colour rules: Ultron red is identity and focus, never "bad". Rose is broken,
 * amber is "look at this", emerald is fine. Tones come from `ui/tone`; do not
 * write a status colour by hand.
 */

export { BracketTabs, HudButton, RefreshButton } from "./controls";
export { Gauge, Readouts, type Readout } from "./instruments";
export { Aside, GlowDot, Leader, StatusMark } from "./marks";
export { HudBackdrop, HudPage, LiveStamp } from "./page";
export { AlertPanel, Corners, HudCard, HudHeading, HudPanel, Quiet, ToneCard, type AlarmTone } from "./panels";
