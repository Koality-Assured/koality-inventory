import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import {
  api,
  readToken,
  saveToken,
  type FacilityTree,
  type Item,
  type LocationNode,
  type SessionUser,
  type Sku,
} from "./api";

type Tab = "catalog" | "locations";

export function App() {
  const [banner, setBanner] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(readToken());
  const [user, setUser] = useState<SessionUser | null>(null);
  const [tab, setTab] = useState<Tab>("catalog");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ banner: string | null }>("/api/v1/meta")
      .then((meta) => setBanner(meta.banner))
      .catch(() => setBanner(null));
  }, []);

  if (!token) {
    return (
      <Shell banner={banner}>
        <Login
          onSuccess={(next, signedIn) => {
            saveToken(next);
            setToken(next);
            setUser(signedIn);
            setError(null);
          }}
          onError={setError}
          error={error}
        />
      </Shell>
    );
  }

  return (
    <Shell banner={banner}>
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">
            {user ? `${user.displayName} · ${user.role}` : "Signed in"}
          </p>
          <h1 className="text-2xl font-semibold">Inventory</h1>
        </div>
        <button
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          onClick={() => {
            saveToken(null);
            setToken(null);
            setUser(null);
          }}
          type="button"
        >
          Sign out
        </button>
      </header>
      <nav className="mb-6 flex gap-2">
        <TabButton active={tab === "catalog"} onClick={() => setTab("catalog")}>
          Catalog
        </TabButton>
        <TabButton active={tab === "locations"} onClick={() => setTab("locations")}>
          Locations
        </TabButton>
      </nav>
      {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}
      {tab === "catalog" ? <Catalog onError={setError} /> : <Locations onError={setError} />}
    </Shell>
  );
}

