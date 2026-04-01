const mongoose = require("mongoose");

const projectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  ownerId: { type: String, required: true },
  status: { type: String, default: "planning" },
  tags: [{ type: String }],
});

const ProjectModel = mongoose.model("Project", projectSchema);

module.exports = ProjectModel;
