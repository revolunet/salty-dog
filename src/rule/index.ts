import { applyDiff, diff } from 'deep-diff';
import { cloneDeep, Dictionary, intersection, isNil } from 'lodash';
import { LogLevel } from 'noicejs';

import { YamlParser } from '../parser/YamlParser';
import { readFile } from '../source';
import { ensureArray, hasItems } from '../utils';
import { VisitorContext } from '../visitor/VisitorContext';
import { SchemaRule } from './SchemaRule';

/* tslint:disable:no-any */

export interface RuleData {
  // metadata
  desc: string;
  level: LogLevel;
  name: string;
  tags: Array<string>;
  // data
  check: any;
  filter?: any;
  select: string;
}

export interface RuleSelector {
  excludeLevel: Array<LogLevel>;
  excludeName: Array<string>;
  excludeTag: Array<string>;
  includeLevel: Array<LogLevel>;
  includeName: Array<string>;
  includeTag: Array<string>;
}

export interface RuleSource {
  definitions?: Dictionary<any>;
  name: string;
  rules: Array<RuleData>;
}

export function createRuleSelector(options: Partial<RuleSelector>) {
  return {
    excludeLevel: ensureArray(options.excludeLevel),
    excludeName: ensureArray(options.excludeName),
    excludeTag: ensureArray(options.excludeTag),
    includeLevel: ensureArray(options.includeLevel),
    includeName: ensureArray(options.includeName),
    includeTag: ensureArray(options.includeTag),
  };
}

export async function loadRules(paths: Array<string>, ctx: VisitorContext): Promise<Array<SchemaRule>> {
  const parser = new YamlParser();
  const rules = [];

  for (const path of paths) {
    const contents = await readFile(path, {
      encoding: 'utf-8',
    });

    const docs = parser.parse(contents) as Array<RuleSource>;

    for (const data of docs) {
      if (!isNil(data.definitions)) {
        ctx.addSchema(data.name, data.definitions);
      }

      rules.push(...data.rules.map((it: RuleData) => new SchemaRule(it)));
    }
  }

  return rules;
}

export async function resolveRules(rules: Array<SchemaRule>, selector: RuleSelector): Promise<Array<SchemaRule>> {
  const activeRules = new Set<SchemaRule>();

  for (const r of rules) {
    if (selector.excludeLevel.includes(r.level)) {
      continue;
    }

    if (selector.excludeName.includes(r.name)) {
      continue;
    }

    const excludedTags = intersection(selector.excludeTag, r.tags);
    if (excludedTags.length > 0) {
      continue;
    }

    if (selector.includeLevel.includes(r.level)) {
      activeRules.add(r);
    }

    if (selector.includeName.includes(r.name)) {
      activeRules.add(r);
    }

    const includedTags = intersection(selector.includeTag, r.tags);
    if (includedTags.length > 0) {
      activeRules.add(r);
    }
  }

  return Array.from(activeRules);
}

export async function visitRules(ctx: VisitorContext, rules: Array<SchemaRule>, data: any): Promise<VisitorContext> {
  for (const rule of rules) {
    const items = await rule.pick(ctx, data);
    for (const item of items) {
      const itemResult = cloneDeep(item);
      const ruleResult = await rule.visit(ctx, itemResult);

      if (ruleResult.errors.length > 0) {
        ctx.logger.warn({ count: ruleResult.errors.length, rule }, 'rule failed');
        ctx.mergeResult(ruleResult);
        continue;
      }

      const itemDiff = diff(item, itemResult);
      if (hasItems(itemDiff)) {
        ctx.logger.info({
          diff: itemDiff,
          item,
          rule: rule.name,
        }, 'rule passed with modifications');

        if (ctx.innerOptions.mutate) {
          applyDiff(item, itemResult);
        }
      } else {
        ctx.logger.info({ rule: rule.name }, 'rule passed');
      }
   }
  }

  return ctx;
}
