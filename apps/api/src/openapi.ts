import { ROUTE_POLICIES } from "./rbac.js";

type Schema = Record<string, unknown>;

const str = (extra: Schema = {}): Schema => ({ type: "string", ...extra });
const int = (extra: Schema = {}): Schema => ({ type: "integer", ...extra });
const obj = (properties: Record<string, Schema>, required: string[]): Schema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const CODE = str({ minLength: 1, maxLength: 40, pattern: "^[A-Za-z0-9_-]+$" });
const ID = str({ minLength: 1 });
const QTY = int({ minimum: 1 });

const SCHEMAS: Record<string, Schema> = {
  Error: obj({ error: str() }, ["error"]),
  LoginRequest: obj({ email: str({ format: "email" }), password: str({ minLength: 1 }) }, [
    "email",
    "password",
  ]),
  ItemInput: obj(
    {
      name: str({ minLength: 1, maxLength: 200 }),
      description: str({ maxLength: 4000 }),
      category: str({ maxLength: 120 }),
      baseUom: str({ minLength: 1, maxLength: 16 }),
      tracking: str({ enum: ["none", "lot", "serial"] }),
      costingMethod: str({ enum: ["fifo", "wac"] }),
    },
    ["name"],
  ),
  SkuInput: obj(
    {
      skuCode: str({ minLength: 1, maxLength: 64 }),
      barcode: { type: ["string", "null"], minLength: 1, maxLength: 64 },
      attributes: { type: "object", additionalProperties: str() },
    },
    ["skuCode"],
  ),
  FacilityInput: obj({ name: str({ minLength: 1, maxLength: 200 }), code: CODE }, ["name", "code"]),
  LocationInput: obj(
    {
      facilityId: ID,
      parentId: { type: ["string", "null"], minLength: 1 },
      kind: str({ enum: ["zone", "aisle", "rack", "shelf", "bin"] }),
      name: str({ minLength: 1, maxLength: 200 }),
      code: CODE,
    },
    ["facilityId", "kind", "name", "code"],
  ),
  StockReceiptInput: obj(
    {
      skuId: ID,
      locationId: ID,
      quantity: QTY,
      unitCostCents: int({ minimum: 0 }),
      lotCode: str({ minLength: 1 }),
      expiresOn: { type: ["string", "null"] },
      serialCodes: { type: "array", items: str({ minLength: 1 }) },
    },
    ["skuId", "locationId", "quantity", "unitCostCents"],
  ),
  StockAdjustmentInput: obj(
    {
      skuId: ID,
      locationId: ID,
      quantityDelta: int({ not: { const: 0 } }),
      unitCostCents: int({ minimum: 0 }),
      reason: str({ minLength: 1, maxLength: 500 }),
    },
    ["skuId", "locationId", "quantityDelta", "reason"],
  ),
  StockTransferInput: obj({ skuId: ID, fromLocationId: ID, toLocationId: ID, quantity: QTY }, [
    "skuId",
    "fromLocationId",
    "toLocationId",
    "quantity",
  ]),
  VendorInput: obj({ name: str({ minLength: 1 }) }, ["name"]),
  PurchaseOrderInput: obj(
    {
      vendorId: ID,
      lines: {
        type: "array",
        items: obj(
          { skuId: ID, locationId: ID, quantity: QTY, unitCostCents: int({ minimum: 0 }) },
          ["skuId", "locationId", "quantity", "unitCostCents"],
        ),
      },
    },
    ["vendorId", "lines"],
  ),
  PurchaseOrderReceiptInput: obj({ poId: ID, lineId: ID, quantity: QTY }, [
    "poId",
    "lineId",
    "quantity",
  ]),
  CycleCountInput: obj({ locationId: ID, skuIds: { type: "array", minItems: 1, items: ID } }, [
    "locationId",
    "skuIds",
  ]),
  CountRecordInput: obj({ cycleId: ID, lineId: ID, countedQty: int({ minimum: 0 }) }, [
    "cycleId",
    "lineId",
    "countedQty",
  ]),
  SalesOrderInput: obj({ skuId: ID, locationId: ID, quantity: QTY }, [
    "skuId",
    "locationId",
    "quantity",
  ]),
};

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

/** Builds the OpenAPI document from the same policy map that enforces authorization. */
export function openApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [key, policy] of Object.entries(ROUTE_POLICIES)) {
    const [method, honoPath] = key.split(" ") as [string, string];
    const params = [...honoPath.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => ({
      name: m[1]!,
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    const isPublic = policy.access === "public";
    const responses: Record<string, unknown> = {
      [String(policy.successStatus ?? 200)]: { description: "Success" },
    };
    if (policy.body) responses["400"] = errorResponse("Invalid request body");
    if (!isPublic) {
      responses["401"] = errorResponse("Missing or invalid session");
      responses["403"] = errorResponse("Role lacks the required permission");
    }
    if (key === "POST /api/v1/auth/dev-login") {
      responses["401"] = errorResponse("Invalid credentials");
      responses["404"] = errorResponse("Dev authentication is disabled");
      responses["429"] = errorResponse("Too many login attempts");
    }
    responses["429"] ??= errorResponse("Rate limit exceeded");

    const operation: Record<string, unknown> = {
      operationId: `${method.toLowerCase()}${honoPath.replace(/[^A-Za-z0-9]+(.)?/g, (_m, c?: string) => (c ?? "").toUpperCase())}`,
      summary: policy.summary,
      tags: [policy.tag],
      security: isPublic ? [] : [{ bearerAuth: [] }],
      responses,
    };
    if (params.length > 0) operation.parameters = params;
    if (typeof policy.access === "object") {
      operation["x-required-permission"] = policy.access.permission;
    }
    if (policy.body) {
      operation.requestBody = {
        required: true,
        content: {
          "application/json": { schema: { $ref: `#/components/schemas/${policy.body}` } },
        },
      };
    }
    const openApiPath = honoPath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    (paths[openApiPath] ??= {})[method.toLowerCase()] = operation;
  }
  return {
    openapi: "3.1.0",
    info: { title: "koality-inventory", version: "0.1.0" },
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      schemas: SCHEMAS,
    },
  };
}
