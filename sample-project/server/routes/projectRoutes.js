const express = require("express");
const projectController = require("../controllers/projectController");
const requestLogger = require("../middleware/requestLogger");
const requireAuth = require("../middleware/requireAuth");
const requireProjectEditor = require("../middleware/requireProjectEditor");

const router = express.Router();

router.get("/api/projects", requireAuth, projectController.listProjects);
router.post("/api/projects", requireAuth, requestLogger, projectController.createProject);
router.get("/api/projects/:projectId", requireAuth, projectController.getProject);
router.patch(
  "/api/projects/:projectId/status",
  requireAuth,
  requestLogger,
  requireProjectEditor,
  projectController.updateProjectStatus
);
router.delete(
  "/api/projects/:projectId",
  requireAuth,
  requestLogger,
  requireProjectEditor,
  projectController.deleteProject
);

module.exports = router;
