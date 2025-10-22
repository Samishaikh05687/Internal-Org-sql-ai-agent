// postinstall-fix.js
const fs = require("fs");
const path = require("path");

const filePath = path.join(
  "node_modules",
  "@libsql",
  "hrana-client",
  "LICENSE"
);

const newFilePath = path.join(
  "node_modules",
  "@libsql",
  "hrana-client",
  "LICENSE.txt"
);

if (fs.existsSync(filePath) && !fs.existsSync(newFilePath)) {
  fs.renameSync(filePath, newFilePath);
  console.log("Renamed LICENSE → LICENSE.txt successfully ✅");
} else {
  console.log("No LICENSE file found or already renamed.");
}
