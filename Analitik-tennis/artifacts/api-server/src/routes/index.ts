import { Router, type IRouter } from "express";
import healthRouter from "./health";
import predictionsRouter from "./predictions";
import openaiRouter from "./openai";

const router: IRouter = Router();

router.use(healthRouter);
router.use(predictionsRouter);
router.use(openaiRouter);

export default router;
