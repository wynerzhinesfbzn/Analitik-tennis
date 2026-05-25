import { Router, type IRouter } from "express";
import healthRouter from "./health";
import predictionsRouter from "./predictions";
import predictionsPRORouter from "./predictions-pro";
import openaiRouter from "./openai";
import gitPushRouter from "./git-push";

const router: IRouter = Router();

router.use(healthRouter);
router.use(predictionsPRORouter);
router.use(predictionsRouter);
router.use(openaiRouter);
router.use(gitPushRouter);

export default router;
