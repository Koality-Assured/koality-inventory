export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const TOKEN_KEY = "koality-inventory-token";
const USER_KEY = "koality-inventory-user";

export interface SessionUser {
  id: string;
  email: string;
  role: string;
  displayName: string;
  orgId: string;
}

export interface Item {
  id: string;
  name: string;
  category: string;
  baseUom: string;
  tracking: string;
  costingMethod: string;
}

export interface Sku {
  id: string;
  skuCode: string;
  barcode: string | null;
  attributes: Record<string, string>;
}

export interface LocationNode {
  id: string;
  kind: string;
  name: string;
  code: string;
  children: LocationNode[];
}

export interface FacilityTree {
  id: string;
  name: string;
  code: string;
  locations: LocationNode[];
}

export function readToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function readUser(): SessionUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

export function saveSession(token: string | null, user: SessionUser | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(USER_KEY);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = readToken();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(payload.error ?? `Request failed (${response.status})`, response.status);
  }
  return (await response.json()) as T;
}
