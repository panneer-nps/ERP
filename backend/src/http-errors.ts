export type PublicDatabaseError = {
  status: number;
  code: string;
  message: string;
};

export function publicDatabaseError(sqlState: unknown): PublicDatabaseError | null {
  if (typeof sqlState !== "string") return null;
  if (sqlState === "23505") {
    return { status: 409, code: "DUPLICATE_VALUE", message: "That value is already in use. Check the email address and try again." };
  }
  if (["42P01", "42703", "42883"].includes(sqlState)) {
    return { status: 503, code: "MIGRATIONS_REQUIRED", message: "The database schema is behind this application. Run the database migrations, then retry." };
  }
  if (["23503", "23514"].includes(sqlState)) {
    return { status: 409, code: "DATA_CONFLICT", message: "The request conflicts with existing database records. Refresh the page and retry." };
  }
  if (["28P01", "3D000"].includes(sqlState)) {
    return { status: 503, code: "DATABASE_CONFIGURATION", message: "PostgreSQL rejected the configured database name or login. Ask the ERP administrator to verify backend/.env and restart the API; do not share the database password." };
  }
  if (["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT"].includes(sqlState)) {
    return { status: 503, code: "SERVICE_UNAVAILABLE", message: "The database service is unavailable. Start PostgreSQL and retry." };
  }
  return null;
}

export function internalErrorResponse(requestId: string) {
  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "The server could not complete this request. Check the API log using the reference ID.",
        requestId,
      },
    },
  } as const;
}
