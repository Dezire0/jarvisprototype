class SkillRegistry {
  constructor() {
    this.skills = new Map();
  }

  register(skill) {
    if (!skill.name || !skill.schema || !skill.execute) {
      throw new Error("Invalid skill format. Must have name, schema, and execute.");
    }
    this.skills.set(skill.name, skill);
  }

  registerMany(skills) {
    skills.forEach(skill => this.register(skill));
  }

  get(name) {
    return this.skills.get(name);
  }

  getAllSchemas() {
    return Array.from(this.skills.values()).map(s => `  ${s.schema} — ${s.description || s.name}`);
  }

  async execute(action, context) {
    const skill = this.skills.get(action.action);
    if (!skill) {
      // Call safeObserve gracefully if the skill doesn't exist
      const state = context.safeObserve ? await context.safeObserve() : null;
      return { state, error: `Unknown action: ${action.action}` };
    }
    return await skill.execute(action, context);
  }
}

const registry = new SkillRegistry();

// Auto-register built-in skills
const browserSkills = require('./browser.cjs');
const osSkills = require('./os.cjs');
const fileSkills = require('./file.cjs');
const securitySkills = require('./security.cjs');
const coreSkills = require('./core.cjs');

registry.registerMany(browserSkills);
registry.registerMany(osSkills);
registry.registerMany(fileSkills);
registry.registerMany(securitySkills);
registry.registerMany(coreSkills);

module.exports = registry;
