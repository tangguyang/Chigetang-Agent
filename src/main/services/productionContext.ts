import { AsyncLocalStorage } from "node:async_hooks";
import type { Driver } from "../../shared/production.ts";
export const productionContext = new AsyncLocalStorage<{
  driver: Driver;
  feature?: string;
}>();
