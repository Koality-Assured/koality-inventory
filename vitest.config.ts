import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@koality-inventory/ids": `${root}packages/ids/src/index.ts`,
      "@koality-inventory/db": `${root}packages/db/src/index.ts`,
    },
  },
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    fileParallelism: false,
  },
});
