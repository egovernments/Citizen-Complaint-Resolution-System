/** IANA zones this project has ever deployed to. A short fixed list — simpler and safer than
 *  enumerating the full tz database, and covers every real deployment target so far. */
export const DASHBOARD_TIME_ZONES = [
  'Africa/Nairobi',
  'Africa/Maputo',
  'Asia/Kolkata',
  'UTC',
] as const;
