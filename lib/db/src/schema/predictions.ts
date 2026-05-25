import { pgTable, text, serial, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const predictionsTable = pgTable("predictions", {
  id: serial("id").primaryKey(),
  player1: text("player1").notNull(),
  player2: text("player2").notNull(),
  tournament: text("tournament"),
  surface: text("surface"),
  matchDate: text("match_date"),
  agentDialogue: text("agent_dialogue").notNull(),
  recommendations: text("recommendations").notNull(),
  riskNotes: text("risk_notes"),
  cashoutAdvice: text("cashout_advice"),
  agentVote: text("agent_vote"),
  actualResult: text("actual_result"),
  isCorrect: boolean("is_correct"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPredictionSchema = createInsertSchema(predictionsTable).omit({ id: true, createdAt: true });
export type InsertPrediction = z.infer<typeof insertPredictionSchema>;
export type Prediction = typeof predictionsTable.$inferSelect;
