import "dotenv/config";
import { KaivuApiServer } from "../src/index.js";

declare const process: { env: Record<string, string | undefined> };

const server = new KaivuApiServer({
  host: process.env.KAIVU_HOST ?? "127.0.0.1",
  port: Number(process.env.KAIVU_PORT ?? 8787),
});

server.start();
console.log(`Kaivu API server listening on http://${process.env.KAIVU_HOST ?? "127.0.0.1"}:${process.env.KAIVU_PORT ?? 8787}`);
