function requireProjectEditor(req, res, next) {
  const role = req.headers["x-project-role"] || "viewer";

  if (role !== "editor" && role !== "owner") {
    return res.status(403).json({ ok: false, message: "Editor role required" });
  }

  return next();
}

module.exports = requireProjectEditor;
