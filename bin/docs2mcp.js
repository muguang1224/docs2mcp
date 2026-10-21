#!/usr/bin/env node
import { main } from '../src/cli.js';

main().catch((err) => {
  process.stderr.write(`docs2mcp: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
