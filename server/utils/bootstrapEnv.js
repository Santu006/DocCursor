const path = require("path");
const dotenv = require("dotenv");

/**
 * Load server environment the same way standalone scripts/jobs should.
 * Loads `.env` first, then `.env.{NODE_ENV}` (defaults to development).
 */
function bootstrapServerEnv() {
  const serverRoot = path.resolve(__dirname, "..");
  process.env.NODE_ENV = process.env.NODE_ENV || "development";
  dotenv.config({ path: path.join(serverRoot, ".env") });
  dotenv.config({ path: path.join(serverRoot, `.env.${process.env.NODE_ENV}`) });
}

module.exports = { bootstrapServerEnv };
