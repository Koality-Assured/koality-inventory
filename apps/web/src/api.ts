const TOKEN_KEY = "koality-inventory-token";

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

export function saveToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
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
    throw new Error(payload.error ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}
