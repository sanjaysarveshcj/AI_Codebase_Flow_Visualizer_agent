const express = require("express");
const authController = require("../controllers/authController");
const requestLogger = require("../middleware/requestLogger");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

router.post("/api/auth/login", requestLogger, authController.login);
router.get("/api/auth/profile", requireAuth, authController.profile);

module.exports = router;
