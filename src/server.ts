import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = buildApp({ config, logger: true });

try {
  const address = await app.listen({ host: config.host, port: config.port });
  app.log.info({ address }, "Esure backend is listening");
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}

