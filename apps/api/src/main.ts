import { bootLocal } from "./boot.js";

const booted = await bootLocal({
  env: process.env,
  argv: process.argv.slice(2),
});

process.stderr.write(
  `koality-inventory local mode on http://127.0.0.1:${booted.port} (dev auth ${booted.devAuth ? "on" : "off"})\n`,
);
