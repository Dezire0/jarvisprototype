const sourceLabels = require("./memory-source-labels.json");

function normalizeMemorySources(value) {
  return Array.isArray(value) ? Object.keys(sourceLabels).filter((source) => value.includes(source)) : [];
}

module.exports = {
  normalizeMemorySources
};
