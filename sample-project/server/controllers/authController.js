const UserModel = require("../models/User");

async function login(req, res) {
  const { email } = req.body;
  const user = await UserModel.findOne({ email });

  if (!user) {
    return res.status(401).json({ ok: false, message: "Invalid credentials" });
  }

  return res.json({ ok: true, token: "fake-jwt-token" });
}

async function profile(req, res) {
  const user = await UserModel.findById(req.userId);

  if (!user) {
    return res.status(404).json({ ok: false, message: "User not found" });
  }

  return res.json({ ok: true, user });
}

module.exports = {
  login,
  profile,
};
