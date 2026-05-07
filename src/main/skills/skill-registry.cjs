function normalizeInputKeys(keys = []) {
  return Array.isArray(keys)
    ? keys.map((key) => String(key || "").trim()).filter(Boolean)
    : [];
}

function deriveSkillKey(action = {}) {
  if (!action || typeof action !== "object") {
    return "";
  }

  if (typeof action.tool === "string" && action.tool.trim()) {
    return action.tool.trim();
  }

  if (typeof action.action === "string" && action.action.trim()) {
    return action.action.trim();
  }

  if (typeof action.name === "string" && action.name.trim()) {
    return action.name.trim();
  }

  return "";
}

class SkillRegistry {
  constructor() {
    this.skills = new Map();
    this.aliases = new Map();
  }

  register(skill) {
    if (!skill || !skill.name || !skill.execute) {
      throw new Error("Invalid skill format. Must have name and execute.");
    }

    const normalizedSkill = {
      ...skill,
      name: String(skill.name).trim(),
      aliases: Array.isArray(skill.aliases)
        ? skill.aliases.map((alias) => String(alias || "").trim()).filter(Boolean)
        : [],
      inputKeys: normalizeInputKeys(skill.inputKeys),
      schema: String(skill.schema || "").trim(),
      description: String(skill.description || skill.name || "").trim()
    };

    this.skills.set(normalizedSkill.name, normalizedSkill);

    for (const alias of normalizedSkill.aliases) {
      this.aliases.set(alias, normalizedSkill.name);
    }
  }

  registerMany(skills) {
    skills.forEach((skill) => this.register(skill));
  }

  resolve(nameOrAction) {
    const key = typeof nameOrAction === "string"
      ? String(nameOrAction || "").trim()
      : deriveSkillKey(nameOrAction);

    if (!key) {
      return null;
    }

    const canonicalName = this.skills.has(key)
      ? key
      : this.aliases.get(key);

    return canonicalName ? this.skills.get(canonicalName) || null : null;
  }

  get(name) {
    const resolved = this.resolve(name);
    return resolved || undefined;
  }

  normalizeAction(action = {}, skill = this.resolve(action)) {
    const resolvedSkill = skill || this.resolve(action);
    if (!resolvedSkill) {
      return null;
    }

    const inputFromAction =
      action.input && typeof action.input === "object" && !Array.isArray(action.input)
        ? { ...action.input }
        : null;
    const derivedInput = inputFromAction || {};

    if (!inputFromAction) {
      for (const key of resolvedSkill.inputKeys) {
        if (Object.prototype.hasOwnProperty.call(action, key) && action[key] !== undefined) {
          derivedInput[key] = action[key];
        }
      }
    }

    return {
      tool: resolvedSkill.name,
      input: derivedInput,
      reason: action.reason || "",
      expectedOutcome: action.expectedOutcome || "",
      raw: action
    };
  }

  getSchemasForTools(toolSet, options = {}) {
    const allowed = toolSet instanceof Set
      ? toolSet
      : new Set(Array.isArray(toolSet) ? toolSet : []);

    return Array.from(this.skills.values())
      .filter((skill) => !allowed.size || allowed.has(skill.name))
      .map((skill) => {
        const aliasText = skill.aliases.length ? ` (aliases: ${skill.aliases.join(", ")})` : "";
        return `  ${skill.schema} — ${skill.description}${aliasText}`;
      });
  }

  getAllSchemas(options = {}) {
    const toolSet = options.toolSet instanceof Set
      ? options.toolSet
      : null;

    if (toolSet) {
      return this.getSchemasForTools(toolSet, options);
    }

    return Array.from(this.skills.values()).map((skill) => {
      const aliasText = skill.aliases.length ? ` (aliases: ${skill.aliases.join(", ")})` : "";
      return `  ${skill.schema} — ${skill.description}${aliasText}`;
    });
  }

  async execute(action, context = {}) {
    const skill = this.resolve(action);
    if (!skill) {
      const state = context.safeObserve ? await context.safeObserve() : null;
      return { state, error: `Unknown action: ${deriveSkillKey(action) || "unknown"}` };
    }

    const normalizedAction = this.normalizeAction(action, skill);
    return skill.execute(normalizedAction, context);
  }
}

const registry = new SkillRegistry();

const browserSkills = require("./browser.cjs");
const osSkills = require("./os.cjs");
const fileSkills = require("./file.cjs");
const securitySkills = require("./security.cjs");
const coreSkills = require("./core.cjs");

registry.registerMany(browserSkills);
registry.registerMany(osSkills);
registry.registerMany(fileSkills);
registry.registerMany(securitySkills);
registry.registerMany(coreSkills);

module.exports = registry;
