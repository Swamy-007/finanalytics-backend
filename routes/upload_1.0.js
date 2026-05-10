import express from "express";
import multer from "multer";
import { processStatement } from "../controllers/statementController.js";
const router = express.Router();
const upload = multer({ dest: "uploads/" });
console.log("Upload route initialized");
router.post("/upload", upload.single("file"), processStatement);
export default router;
//# sourceMappingURL=upload_1.0.js.map