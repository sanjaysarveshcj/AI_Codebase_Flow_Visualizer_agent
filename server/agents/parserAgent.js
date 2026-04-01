const astParser = require("../utils/astParser");

function parseCodebase(targetPath) {
  return astParser.parseCodebase(targetPath);
}

module.exports = {
  parseCodebase,
};
