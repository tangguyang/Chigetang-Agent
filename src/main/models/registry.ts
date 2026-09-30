import type { Model } from "../../shared/types.ts";
import { HttpClient } from "../providers/http.ts";
import { AppError } from "../services/errors.ts";
import { SeedanceAdapter, WanAdapter, type ModelAdapter } from "./adapters.ts";
type Factory = (
  http: HttpClient,
  download: (url: string, destination: string) => Promise<string>,
) => ModelAdapter;
const factories = new Map<string, Factory>([
  ["wan3", (http, download) => new WanAdapter(http, download)],
  ["seedance", (http, download) => new SeedanceAdapter(http, download)],
]);
export function registerAdapter(id: string, factory: Factory) {
  if (factories.has(id)) throw new Error(`Adapter ${id} is already registered`);
  factories.set(id, factory);
}
export function createAdapter(
  model: Model,
  http: HttpClient,
  download: (url: string, destination: string) => Promise<string>,
) {
  const factory = factories.get(model.adapter);
  if (!factory)
    throw new AppError("ValidationError", "当前软件尚未安装此模型适配器。");
  return factory(http, download);
}
