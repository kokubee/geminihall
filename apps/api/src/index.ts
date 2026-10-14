import { verifyAccessJwt } from "./access";
import { createApp } from "./app";
import type { Env } from "./env";

const app = createApp(verifyAccessJwt);

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
