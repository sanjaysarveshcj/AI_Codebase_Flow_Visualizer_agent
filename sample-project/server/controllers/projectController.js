const ProjectModel = require("../models/Project");
const AuditLogModel = require("../models/AuditLog");

async function listProjects(req, res) {
  const projects = await ProjectModel.find({ ownerId: req.userId });
  return res.json({ ok: true, projects });
}

async function createProject(req, res) {
  const { name, tags = [] } = req.body;

  const createdProject = await ProjectModel.create({
    name,
    tags,
    ownerId: req.userId,
    status: "planning",
  });

  await AuditLogModel.create({ userId: req.userId, action: "project_created" });

  return res.status(201).json({ ok: true, project: createdProject });
}

async function getProject(req, res) {
  const project = await ProjectModel.findById(req.params.projectId);

  if (!project) {
    return res.status(404).json({ ok: false, message: "Project not found" });
  }

  return res.json({ ok: true, project });
}

async function updateProjectStatus(req, res) {
  const { status } = req.body;

  const updatedProject = await ProjectModel.findByIdAndUpdate(
    req.params.projectId,
    { status },
    { new: true }
  );

  await AuditLogModel.create({ userId: req.userId, action: "project_status_updated" });

  return res.json({ ok: true, project: updatedProject });
}

async function deleteProject(req, res) {
  await ProjectModel.findByIdAndDelete(req.params.projectId);
  await AuditLogModel.create({ userId: req.userId, action: "project_deleted" });

  return res.json({ ok: true, message: "Project deleted" });
}

module.exports = {
  listProjects,
  createProject,
  getProject,
  updateProjectStatus,
  deleteProject,
};
