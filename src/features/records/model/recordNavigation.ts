export type DashboardRecordView = 'discipline' | 'points' | 'feedback' | 'boss';
/** An explicit UI navigation request, never a persisted record or mutation. */
export type RecordViewRequest = { id: number; view: DashboardRecordView };
