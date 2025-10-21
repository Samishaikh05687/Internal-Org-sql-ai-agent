/**
 * Represents a pending SQL preview entry.
 * Used to store preview metadata before execution.
 */
export type PreviewEntry = {
    /** The SQL query to be executed */
    query: string;
    /** Optional user ID for audit logging */
    userId?: string;
    /** Optional user role for RBAC */
    userRole?: string;
    /** Timestamp when preview was created */
    createdAt: number;
};