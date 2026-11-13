import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env.js";
import { errorHandler, notFound } from "./shared/errors.js";
import v1Routes from "./routes/v1.js";
import { openApiDocument } from "./openapi.js";

const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN.split(",").map((x) => x.trim()), credentials: true }));
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(express.json({ limit: "1mb" }));

app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.get("/health", (_req, res) =>
  res.json({ success: true, data: { status: "ok" } }),
);
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));
app.use("/api/v1", v1Routes);
app.use(notFound);
app.use(errorHandler);
export default app;
