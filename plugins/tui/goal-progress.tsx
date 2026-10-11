/** @jsxImportSource @opentui/solid */
import { createResource, onCleanup, Show } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import type { TuiPluginModule, TuiPluginApi } from "@opencode-ai/plugin/tui";
import { goalActivityForSession } from "./progress.ts";

function GoalPanel(props: { api: TuiPluginApi }) {
  const dimensions = useTerminalDimensions();
  const snapshot = () => {
    const route = props.api.route.current;
    if (route.name !== "session" || !route.params?.sessionID) return;
    const id = String(route.params.sessionID);
    return goalActivityForSession(props.api.state.session.get(id));
  };
  // Reattachment can miss a child's earlier permission event in native state.
  // Hydrate through the read-only SDK and refresh on events, never poll/control.
  const [permissions, { refetch }] = createResource(() => {
    const value = snapshot();
    if (value) return `${props.api.route.current.params?.sessionID}:${value.evaluation?.childID ?? ""}`;
  }, async () => {
    try {
      const response = await props.api.client.permission.list({ directory: props.api.state.path.directory },
        { signal: AbortSignal.timeout(3000) });
      return response.data ?? [];
    } catch { return []; }
  });
  const refreshPermissions = (event: { properties: { sessionID: string } }) => {
    const value = snapshot();
    if (value && [String(props.api.route.current.params?.sessionID), value.evaluation?.childID].includes(event.properties.sessionID)) void refetch();
  };
  onCleanup(props.api.event.on("permission.asked", refreshPermissions));
  onCleanup(props.api.event.on("permission.replied", refreshPermissions));
  const clip = (text: string) => {
    const limit = Math.max(10, dimensions().width - 4);
    const characters = Array.from(text);
    return characters.length > limit ? characters.slice(0, limit - 3).join("") + "..." : text;
  };
  return <Show when={snapshot()}>{value => {
    const waiting = () => {
      const id = String(props.api.route.current.params?.sessionID);
      const evaluator = value().evaluation?.childID;
      if (props.api.state.session.permission(id).length || (evaluator && props.api.state.session.permission(evaluator).length)
        || permissions()?.some(request => request.sessionID === id || request.sessionID === evaluator)) {
        return "Waiting for user permission";
      }
      if (value().state === "evaluating") return `Waiting for independent ${value().evaluation?.mode ?? ""} evaluator`.replace(/\s+/g, " ");
      return value().reason;
    };
    return <box width="100%" flexShrink={0} flexDirection="column" paddingLeft={1} paddingRight={1}
      backgroundColor={props.api.theme.current.backgroundPanel}>
      <text height={1} wrapMode="none" fg={props.api.theme.current.primary}>
        {clip(`Goal worker | ${value().state} | ${value().agent}`)}
      </text>
      <Show when={waiting()}>{text => <text height={1} wrapMode="none" fg={props.api.theme.current.text}>{clip(text())}</text>}</Show>
      <Show when={value().feedback}>{text => <text height={1} wrapMode="none" fg={props.api.theme.current.textMuted}>{clip(`Feedback: ${text()}`)}</text>}</Show>
      <Show when={value().validation}>{text => <text height={1} wrapMode="none" fg={props.api.theme.current.textMuted}>{clip(`Final: ${text()}`)}</text>}</Show>
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
