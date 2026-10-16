// ours#770: what the citizen complaint timeline should show for its workflow query.
//   "loading" - the first fetch is in flight (render nothing yet, as before);
//   "failed"  - the query ended without data and nothing is in flight: it errored, or a cancelled first fetch
//               reverted it to idle (react-query 3 keeps no data then, and retry is off app-wide);
//   "ready"   - there is data (a background refetch keeps showing it).
export function timelineState(q) {
  if (!q) return "loading";
  if (q.data) return "ready";
  if (q.isLoading || q.isFetching) return "loading";
  if (q.isError || q.isIdle) return "failed";
  return "ready";
}

export default timelineState;
