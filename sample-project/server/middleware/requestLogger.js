function requestLogger(req, _res, next) {
  req.requestStartedAt = Date.now();
  next();
}

module.exports = requestLogger;
