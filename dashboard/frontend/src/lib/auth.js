// Thin client for the dashboard backend's JWT auth (security/auth.py).
// Token/role live in sessionStorage -- cleared when the tab closes, so a
// shared demo machine doesn't leave a signed-in session behind.

const TOKEN_KEY = "rakshasetu.token";
const ROLE_KEY = "rakshasetu.role";
const USERNAME_KEY = "rakshasetu.username";

const DEFAULT_HOST = typeof window !== "undefined" ? window.location.hostname : "localhost";
export const API_BASE = import.meta.env.VITE_API_BASE || `http://${DEFAULT_HOST}:8000`;

function storage() {
  // sessionStorage can throw (private browsing, blocked site data); callers
  // treat a null return the same as "not logged in" rather than crashing.
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function getToken() {
  return storage()?.getItem(TOKEN_KEY) ?? null;
}

export function getRole() {
  return storage()?.getItem(ROLE_KEY) ?? null;
}

export function getUsername() {
  return storage()?.getItem(USERNAME_KEY) ?? null;
}

export function isAuthenticated() {
  return Boolean(getToken());
}

export function hasRole(role) {
  return getRole() === role;
}

export async function login(username, password) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    let detail = "Login failed";
    try {
      detail = (await res.json()).detail || detail;
    } catch {
      // response wasn't JSON -- keep the generic message
    }
    throw new Error(detail);
  }
  const data = await res.json();
  const s = storage();
  s?.setItem(TOKEN_KEY, data.access_token);
  s?.setItem(ROLE_KEY, data.role);
  s?.setItem(USERNAME_KEY, data.username);
  return data;
}

export function logout() {
  const s = storage();
  s?.removeItem(TOKEN_KEY);
  s?.removeItem(ROLE_KEY);
  s?.removeItem(USERNAME_KEY);
}

export function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
