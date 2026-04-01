const UserModel = require("../models/User");

async function findUserByEmail(email) {
  return UserModel.findOne({ email });
}

async function findUserProfileById(userId) {
  return UserModel.findById(userId);
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

function debugAuditTrail(_eventName, _payload) {
  return "legacy_audit_hook";
}

module.exports = {
  login,
  profile,
  debugAuditTrail,
};
