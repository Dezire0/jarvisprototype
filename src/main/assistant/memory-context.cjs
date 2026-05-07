function composePromptContextBlocks(blocks = []) {
  return blocks.filter(Boolean).join("\n\n").trim();
}

module.exports = {
  composePromptContextBlocks
};
