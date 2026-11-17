export type Status = 'pending' | 'up' | 'down';

/** Editable fields, as sent by the dashboard form. */
export interface MonitorInput {
  name: string;
  url: string;
  method: 'GET' | 'HEAD';
  interval_min: number;
  timeout_sec: number;
  expected_status: string;
  keyword: string | null;
  active_from: string | null;
  active_to: string | null;
  fail_threshold: number;
  enabled: 0 | 1;
  notify_every: 0 | 1;
}

export interface Monitor extends MonitorInput {
  id: number;
  status: Status;
  since: number | null;
  fails: number;
  last_checked_at: number | null;
  last_ms: number | null;
  last_code: number | null;
  last_error: string | null;
  next_check_at: number;
  created_at: number;
}

export interface StatRow { monitor_id: number; hour: number; n: number; up: number; sum_ms: number; max_ms: number }
export interface Incident { id: number; monitor_id: number; started_at: number; resolved_at: number | null; cause: string | null }

export const HOUR = 3_600_000;