function Shell({ banner, children }: { banner: string | null; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      {banner ? (
        <p className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {banner}
        </p>
      ) : null}
      {children}
    </main>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`rounded-md px-3 py-2 text-sm ${active ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function Login({
  onSuccess,
  onError,
  error,
}: {
  onSuccess: (token: string, user: SessionUser) => void;
  onError: (message: string) => void;
  error: string | null;
}) {
  const [email, setEmail] = useState("admin@koalityinventory.local");
  const [password, setPassword] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await api<{ accessToken: string; user: SessionUser }>(
        "/api/v1/auth/dev-login",
        {
          method: "POST",
          body: JSON.stringify({ email, password }),
        },
      );
      onSuccess(result.accessToken, result.user);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Login failed");
    }
  }

  return (
    <form
      className="mx-auto max-w-md rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200"
      onSubmit={submit}
    >
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="mt-2 text-sm text-slate-500">
        Local development accounts are seeded when dev auth is enabled. Admin email is
        admin@koalityinventory.local.
      </p>
      <label className="mt-4 block text-sm font-medium" htmlFor="email">
        Email
      </label>
      <input
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
        id="email"
        onChange={(event) => setEmail(event.target.value)}
        value={email}
      />
      <label className="mt-4 block text-sm font-medium" htmlFor="password">
        Password
      </label>
      <input
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
        id="password"
        onChange={(event) => setPassword(event.target.value)}
        type="password"
        value={password}
      />
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      <button className="mt-5 rounded-md bg-slate-900 px-4 py-2 text-sm text-white" type="submit">
        Continue
      </button>
    </form>
  );
}

function Catalog({ onError }: { onError: (message: string) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [skus, setSkus] = useState<Sku[]>([]);
  const [skuCode, setSkuCode] = useState("");

  async function refresh() {
    const result = await api<{ items: Item[] }>("/api/v1/items");
    setItems(result.items);
  }

  useEffect(() => {
    void refresh().catch((cause: unknown) =>
      onError(cause instanceof Error ? cause.message : "Could not load items"),
    );
  }, [onError]);

  async function loadSkus(itemId: string) {
    setSelected(itemId);
    const result = await api<{ skus: Sku[] }>(`/api/v1/items/${itemId}/skus`);
    setSkus(result.skus);
  }

  return (
    <section className="grid gap-6 md:grid-cols-2">
      <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="font-semibold">Item master</h2>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void api("/api/v1/items", { method: "POST", body: JSON.stringify({ name }) })
              .then(() => {
                setName("");
                return refresh();
              })
              .catch((cause: unknown) =>
                onError(cause instanceof Error ? cause.message : "Create failed"),
              );
          }}
        >
          <input
            className="flex-1 rounded-md border border-slate-300 px-3 py-2"
            onChange={(event) => setName(event.target.value)}
            placeholder="New item name"
            value={name}
          />
          <button className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white" type="submit">
            Add
          </button>
        </form>
        <ul className="mt-4 divide-y divide-slate-100">
          {items.map((item) => (
            <li key={item.id}>
              <button
                className="w-full py-3 text-left"
                onClick={() => void loadSkus(item.id)}
                type="button"
              >
                <span className="block font-medium">{item.name}</span>
                <span className="text-xs text-slate-500">
                  {item.id} · {item.tracking} · {item.costingMethod}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="font-semibold">SKU variants</h2>
        {selected ? (
          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void api(`/api/v1/items/${selected}/skus`, {
                method: "POST",
                body: JSON.stringify({ skuCode }),
              })
                .then(() => {
                  setSkuCode("");
                  return loadSkus(selected);
                })
                .catch((cause: unknown) =>
                  onError(cause instanceof Error ? cause.message : "SKU failed"),
                );
            }}
          >
            <input
              className="flex-1 rounded-md border border-slate-300 px-3 py-2"
              onChange={(event) => setSkuCode(event.target.value)}
              placeholder="SKU code"
              value={skuCode}
            />
            <button className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white" type="submit">
              Add SKU
            </button>
          </form>
        ) : (
          <p className="mt-3 text-sm text-slate-500">Select an item to see its SKUs.</p>
        )}
        <ul className="mt-4 space-y-2">
          {skus.map((sku) => (
            <li className="rounded-md bg-slate-50 px-3 py-2 text-sm" key={sku.id}>
              {sku.skuCode}
              {sku.barcode ? ` · ${sku.barcode}` : ""}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Locations({ onError }: { onError: (message: string) => void }) {
  const [tree, setTree] = useState<FacilityTree[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  async function refresh() {
    const result = await api<{ facilities: FacilityTree[] }>("/api/v1/locations/tree");
    setTree(result.facilities);
  }

  useEffect(() => {
    void refresh().catch((cause: unknown) =>
      onError(cause instanceof Error ? cause.message : "Could not load locations"),
    );
  }, [onError]);

  return (
    <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <h2 className="font-semibold">Warehouse topology</h2>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void api("/api/v1/locations/facilities", {
            method: "POST",
            body: JSON.stringify({ name, code }),
          })
            .then(() => {
              setName("");
              setCode("");
              return refresh();
            })
            .catch((cause: unknown) =>
              onError(cause instanceof Error ? cause.message : "Facility failed"),
            );
        }}
      >
        <input
          className="rounded-md border border-slate-300 px-3 py-2"
          onChange={(event) => setName(event.target.value)}
          placeholder="Facility name"
          value={name}
        />
        <input
          className="rounded-md border border-slate-300 px-3 py-2"
          onChange={(event) => setCode(event.target.value)}
          placeholder="Code"
          value={code}
        />
        <button className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white" type="submit">
          Add facility
        </button>
      </form>
      <div className="mt-6 space-y-6">
        {tree.map((facility) => (
          <article key={facility.id}>
            <h3 className="font-medium">
              {facility.name} <span className="text-slate-500">{facility.code}</span>
            </h3>
            <LocationList nodes={facility.locations} />
          </article>
        ))}
      </div>
    </section>
  );
}

function LocationList({ nodes }: { nodes: LocationNode[] }) {
  if (nodes.length === 0) {
    return (
      <p className="mt-2 text-sm text-slate-500">
        No zones yet. Create them from the API or a later editor.
      </p>
    );
  }
  return (
    <ul className="mt-2 space-y-2">
      {nodes.map((node) => (
        <li key={node.id}>
          <div className="text-sm">
            <span className="uppercase tracking-wide text-slate-400">{node.kind}</span> {node.name}{" "}
            ({node.code})
          </div>
          {node.kind === "shelf" ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {node.children.map((bin) => (
                <span className="rounded-md bg-slate-900 px-3 py-2 text-xs text-white" key={bin.id}>
                  {bin.code}
                </span>
              ))}
            </div>
          ) : (
            <div className="ml-4">
              <LocationList nodes={node.children} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
