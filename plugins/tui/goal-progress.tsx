/** @jsxImportSource @opentui/solid */
import { createSignal, onCleanup, Show } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import type { TuiPluginModule, TuiPluginApi } from "@opencode-ai/plugin/tui";
import { goalActivityForSession } from "./progress.ts";

function GoalPanel(props: { api: TuiPluginApi }) {
  const dimensions = useTerminalDimensions();
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(timer));
  const snapshot = () => {
    const route = props.api.route.current;
    if (route.name !== "session" || !route.params?.sessionID) return;
    const id = String(route.params.sessionID);
    return goalActivityForSession(props.api.state.session.get(id), props.api.state.session.messages(id), props.api.state.part);
  };
  const clip = (text: string) => {
    const limit = Math.max(10, dimensions().width - 4);
    const characters = Array.from(text);
    return characters.length > limit ? characters.slice(0, limit - 3).join("") + "..." : text;
  };
  return <Show when={snapshot()}>{value => {
    const elapsed = () => Math.max(0, Math.floor(((value().status === "running" || value().status === "waiting" ? now() : value().updatedAt) - value().phaseStartedAt) / 1000));
    return <box width="100%" flexShrink={0} flexDirection="column" paddingLeft={1} paddingRight={1}
      backgroundColor={props.api.theme.current.backgroundPanel}>
      <text height={1} wrapMode="none" fg={props.api.theme.current.primary}>
        {clip(`Goal activity ${value().cycle} | ${value().phase === "validator" ? "Validator" : value().phase === "coordinator" ? "Coordinator" : "Builder"} | ${value().status} | ${Math.floor(elapsed() / 60)}:${String(elapsed() % 60).padStart(2, "0")}`)}
      </text>
      <text height={1} wrapMode="none" fg={props.api.theme.current.text}>{clip(`Now: ${value().activity}`)}</text>
      <text height={1} wrapMode="none" fg={props.api.theme.current.textMuted}>{clip(value().milestone ? `Reported: ${value().milestone}` : "Reported: awaiting a child milestone")}</text>
      <text height={1} wrapMode="none" fg={props.api.theme.current.textMuted}>{clip(`Verdict: ${value().verdict ?? "none"}${value().attemptsRemaining !== undefined ? ` | Remaining attempts: ${value().attemptsRemaining}` : ""}${value().retryReason ? ` | Repair: ${value().retryReason}` : ""}`)}</text>
    </box>;
  }}</Show>;
}

export default {
  id: "cuddly-winner-goal-progress",
  tui: async (api, options) => {
    if (options?.enabled === false) return;
    // app_bottom appends without replacing prompts and remains visible during
    // approvals and in narrow terminals where the sidebar is hidden.
    api.slots.register({ slots: { app_bottom: () => <GoalPanel api={api} /> } });
  },
} satisfies TuiPluginModule;
