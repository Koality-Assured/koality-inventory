import re

with open("apps/api/src/app.ts", "r", encoding="utf-8") as f:
    code = f.read()

# Imports
code = code.replace('import { zValidator } from "@hono/zod-validator";', 
'''import { zValidator } from "@hono/zod-validator";
import { cors } from "hono/cors";
import { requirePermissionGuard, rateLimit } from "./rbac.js";''')

# CORS and Rate limiting
setup_code = '''  const app = new Hono<{ Variables: Vars }>();

  app.use('*', cors({
    origin: (origin) => {
      const allowed = (process.env.CORS_ALLOWED_ORIGINS || "").split(",").filter(Boolean);
      if (allowed.includes(origin) || process.env.NODE_ENV !== "production") return origin;
      return null;
    }
  }));

  app.use('/api/v1/auth/dev-login', rateLimit(5, 60000));
  app.use('/api/*', rateLimit(1000, 60000));
'''
code = code.replace('  const app = new Hono<{ Variables: Vars }>();', setup_code)

# Fix authenticate
code = code.replace('return c.json({ error: "Unauthorized" }, 401);', 'throw new HttpError(401, "Unauthorized");')
code = code.replace('): Promise<{ userId: string; orgId: string; role: string; sessionId: string } | Response> {', 
                    '): Promise<{ userId: string; orgId: string; role: string; sessionId: string }> {')

# Route permission mapping
route_perms = {
    'app.post("/api/v1/auth/logout"': None,
    'app.get("/api/v1/items"': 'items:read',
    'app.post("/api/v1/items"': 'items:write',
    'app.get("/api/v1/items/:id"': 'items:read',
    'app.get("/api/v1/items/:id/skus"': 'items:read',
    'app.post("/api/v1/items/:id/skus"': 'items:write',
    'app.get("/api/v1/locations/facilities"': 'locations:read',
    'app.post("/api/v1/locations/facilities"': 'locations:write',
    'app.get("/api/v1/locations/tree"': 'locations:read',
    'app.post("/api/v1/locations"': 'locations:write',
    'app.get("/api/v1/stock/balances"': 'stock:read',
    'app.get("/api/v1/stock/valuation"': 'stock:read',
    'app.post("/api/v1/stock/receipts"': 'stock:write',
    'app.post("/api/v1/stock/adjustments"': 'stock:write',
    'app.post("/api/v1/stock/transfers"': 'stock:write',
    'app.get("/api/v1/procurement/reorder-recommendations"': 'procurement:read',
    'app.post("/api/v1/procurement/vendors"': 'procurement:write',
    'app.post("/api/v1/procurement/purchase-orders"': 'procurement:write',
    'app.post("/api/v1/procurement/purchase-orders/:id/approve"': 'procurement:write',
    'app.post("/api/v1/procurement/receipts"': 'procurement:write',
    'app.post("/api/v1/cycle-counts"': 'cycle:write',
    'app.get("/api/v1/cycle-counts/:id"': 'cycle:read',
    'app.post("/api/v1/cycle-counts/record"': 'cycle:write',
    'app.get("/api/v1/cycle-counts/:id/variance"': 'cycle:read',
    'app.post("/api/v1/cycle-counts/:id/reconcile"': 'cycle:write',
    'app.post("/api/v1/fulfillment/orders"': 'fulfillment:write',
    'app.post("/api/v1/fulfillment/orders/:id/allocate"': 'fulfillment:write',
    'app.post("/api/v1/fulfillment/orders/:id/ship"': 'fulfillment:write',
    'app.put("/api/v1/stock/transfers/:id/receive"': 'stock:write',
    'app.post("/api/v1/locations/bins"': 'locations:write',
}

# We will regex split the code into blocks based on route definitions and replace within those blocks
for route, perm in route_perms.items():
    # Find the index of the route
    idx = code.find(route)
    if idx == -1:
        continue
    # find the next authenticate block after idx
    auth_idx = code.find('const auth = await authenticate(c, deps);', idx)
    if auth_idx != -1:
        # find the end of the if block
        end_idx = code.find('    }', auth_idx) + 5
        # The block looks like:
        # const auth = await authenticate(c, deps);
        # if (auth instanceof Response) {
        #   return auth;
        # }
        # or it could be indented by 6 spaces (if inside zValidator async (c) => )
        block_to_replace = code[auth_idx:code.find('return auth;', auth_idx) + 12]
        # Instead, let's use a regex to replace the first occurrence of authenticate+if after the route definition
        pattern = r'(const auth = await authenticate\(c, deps\);[\s\n]*if \(auth instanceof Response\) {[\s\n]*return auth;[\s\n]*})'
        
        match = re.search(pattern, code[idx:])
        if match:
            original_match = match.group(1)
            if perm:
                replacement = f'const auth = await authenticate(c, deps);\n    requirePermissionGuard(auth.role, "{perm}");'
                # fix indentation
                if "      " in original_match:
                    replacement = f'const auth = await authenticate(c, deps);\n      requirePermissionGuard(auth.role, "{perm}");'
            else:
                replacement = f'const auth = await authenticate(c, deps);'
            
            code = code[:idx] + code[idx:].replace(original_match, replacement, 1)

