const UserModel = require("../models/User");
const AuditLogModel = require("../models/AuditLog");

async function findUserByEmail(email) {
  return UserModel.findOne({ email });
}

async function findUserProfileById(userId) {
  return UserModel.findById(userId);
}

async function logAuditEvent(userId, action) {
  return AuditLogModel.create({ userId, action });
}

async function register(req, res) {
  const { email, password } = req.body;
  const passwordHash = `hash:${password || ""}`;

  const createdUser = await UserModel.create({ email, passwordHash });
  await logAuditEvent(createdUser._id, "user_registered");

  return res.status(201).json({ ok: true, userId: createdUser._id });
}

async function login(req, res) {
  const { email } = req.body;
  const user = await findUserByEmail(email);

  if (!user) {
    return res.status(401).json({ ok: false, message: "Invalid credentials" });
  }

  return res.json({ ok: true, token: "fake-jwt-token" });
}

async function profile(req, res) {
  const user = await findUserProfileById(req.userId);

  if (!user) {
    return res.status(404).json({ ok: false, message: "User not found" });
  }

  return res.json({ ok: true, user });
}

async function updatePassword(req, res) {
  const { password } = req.body;
  const passwordHash = `hash:${password || ""}`;

  await UserModel.findByIdAndUpdate(req.userId, {
    passwordHash,
  });

  await logAuditEvent(req.userId, "password_updated");

  return res.json({ ok: true, message: "Password updated" });
}

async function activity(req, res) {
  const logs = await AuditLogModel.find({ userId: req.userId });
  return res.json({ ok: true, logs });
}

async function logout(req, res) {
  await logAuditEvent(req.userId, "user_logged_out");
  return res.json({ ok: true, message: "Logged out" });
}

function debugAuditTrail(_eventName, _payload) {
  return "legacy_audit_hook";
}

module.exports = {
  register,
  login,
  profile,
  updatePassword,
  activity,
  logout,
  debugAuditTrail,
};
