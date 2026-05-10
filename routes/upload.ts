import express from "express";
import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import { processStatement } from "../controllers/statementController.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (
    _req: Request,
    file: Express.Multer.File,
    cb: multer.FileFilterCallback
  ) => {
    const allowed = ["application/pdf", "text/csv"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and CSV files are allowed"));
    }
  },
});

const uploadWithErrorHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "File too large. Maximum allowed size is 10 MB." });
        return;
      }
      res.status(400).json({ error: `Upload error: ${err.message}` });
      return;
    }
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next();
  });
};

router.post("/upload", uploadWithErrorHandler, processStatement);

export default router;