# Fix openApiDocument
openapi_orig = """function openApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "koality-inventory",
      version: "0.1.0",
    },
    paths: {
      "/api/v1/auth/dev-login": { post: { summary: "Local dev login" } },
      "/api/v1/items": { get: { summary: "List items" }, post: { summary: "Create item" } },
      "/api/v1/items/{id}/skus": {
        get: { summary: "List SKUs" },
        post: { summary: "Create SKU" },
      },
      "/api/v1/locations/facilities": {
        get: { summary: "List facilities" },
        post: { summary: "Create facility" },
      },
      "/api/v1/locations/tree": { get: { summary: "Location tree" } },
      "/api/v1/locations": { post: { summary: "Create location node" } },
      "/api/v1/locations/bins": { post: { summary: "Create bin" } },
    },
  };
}"""

openapi_new = """function openApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "koality-inventory",
      version: "0.1.0",
    },
    paths: {
      "/api/v1/auth/dev-login": { post: { summary: "Local dev login" } },
      "/api/v1/auth/logout": { post: { summary: "Logout" } },
      "/api/v1/items": { get: { summary: "List items" }, post: { summary: "Create item", security: [{ bearerAuth: [] }] } },
      "/api/v1/items/{id}": { get: { summary: "Get item" } },
      "/api/v1/items/{id}/skus": { get: { summary: "List SKUs" }, post: { summary: "Create SKU", security: [{ bearerAuth: [] }] } },
      "/api/v1/locations/facilities": { get: { summary: "List facilities" }, post: { summary: "Create facility", security: [{ bearerAuth: [] }] } },
      "/api/v1/locations/tree": { get: { summary: "Location tree" } },
      "/api/v1/locations": { post: { summary: "Create location node", security: [{ bearerAuth: [] }] } },
      "/api/v1/locations/bins": { post: { summary: "Create bin", security: [{ bearerAuth: [] }] } },
      "/api/v1/stock/balances": { get: { summary: "Stock balances" } },
      "/api/v1/stock/valuation": { get: { summary: "Stock valuation" } },
      "/api/v1/stock/receipts": { post: { summary: "Receive stock", security: [{ bearerAuth: [] }] } },
      "/api/v1/stock/adjustments": { post: { summary: "Adjust stock", security: [{ bearerAuth: [] }] } },
      "/api/v1/stock/transfers": { post: { summary: "Transfer stock", security: [{ bearerAuth: [] }] } },
      "/api/v1/stock/transfers/{id}/receive": { put: { summary: "Receive transfer", security: [{ bearerAuth: [] }] } },
      "/api/v1/procurement/reorder-recommendations": { get: { summary: "Reorder recommendations" } },
      "/api/v1/procurement/vendors": { post: { summary: "Create vendor", security: [{ bearerAuth: [] }] } },
      "/api/v1/procurement/purchase-orders": { post: { summary: "Create PO", security: [{ bearerAuth: [] }] } },
      "/api/v1/procurement/purchase-orders/{id}/approve": { post: { summary: "Approve PO", security: [{ bearerAuth: [] }] } },
      "/api/v1/procurement/receipts": { post: { summary: "Receive PO", security: [{ bearerAuth: [] }] } },
      "/api/v1/cycle-counts": { post: { summary: "Start cycle count", security: [{ bearerAuth: [] }] } },
      "/api/v1/cycle-counts/{id}": { get: { summary: "Cycle count sheet" } },
      "/api/v1/cycle-counts/record": { post: { summary: "Record count", security: [{ bearerAuth: [] }] } },
      "/api/v1/cycle-counts/{id}/variance": { get: { summary: "Variance report" } },
      "/api/v1/cycle-counts/{id}/reconcile": { post: { summary: "Reconcile count", security: [{ bearerAuth: [] }] } },
      "/api/v1/fulfillment/orders": { post: { summary: "Create SO", security: [{ bearerAuth: [] }] } },
      "/api/v1/fulfillment/orders/{id}/allocate": { post: { summary: "Allocate SO", security: [{ bearerAuth: [] }] } },
      "/api/v1/fulfillment/orders/{id}/ship": { post: { summary: "Ship SO", security: [{ bearerAuth: [] }] } },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  };
}"""

code = code.replace(openapi_orig, openapi_new)

with open("apps/api/src/app.ts", "w", encoding="utf-8") as f:
    f.write(code)
print("Done rewriting app.ts")
