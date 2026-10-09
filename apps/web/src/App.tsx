import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

import {
  ApiError,
  api,
  readToken,
  readUser,
  saveSession,
  type FacilityTree,
  type Item,
  type LocationNode,
  type SessionUser,
  type Sku,
} from "./api";

type Tab = "catalog" | "locations";
const LOCATION_KINDS = ["zone", "aisle", "rack", "shelf", "bin"] as const;

export function App() {
  const [banner, setBanner] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(readToken());
  const [user, setUser] = useState<SessionUser | null>(readUser());
  const [tab, setTab] = useState<Tab>("catalog");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ banner: string | null }>("/api/v1/meta")
      .then((meta) => setBanner(meta.banner))
      .catch(() => setBanner(null));
  }, []);

  function report(cause: unknown) {
    if (cause instanceof ApiError && cause.status === 401) {
      saveSession(null, null);
      setToken(null);
      setUser(null);
      setError(null);
      return;
    }
    setError(cause instanceof Error ? cause.message : "Request failed");
  }

  function signIn(next: string, signedIn: SessionUser) {
    saveSession(next, signedIn);
    setToken(next);
    setUser(signedIn);
    setError(null);
  }

  if (!token) {
    return <Login banner={banner} onError={report} error={error} onSuccess={signIn} />;
  }

  return (
    <div className="app-frame">
      <aside className="rail">
        <Brand />
        <nav aria-label="Primary" className="grid gap-1">
          <NavButton current={tab === "catalog"} onClick={() => setTab("catalog")}>
            Catalog
          </NavButton>
          <NavButton current={tab === "locations"} onClick={() => setTab("locations")}>
            Warehouse
          </NavButton>
        </nav>
        <div className="mt-auto grid gap-3">
          <p className="text-sm text-[#d9d3c7]">
            <span className="block font-medium text-white">{user?.displayName ?? "Signed in"}</span>
            {user ? formatRole(user.role) : "Local session"}
          </p>
          <button
            className="btn btn-quiet"
            onClick={() => {
              saveSession(null, null);
              setToken(null);
              setUser(null);
              setError(null);
            }}
            type="button"
          >
            Sign out
          </button>
        </div>
      </aside>
      <div className="workspace">
        {banner ? (
          <p className="mb-4 rounded-xl border border-[#efd3b4] bg-copper-soft px-4 py-3 text-sm text-copper">
            {banner}
          </p>
        ) : null}
        {error ? (
          <p
            className="mb-4 rounded-xl border border-[#f0c9c4] bg-[#fff5f3] px-4 py-3 text-sm text-[#8a2a22]"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <header className="mb-5">
          <p className="text-sm font-medium text-muted">Local standalone</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {tab === "catalog" ? "Item catalog" : "Warehouse map"}
          </h1>
        </header>
        <main>
          {tab === "catalog" ? <Catalog onError={report} /> : <Locations onError={report} />}
        </main>
      </div>
    </div>
  );
}

function Brand({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const light = tone === "light";
  return (
    <div className="flex items-center gap-3">
      <img alt="" className="h-10 w-10" src="/mark.svg" />
      <div>
        <p className={`text-sm font-semibold tracking-tight ${light ? "text-ink" : "text-white"}`}>
          Koality Inventory
        </p>
        <p className={`text-xs ${light ? "text-muted" : "text-[#d9d3c7]"}`}>Stock floor</p>
      </div>
    </div>
  );
}

function NavButton({
  children,
  current,
  onClick,
}: {
  children: string;
  current: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-current={current ? "page" : undefined}
      className="nav-link"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function Login({
  banner,
  error,
  onError,
  onSuccess,
}: {
  banner: string | null;
  error: string | null;
  onError: (message: string) => void;
  onSuccess: (token: string, user: SessionUser) => void;
}) {
  const [email, setEmail] = useState("admin@koalityinventory.local");
  const [password, setPassword] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await api<{ accessToken: string; user: SessionUser }>(
        "/api/v1/auth/dev-login",
        { method: "POST", body: JSON.stringify({ email, password }) },
      );
      onSuccess(result.accessToken, result.user);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Login failed");
    }
  }

  return (
    <div className="grid min-h-screen md:grid-cols-[minmax(0,1.1fr)_minmax(22rem,0.9fr)]">
      <section className="hidden flex-col justify-between bg-pine-deep p-10 text-[#f6f3ec] md:flex">
        <Brand />
        <div>
          <h1 className="max-w-md text-4xl font-semibold tracking-tight">
            Know what is on the shelf before you walk the aisle.
          </h1>
          <p className="mt-4 max-w-md text-[#d9d3c7]">
            Catalog, bins, and stock stay on this workstation when you run the local database.
          </p>
        </div>
        <p className="text-sm text-[#d9d3c7]">Items, SKUs, and warehouse locations</p>
      </section>
      <main className="flex items-center justify-center px-4 py-10">
        <form className="panel w-full max-w-md p-6" onSubmit={submit}>
          <div className="mb-5 md:hidden">
            <Brand tone="light" />
          </div>
          <h1 className="text-2xl font-semibold">Sign in</h1>
          <p className="mt-2 text-sm text-muted">
            Use the seeded local admin account when development authentication is on.
          </p>
          {banner ? (
            <p className="mt-4 rounded-xl border border-[#efd3b4] bg-copper-soft px-3 py-2 text-sm text-copper">
              {banner}
            </p>
          ) : null}
          <div className="mt-5 grid gap-4">
            <label className="field" htmlFor="email">
              Email
              <input
                autoComplete="username"
                className="control"
                id="email"
                onChange={(event) => setEmail(event.target.value)}
                value={email}
              />
            </label>
            <label className="field" htmlFor="password">
              Password
              <input
                autoComplete="current-password"
                className="control"
                id="password"
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
            </label>
          </div>
          {error ? (
            <p className="mt-3 text-sm text-[#8a2a22]" role="alert">
              {error}
            </p>
          ) : null}
          <button className="btn btn-primary mt-5 w-full" type="submit">
            Continue
          </button>
        </form>
      </main>
    </div>
  );
}

function Catalog({ onError }: { onError: (cause: unknown) => void }) {
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
    void refresh().catch((cause: unknown) => onError(cause));
  }, [onError]);

  async function loadSkus(itemId: string) {
    setSelected(itemId);
    const result = await api<{ skus: Sku[] }>(`/api/v1/items/${itemId}/skus`);
    setSkus(result.skus);
  }

  const selectedItem = items.find((item) => item.id === selected);

  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
      <div className="panel p-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Items</h2>
            <p className="text-sm text-muted">{items.length} in the local catalog</p>
          </div>
        </div>
        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void api("/api/v1/items", { method: "POST", body: JSON.stringify({ name }) })
              .then(() => {
                setName("");
                return refresh();
              })
              .catch((cause: unknown) => onError(cause));
          }}
        >
          <label className="field flex-1">
            New item
            <input
              className="control"
              onChange={(event) => setName(event.target.value)}
              placeholder="Name"
              value={name}
            />
          </label>
          <button className="btn btn-primary sm:self-end" type="submit">
            Add item
          </button>
        </form>
        {items.length === 0 ? (
          <p className="mt-6 rounded-xl bg-moss px-4 py-6 text-sm text-pine-deep">
            The catalog is empty. Add a parent item, then give it sellable SKUs.
          </p>
        ) : (
          <ul className="mt-4 grid gap-2">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  aria-pressed={item.id === selected}
                  className={`w-full rounded-xl border px-3 py-3 text-left ${
                    item.id === selected
                      ? "border-pine bg-moss"
                      : "border-line bg-white hover:border-[#c9bfb0]"
                  }`}
                  onClick={() => void loadSkus(item.id)}
                  type="button"
                >
                  <span className="block font-medium">{item.name}</span>
                  <span className="mt-1 flex flex-wrap gap-2 text-xs text-muted">
                    <Chip>{item.tracking}</Chip>
                    <Chip>{item.costingMethod}</Chip>
                    <span className="font-mono">{item.id}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="panel p-5">
        <h2 className="text-lg font-semibold">SKU variants</h2>
        <p className="text-sm text-muted">
          {selectedItem ? selectedItem.name : "Select an item to see its variants."}
        </p>
        {selected ? (
          <form
            className="mt-4 flex flex-col gap-2 sm:flex-row"
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
                .catch((cause: unknown) => onError(cause));
            }}
          >
            <label className="field flex-1">
              SKU code
              <input
                className="control font-mono"
                onChange={(event) => setSkuCode(event.target.value)}
                value={skuCode}
              />
            </label>
            <button className="btn btn-primary sm:self-end" type="submit">
              Add SKU
            </button>
          </form>
        ) : null}
        <ul className="mt-4 grid gap-2">
          {skus.map((sku) => (
            <li className="rounded-xl border border-line bg-white px-3 py-3" key={sku.id}>
              <p className="font-mono text-sm font-medium">{sku.skuCode}</p>
              <p className="text-xs text-muted">{sku.barcode ?? "No barcode"}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Locations({ onError }: { onError: (cause: unknown) => void }) {
  const [tree, setTree] = useState<FacilityTree[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [facilityId, setFacilityId] = useState("");
  const [parentId, setParentId] = useState("");
  const [kind, setKind] = useState<(typeof LOCATION_KINDS)[number]>("zone");
  const [nodeName, setNodeName] = useState("");
  const [nodeCode, setNodeCode] = useState("");

  async function refresh() {
    const result = await api<{ facilities: FacilityTree[] }>("/api/v1/locations/tree");
    setTree(result.facilities);
    setFacilityId((current) => current || result.facilities[0]?.id || "");
  }

  useEffect(() => {
    void refresh().catch((cause: unknown) => onError(cause));
  }, [onError]);

  const facility = tree.find((entry) => entry.id === facilityId);
  const parents = useMemo(() => flatten(facility?.locations ?? []), [facility]);

  return (
    <div className="grid gap-4">
      <section className="panel p-5">
        <h2 className="text-lg font-semibold">Facilities</h2>
        <form
          className="mt-4 grid gap-3 md:grid-cols-[1fr_10rem_auto] md:items-end"
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
              .catch((cause: unknown) => onError(cause));
          }}
        >
          <label className="field">
            Facility name
            <input
              className="control"
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </label>
          <label className="field">
            Code
            <input
              className="control font-mono uppercase"
              onChange={(event) => setCode(event.target.value)}
              value={code}
            />
          </label>
          <button className="btn btn-primary" type="submit">
            Add facility
          </button>
        </form>
      </section>

      {tree.length === 0 ? (
        <p className="panel px-5 py-8 text-sm text-muted">
          No facilities yet. Add a warehouse, then place zones, aisles, racks, shelves, and bins.
        </p>
      ) : (
        tree.map((entry) => (
          <article className="panel overflow-hidden" key={entry.id}>
            <header className="flex items-center justify-between gap-3 border-b border-line bg-moss px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">{entry.name}</h2>
                <p className="font-mono text-xs text-muted">{entry.code}</p>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-pine-deep">
                {countBins(entry.locations)} bins
              </span>
            </header>
            <div className="p-5">
              {entry.locations.length === 0 ? (
                <FloorEmpty />
              ) : (
                <LocationList nodes={entry.locations} />
              )}
            </div>
          </article>
        ))
      )}

      <section className="panel p-5">
        <h2 className="text-lg font-semibold">Place a location</h2>
        <form
          className="mt-4 grid gap-3 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void api("/api/v1/locations", {
              method: "POST",
              body: JSON.stringify({
                facilityId,
                parentId: kind === "zone" ? null : parentId,
                kind,
                name: nodeName,
                code: nodeCode,
              }),
            })
              .then(() => {
                setNodeName("");
                setNodeCode("");
                return refresh();
              })
              .catch((cause: unknown) => onError(cause));
          }}
        >
          <label className="field">
            Facility
            <select
              className="control"
              onChange={(event) => {
                setFacilityId(event.target.value);
                setParentId("");
              }}
              value={facilityId}
            >
              {tree.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Kind
            <select
              className="control"
              onChange={(event) => setKind(event.target.value as (typeof LOCATION_KINDS)[number])}
              value={kind}
            >
              {LOCATION_KINDS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          {kind === "zone" ? null : (
            <label className="field md:col-span-2">
              Parent
              <select
                className="control"
                onChange={(event) => setParentId(event.target.value)}
                value={parentId}
              >
                <option value="">Select a parent</option>
                {parents.map((parent) => (
                  <option key={parent.id} value={parent.id}>
                    {parent.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            Name
            <input
              className="control"
              onChange={(event) => setNodeName(event.target.value)}
              value={nodeName}
            />
          </label>
          <label className="field">
            Code
            <input
              className="control font-mono uppercase"
              onChange={(event) => setNodeCode(event.target.value)}
              value={nodeCode}
            />
          </label>
          <button className="btn btn-primary md:col-span-2 md:justify-self-start" type="submit">
            Add {kind}
          </button>
        </form>
      </section>
    </div>
  );
}

function FloorEmpty() {
  return (
    <div>
      <p className="text-sm text-muted">This facility has no zones yet.</p>
      <div aria-hidden="true" className="mt-4 grid max-w-md grid-cols-6 gap-2">
        {Array.from({ length: 12 }, (_, index) => (
          <span
            className="h-10 rounded-md border border-dashed border-[#cfc6b8] bg-white"
            key={index}
          />
        ))}
      </div>
    </div>
  );
}

function LocationList({ nodes }: { nodes: LocationNode[] }) {
  return (
    <ul className="grid gap-3">
      {nodes.map((node) => (
        <li key={node.id}>
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="rounded-full bg-foam px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted">
              {node.kind}
            </span>
            <span className="font-medium">{node.name}</span>
            <span className="font-mono text-xs text-muted">{node.code}</span>
          </div>
          {node.kind === "shelf" ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {node.children.map((bin) => (
                <span
                  className="inline-flex min-h-11 min-w-16 items-center justify-center rounded-lg bg-pine px-3 text-sm font-medium text-white"
                  key={bin.id}
                >
                  {bin.code}
                </span>
              ))}
            </div>
          ) : node.children.length > 0 ? (
            <div className="mt-3 border-l border-line pl-4">
              <LocationList nodes={node.children} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-foam px-2 py-0.5">{children}</span>;
}

function formatRole(role: string): string {
  return role.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function flatten(nodes: LocationNode[], depth = 0): Array<{ id: string; label: string }> {
  return nodes.flatMap((node) => [
    { id: node.id, label: `${"  ".repeat(depth)}${node.kind} ${node.code}` },
    ...flatten(node.children, depth + 1),
  ]);
}

function countBins(nodes: LocationNode[]): number {
  return nodes.reduce(
    (sum, node) => sum + (node.kind === "bin" ? 1 : 0) + countBins(node.children),
    0,
  );
}
