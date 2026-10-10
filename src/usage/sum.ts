/** Arithmetic on StepUsage, free of tree imports so the renderer can use it. */

import type { StepUsage } from '../types.js';

export function emptyUsage(withSubagents: boolean): StepUsage {
  return {
    calls: 0,
    prompt_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    context_peak: 0,
    context_window: null,
    compactions: [],
    ...(withSubagents
      ? { subagents: { count: 0, calls: 0, prompt_tokens: 0, output_tokens: 0 } }
      : {}),
  };
}

/** Sum of disjoint usage, `b` being later than `a` (its context window wins). */
export function addUsage(a: StepUsage, b: StepUsage): StepUsage {
  const sum: StepUsage = {
    calls: a.calls + b.calls,
    prompt_tokens: a.prompt_tokens + b.prompt_tokens,
    cache_read_tokens: a.cache_read_tokens + b.cache_read_tokens,
    cache_write_tokens: a.cache_write_tokens + b.cache_write_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    reasoning_tokens: a.reasoning_tokens + b.reasoning_tokens,
    context_peak: Math.max(a.context_peak, b.context_peak),
    context_window: b.context_window ?? a.context_window,
    compactions: [...a.compactions, ...b.compactions],
  };
  if (a.subagents || b.subagents) {
    const x = a.subagents ?? { count: 0, calls: 0, prompt_tokens: 0, output_tokens: 0 };
    const y = b.subagents ?? { count: 0, calls: 0, prompt_tokens: 0, output_tokens: 0 };
    sum.subagents = {
      count: x.count + y.count,
      calls: x.calls + y.calls,
      prompt_tokens: x.prompt_tokens + y.prompt_tokens,
      output_tokens: x.output_tokens + y.output_tokens,
    };
  }
  return sum;
}
