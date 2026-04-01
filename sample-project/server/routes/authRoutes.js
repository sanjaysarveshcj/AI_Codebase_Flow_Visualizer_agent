const express = require("express");
const authController = require("../controllers/authController");
const requestLogger = require("../middleware/requestLogger");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

router.post("/api/auth/register", requestLogger, authController.register);
router.post("/api/auth/login", requestLogger, authController.login);
router.get("/api/auth/profile", requireAuth, authController.profile);
router.patch("/api/auth/password", requireAuth, requestLogger, authController.updatePassword);
router.get("/api/auth/activity", requireAuth, authController.activity);
router.post("/api/auth/logout", requireAuth, requestLogger, authController.logout);

module.exports = router;
