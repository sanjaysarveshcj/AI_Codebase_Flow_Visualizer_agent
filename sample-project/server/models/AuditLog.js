const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  action: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const AuditLogModel = mongoose.model("AuditLog", auditLogSchema);

module.exports = AuditLogModel;
