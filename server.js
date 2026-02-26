// server.js — handles file uploads, SSH deploys to the Pis,
// and serves the frontend on localhost
import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import {
  PIS, PI_USER, REMOTE_INCOMING, REMOTE_CURRENT,
  PORT, MAX_FILE_SIZE, SSH_OPTS,
} from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// --- express setup ---
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// file upload handling
const singleUpload = multer({
  dest: uploadsDir,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter(_req, file, cb) {
    if (path.extname(file.originalname).toLowerCase() !== ".mp4") {
      return cb(new Error("Only .mp4 files are accepted"));
    }
    cb(null, true);
  },
});

// deploy-all uses separate file fields: video_pi1, video_pi2, etc.
const multiFields = PIS.map((pi) => ({ name: `video_${pi.id}`, maxCount: 1 }));
const multiUpload = multer({
  dest: uploadsDir,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter(_req, file, cb) {
    if (path.extname(file.originalname).toLowerCase() !== ".mp4") {
      return cb(new Error("Only .mp4 files are accepted"));
    }
    cb(null, true);
  },
});

// --- helpers ---

function run(cmd, args, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let out = "";
    let err = "";

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));

    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Failed to start ${cmd}: ${e.message}`));
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ out, err });
      else reject(new Error(`${cmd} exited ${code}: ${err.trim()}`));
    });
  });
}

async function pushToPi(piHost, localFilePath) {
  await run("scp", [
    ...SSH_OPTS,
    localFilePath,
    `${PI_USER}@${piHost}:${REMOTE_INCOMING}`,
  ]);
  await run("ssh", [
    ...SSH_OPTS,
    `${PI_USER}@${piHost}`,
    `mv -f "${REMOTE_INCOMING}" "${REMOTE_CURRENT}" && sudo systemctl restart signage-vlc`,
  ]);
}

async function testPi(piHost) {
  const { out } = await run("ssh", [
    ...SSH_OPTS,
    `${PI_USER}@${piHost}`,
    "echo ok",
  ], 15_000);
  return out.trim() === "ok";
}

function tryUnlink(filePath) {
  try { fs.unlinkSync(filePath); } catch { /* ignore */ }
}

// wraps multer so upload errors come back as JSON, not a raw 500
function multerWrap(multerFn) {
  return (req, res, next) => {
    multerFn(req, res, (err) => {
      if (err) {
        const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        return res.status(status).json({ ok: false, error: err.message });
      }
      next();
    });
  };
}

// --- routes ---

app.get("/api/pis", (_req, res) => res.json(PIS));

// deploy to a single Pi
app.post("/api/pis/:id/upload-and-deploy",
  multerWrap(singleUpload.single("video")),
  async (req, res) => {
    const pi = PIS.find((p) => p.id === req.params.id);
    if (!pi) return res.status(404).json({ ok: false, error: "Unknown Pi id" });
    if (!req.file) return res.status(400).json({ ok: false, error: "No video file provided" });

    const localFile = path.resolve(req.file.path);
    try {
      await pushToPi(pi.host, localFile);
      res.json({ ok: true, pi: pi.name, host: pi.host, error: null });
    } catch (e) {
      res.json({ ok: false, pi: pi.name, host: pi.host, error: e.message });
    } finally {
      tryUnlink(localFile);
    }
  }
);

// deploy to multiple Pis at once — skip any that don't have a file attached
app.post("/api/deploy-all",
  multerWrap(multiUpload.fields(multiFields)),
  async (req, res) => {
    const files = req.files || {};
    const tempPaths = [];

    // pair each Pi with its uploaded file (if any)
    const jobs = PIS.map((pi) => {
      const field = files[`video_${pi.id}`];
      if (!field || field.length === 0) return null;
      const localFile = path.resolve(field[0].path);
      tempPaths.push(localFile);
      return { pi, localFile };
    });

    if (jobs.every((j) => j === null)) {
      return res.status(400).json({ ok: false, error: "No video files provided" });
    }

    try {
      const results = await Promise.allSettled(
        jobs.map((job) => {
          if (!job) return Promise.resolve("skipped");
          return pushToPi(job.pi.host, job.localFile);
        })
      );

      const summary = results.map((r, i) => {
        if (!jobs[i]) {
          return { pi: PIS[i].name, host: PIS[i].host, ok: true, skipped: true, error: null };
        }
        return {
          pi:    PIS[i].name,
          host:  PIS[i].host,
          ok:    r.status === "fulfilled",
          skipped: false,
          error: r.status === "rejected" ? r.reason.message : null,
        };
      });

      const deployed = summary.filter((s) => !s.skipped);
      res.json({ ok: deployed.every((s) => s.ok), summary });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    } finally {
      tempPaths.forEach(tryUnlink);
    }
  }
);

// same video to all Pis (legacy endpoint)
app.post("/api/upload-and-deploy",
  multerWrap(singleUpload.single("video")),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ ok: false, error: "No video file provided" });

    const localFile = path.resolve(req.file.path);
    try {
      const results = await Promise.allSettled(
        PIS.map((pi) => pushToPi(pi.host, localFile))
      );
      const summary = results.map((r, i) => ({
        pi: PIS[i].name, host: PIS[i].host,
        ok: r.status === "fulfilled",
        error: r.status === "rejected" ? r.reason.message : null,
      }));
      res.json({ ok: summary.every((s) => s.ok), summary });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    } finally {
      tryUnlink(localFile);
    }
  }
);

// SSH ping to check which Pis are reachable
app.get("/api/test-connectivity", async (_req, res) => {
  const results = await Promise.allSettled(PIS.map((pi) => testPi(pi.host)));
  const summary = results.map((r, i) => ({
    pi: PIS[i].name, host: PIS[i].host,
    ok: r.status === "fulfilled" && r.value === true,
    error: r.status === "rejected" ? r.reason.message : null,
  }));
  res.json({ ok: summary.every((s) => s.ok), summary });
});

// fire it up
const port = process.env.PORT || PORT;
app.listen(port, () => {
  console.log(`Signage Controller server listening on http://localhost:${port}`);
});
