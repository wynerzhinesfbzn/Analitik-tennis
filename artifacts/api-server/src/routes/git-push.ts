import { Router } from "express";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const router: Router = Router();

router.post("/git-push", async (req, res) => {
  const { token } = req.body as { token?: string };

  if (!token || typeof token !== "string" || token.trim().length < 10) {
    res.status(400).json({ ok: false, error: "Токен не указан или слишком короткий" });
    return;
  }

  const url = `https://wynerzhinesfbzn:${token.trim()}@github.com/wynerzhinesfbzn/Analitik-tennis.git`;

  try {
    const { stdout, stderr } = await execFileAsync(
      "git",
      ["push", url, "main", "--force"],
      { cwd: "/home/runner/workspace", timeout: 30000 }
    );
    res.json({ ok: true, output: (stdout + stderr).trim() || "Успешно запушено!" });
  } catch (err: any) {
    const msg: string = (err.stderr ?? err.stdout ?? err.message ?? "Неизвестная ошибка").toString();
    req.log.error({ err }, "git push failed");
    res.status(500).json({ ok: false, error: msg });
  }
});

export default router;
