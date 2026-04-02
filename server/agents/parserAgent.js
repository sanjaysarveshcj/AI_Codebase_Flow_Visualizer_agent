const astParser = require("../utils/astParser");

function parseCodebase(targetPath) {
  return astParser.parseCodebase(targetPath);
}

function parseCodebaseFromSourceFiles(sourceFiles, options) {
  return astParser.parseCodebaseFromSourceFiles(sourceFiles, options);
}

module.exports = {
  parseCodebase,
  parseCodebaseFromSourceFiles,
};
