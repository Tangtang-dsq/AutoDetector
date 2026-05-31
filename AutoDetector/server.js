#!/usr/bin/env node
"use strict";

const { createApp } = require("./src/app");
const { readConfig } = require("./src/config");

const config = readConfig(process.argv, process.env);
const app = createApp(config);

app.listen(() => {
  console.log(`AutoDetector server listening on http://${config.host}:${config.port}`);
});
