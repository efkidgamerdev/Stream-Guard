import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

// Required so cookies work correctly behind Render's proxy
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Allow site to be embedded in iframes from any origin
app.use((_req, res, next) => {
  res.removeHeader("X-Frame-Options");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");
  next();
});

app.use("/api", router);

// Serve the built React frontend
const frontendDist = path.resolve(__dirname, "../../channelzz/dist/public");
app.use(express.static(frontendDist));

// SPA fallback — return index.html for any non-API route (Express 5 compatible)
app.get(/(.*)/, (_req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

export default app;
