/**
 * Lightweight request-body validators.
 *
 * Each function returns null on success or a string with the failure reason.
 * Routes can do:
 *   const err = validateAutomation(req.body);
 *   if (err) return res.status(400).json({ error: err });
 */

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const TRIGGER_REGEX = /^(sunrise|sunset)([+-]\d{1,3})?$/i;
const VALID_DAYS = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function validateTimeString(val, field) {
  if (typeof val !== 'string') return `${field} must be a string`;
  if (TIME_REGEX.test(val)) return null;
  if (TRIGGER_REGEX.test(val)) return null;
  return `${field} must be HH:MM, "sunrise", "sunset", or "sunrise±N"/"sunset±N"`;
}

function validateDuration(value, field) {
  if (typeof value !== 'number' || value <= 0 || value > 24 * 60) {
    return `${field} must be a number of minutes between 1 and 1440`;
  }
  return null;
}

function validateSchedule(schedule) {
  if (!isPlainObject(schedule)) return 'schedule must be an object';
  if (schedule.start === undefined) return 'schedule.start is required';

  const startErr = validateTimeString(schedule.start, 'schedule.start');
  if (startErr) return startErr;

  if (schedule.end !== undefined) {
    const endErr = validateTimeString(schedule.end, 'schedule.end');
    if (endErr) return endErr;
  }

  if (schedule.duration !== undefined) {
    const dErr = validateDuration(schedule.duration, 'schedule.duration');
    if (dErr) return dErr;
  }

  if (schedule.days !== undefined) {
    if (!Array.isArray(schedule.days)) return 'schedule.days must be an array';
    for (const d of schedule.days) {
      if (!VALID_DAYS.has(d)) return `schedule.days contains invalid day "${d}"`;
    }
  }

  return null;
}

function validateStep(step, idx) {
  if (!isPlainObject(step)) return `steps[${idx}] must be an object`;
  const tErr = validateTargets(step.targets);
  if (tErr) return `steps[${idx}].${tErr}`;
  const aErr = validateAction(step.action);
  if (aErr) return `steps[${idx}].${aErr}`;
  if (step.duration !== undefined) {
    const dErr = validateDuration(step.duration, `steps[${idx}].duration`);
    if (dErr) return dErr;
  }
  if (step.enforce !== undefined && typeof step.enforce !== 'boolean') {
    return `steps[${idx}].enforce must be boolean`;
  }
  return null;
}

function validateAction(action) {
  if (action === undefined) return null;
  if (!isPlainObject(action)) return 'action must be an object';

  if (action.state !== undefined && typeof action.state !== 'boolean') {
    return 'action.state must be boolean';
  }
  if (action.brightness !== undefined) {
    if (typeof action.brightness !== 'number' || action.brightness < 0 || action.brightness > 100) {
      return 'action.brightness must be 0-100';
    }
  }
  if (action.temperature !== undefined) {
    if (typeof action.temperature !== 'number' || action.temperature < 2200 || action.temperature > 6500) {
      return 'action.temperature must be 2200-6500';
    }
  }
  for (const ch of ['r', 'g', 'b']) {
    if (action[ch] !== undefined) {
      if (typeof action[ch] !== 'number' || action[ch] < 0 || action[ch] > 255) {
        return `action.${ch} must be 0-255`;
      }
    }
  }
  if (action.sceneId !== undefined) {
    if (typeof action.sceneId !== 'number') return 'action.sceneId must be a number';
  }
  return null;
}

function validateTargets(targets) {
  if (!isPlainObject(targets)) return 'targets must be an object';
  const hasLights = Array.isArray(targets.lights) && targets.lights.length > 0;
  const hasGroups = Array.isArray(targets.groups) && targets.groups.length > 0;
  if (!hasLights && !hasGroups) return 'targets must include at least one of lights[] or groups[]';
  if (targets.lights !== undefined && !Array.isArray(targets.lights)) return 'targets.lights must be an array';
  if (targets.groups !== undefined && !Array.isArray(targets.groups)) return 'targets.groups must be an array';
  return null;
}

/**
 * Validate body for either:
 *   - new shape: steps[] (preferred)
 *   - legacy shape: action + targets at top level (auto-migrated to one-step)
 *
 * In the new shape, `duration` and `enforce` may be set per-step. The legacy
 * top-level `duration`/`enforce` still works for single-step routines.
 */
const VALID_TYPES = new Set(['scene', 'automation']);

function validateAutomation(body, { allowPartial = false } = {}) {
  if (!isPlainObject(body)) return 'request body must be an object';

  // type: 'scene' for manual-only triggers (no schedule required); default
  // is 'automation' which behaves as before. Stored on the record.
  const type = body.type ?? 'automation';
  if (!VALID_TYPES.has(type)) return `type must be one of ${[...VALID_TYPES].join(', ')}`;
  const isScene = type === 'scene';

  const validateBodyShape = () => {
    if (body.steps !== undefined) {
      if (!Array.isArray(body.steps) || body.steps.length === 0) {
        return 'steps must be a non-empty array';
      }
      for (let i = 0; i < body.steps.length; i++) {
        const e = validateStep(body.steps[i], i);
        if (e) return e;
      }
    } else if (body.action !== undefined || body.targets !== undefined) {
      // Legacy shape — must have both targets and action.
      const e2 = validateAction(body.action); if (e2) return e2;
      const e3 = validateTargets(body.targets); if (e3) return e3;
    } else if (!allowPartial) {
      return 'either steps[] or targets+action is required';
    }
    return null;
  };

  // Partial updates (PUT) — only validate fields that are present.
  if (allowPartial) {
    if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) {
      return 'name must be a non-empty string';
    }
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
      return 'enabled must be boolean';
    }
    if (body.schedule !== undefined) {
      const e = validateSchedule(body.schedule); if (e) return e;
    }
    if (body.enforce !== undefined && typeof body.enforce !== 'boolean') {
      return 'enforce must be boolean';
    }
    return validateBodyShape();
  }

  // Full creation — required fields enforced.
  if (typeof body.name !== 'string' || !body.name.trim()) return 'name is required';
  if (!isScene) {
    // Schedules are required for type='automation'. Scenes are manual-only.
    const e1 = validateSchedule(body.schedule); if (e1) return e1;
  } else if (body.schedule !== undefined) {
    // If a scene happens to carry a schedule, still validate it (won't be used).
    const e1 = validateSchedule(body.schedule); if (e1) return e1;
  }
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return 'enabled must be boolean';
  if (body.enforce !== undefined && typeof body.enforce !== 'boolean') return 'enforce must be boolean';
  return validateBodyShape();
}

function validateLightControl(body) {
  if (!isPlainObject(body)) return 'request body must be an object';
  return validateAction(body);
}

module.exports = {
  validateAutomation,
  validateAction,
  validateLightControl,
  validateSchedule,
  validateTargets,
  validateStep
};
