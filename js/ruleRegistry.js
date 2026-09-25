(function defineRuleRegistry(global) {
  "use strict";

  const app = global.SanmokuLab;

  class RuleRegistry {
    constructor() {
      this.rules = new Map();
    }

    register(definition) {
      if (!definition || typeof definition !== "object") {
        throw new TypeError("Rule definition must be an object.");
      }
      if (!definition.id || !/^[A-Z][A-Z0-9_]*$/.test(definition.id)) {
        throw new Error("Rule id must use upper snake case.");
      }
      if (this.rules.has(definition.id)) {
        throw new Error(`Rule already registered: ${definition.id}`);
      }

      const normalized = Object.freeze({
        id: definition.id,
        name: definition.name || definition.id,
        shortDescription: definition.shortDescription || "",
        description: definition.description || definition.shortDescription || "",
        categories: Object.freeze([...(definition.categories || [])]),
        settings: Object.freeze(
          (definition.settings || []).map((setting) => Object.freeze({ ...setting })),
        ),
        conflicts: Object.freeze([...(definition.conflicts || [])]),
        priority: Number.isFinite(definition.priority) ? definition.priority : 500,
        exactSearchSafe: definition.exactSearchSafe === true,
        usesPieceAge: definition.usesPieceAge === true,
        transfersPieceOwnership: definition.transfersPieceOwnership === true,
        hooks: Object.freeze({ ...(definition.hooks || {}) }),
      });

      this.rules.set(normalized.id, normalized);
      return normalized;
    }

    get(id) {
      return this.rules.get(id) || null;
    }

    getAll() {
      return [...this.rules.values()].sort(
        (left, right) => left.priority - right.priority || left.name.localeCompare(right.name),
      );
    }

    createDefaultConfig() {
      const config = {};
      for (const rule of this.getAll()) {
        config[rule.id] = {
          enabled: false,
          settings: Object.fromEntries(
            rule.settings.map((setting) => [setting.key, setting.default]),
          ),
        };
      }
      return config;
    }

    normalizeConfig(input) {
      const source = input || {};
      const output = this.createDefaultConfig();

      for (const rule of this.getAll()) {
        const candidate = source[rule.id] || {};
        output[rule.id].enabled = Boolean(candidate.enabled);

        for (const setting of rule.settings) {
          const rawValue = candidate.settings
            ? candidate.settings[setting.key]
            : undefined;
          if (setting.type === "number") {
            output[rule.id].settings[setting.key] = app.utils.clampInteger(
              rawValue,
              setting.min,
              setting.max,
              setting.default,
            );
          } else if (rawValue !== undefined) {
            output[rule.id].settings[setting.key] = rawValue;
          }
        }
      }

      this.assertNoConflicts(output);
      return output;
    }

    assertNoConflicts(config) {
      for (const rule of this.getAll()) {
        if (!config[rule.id] || !config[rule.id].enabled) continue;
        const conflict = rule.conflicts.find(
          (conflictId) => config[conflictId] && config[conflictId].enabled,
        );
        if (conflict) {
          throw new Error(`${rule.id} conflicts with ${conflict}.`);
        }
      }
    }
  }

  app.RuleRegistry = RuleRegistry;
  app.ruleRegistry = new RuleRegistry();
})(globalThis);
