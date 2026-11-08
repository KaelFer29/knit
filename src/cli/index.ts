#!/usr/bin/env node
import { main } from "./main.js";

main(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
}).then((code) => process.exit(code));
