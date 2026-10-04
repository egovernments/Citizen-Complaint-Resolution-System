import { request } from "../organizations/organization-service.js";
export type EventStream = "user" | "admin";
export interface KeycloakEvent {
  id: string; time: number;
  type?: string; userId?: string; clientId?: string; sessionId?: string; error?: string;
  operationType?: string; resourceType?: string; resourcePath?: string;
  representation?: string; details?: Record<string, string>;
}
export interface EventSource {
  retentionMs(): Promise<number>;
  page(stream: EventStream, from: number, to: number, first: number, max: number): Promise<KeycloakEvent[]>;
}
export const keycloakEventSource: EventSource = {
  async retentionMs() {
    const response = await request("/events/config");
    const settings = await response.json() as { eventsEnabled?: boolean; adminEventsEnabled?: boolean; adminEventsDetailsEnabled?: boolean; eventsExpiration?: number };
    if (!settings.eventsEnabled || !settings.adminEventsEnabled || !settings.adminEventsDetailsEnabled)
      throw new Error("Keycloak user/admin event storage and admin event details must be enabled");
    return settings.eventsExpiration && settings.eventsExpiration > 0 ? settings.eventsExpiration * 1000 : Infinity;
  },
  async page(stream, from, to, first, max) {
    // Query both streams without enum filters, so unknown Keycloak enums cannot cause HTTP 500.
    const query = new URLSearchParams({ dateFrom: String(from), dateTo: String(to), direction: "asc", first: String(first), max: String(max) });
    const response = await request(`/${stream === "user" ? "events" : "admin-events"}?${query}`);
    const events = await response.json() as KeycloakEvent[];
    if (!Array.isArray(events) || events.some(event => !event.id || !Number.isFinite(event.time)))
      throw new Error("Keycloak returned invalid event records");
    return events;
  },
};
