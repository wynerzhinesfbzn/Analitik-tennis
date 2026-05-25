import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const searchCacheTable = pgTable("tennis_search_cache", {
  cacheKey: text("cache_key").primaryKey(),
  dataJson:  text("data_json").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type SearchCache = typeof searchCacheTable.$inferSelect;
