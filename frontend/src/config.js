const configuredApiUrl = process.env.REACT_APP_API_URL?.trim();
const isProduction = process.env.NODE_ENV === "production";

if (isProduction && !configuredApiUrl) {
  throw new Error("REACT_APP_API_URL is required for production builds.");
}

export const API_BASE = configuredApiUrl || "http://localhost:5000";

