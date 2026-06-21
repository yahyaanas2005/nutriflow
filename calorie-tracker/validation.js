'use strict';
// ============================================================
// NutriFlow — Input Validation Module
//
// All functions return { ok: boolean, error: string | null }.
// ok === false  →  show error to user, block the write.
// ok === true   →  safe to persist.
// ============================================================
const validate = (() => {

  const OK        = { ok: true, error: null };
  const fail = (msg) => ({ ok: false, error: msg });

  // ----------------------------------------------------------
  // Primitive helpers
  // ----------------------------------------------------------
  function isBlank(s)  { return !s || String(s).trim() === ''; }
  function asNum(v)    { return typeof v === 'number' ? v : Number(v); }

  function numInRange(value, min, max, label) {
    const n = asNum(value);
    if (!Number.isFinite(n))  return fail(`${label} must be a valid number`);
    if (n < min)              return fail(`${label} must be at least ${min}`);
    if (n > max)              return fail(`${label} must be at most ${max}`);
    return OK;
  }

  // ----------------------------------------------------------
  // Nutrition macro sanity check
  // Calories should be roughly consistent with macros (±20% tolerance)
  // ----------------------------------------------------------
  function macroCalConsistency(cal, protein, carbs, fat) {
    if (cal === 0 && protein === 0 && carbs === 0 && fat === 0) return OK; // all-zero is fine
    const implied = protein * 4 + carbs * 4 + fat * 9;
    if (implied === 0) return OK; // macros all zero, cal entered manually — trust it
    const ratio = cal / implied;
    if (ratio < 0.5 || ratio > 2.0) {
      return fail(`Calories (${cal}) seem inconsistent with macros (implied ≈${Math.round(implied)} kcal). Double-check your values.`);
    }
    return OK;
  }

  // ----------------------------------------------------------
  // Custom food creation
  // ----------------------------------------------------------
  function customFood(f) {
    if (isBlank(f.name))              return fail('Food name is required');
    if (f.name.trim().length > 100)   return fail('Food name must be 100 characters or less');

    let r;
    r = numInRange(f.cal,     0, 9000,  'Calories');     if (!r.ok) return r;
    r = numInRange(f.protein, 0, 900,   'Protein');       if (!r.ok) return r;
    r = numInRange(f.carbs,   0, 900,   'Carbs');         if (!r.ok) return r;
    r = numInRange(f.fat,     0, 900,   'Fat');           if (!r.ok) return r;
    r = numInRange(f.fiber,   0, 100,   'Fiber');         if (!r.ok) return r;
    r = numInRange(f.sugar,   0, 900,   'Sugar');         if (!r.ok) return r;
    r = numInRange(f.serving, 0.1, 10000, 'Serving size'); if (!r.ok) return r;

    // Warn if macros and calories seem wildly inconsistent
    r = macroCalConsistency(
      asNum(f.cal), asNum(f.protein), asNum(f.carbs), asNum(f.fat)
    );
    if (!r.ok) return r;

    return OK;
  }

  // ----------------------------------------------------------
  // Serving size multiplier (when adding a food from the search)
  // ----------------------------------------------------------
  function servings(value) {
    const r = numInRange(value, 0.1, 99, 'Servings');
    return r;
  }

  // ----------------------------------------------------------
  // Exercise log entry
  // ----------------------------------------------------------
  function exercise(name, duration, calories) {
    if (isBlank(name))             return fail('Exercise name is required');
    if (name.trim().length > 100)  return fail('Exercise name must be 100 characters or less');

    let r;
    r = numInRange(duration, 1,  600,  'Duration (minutes)'); if (!r.ok) return r;
    r = numInRange(calories, 1,  9999, 'Calories burned');    if (!r.ok) return r;

    return OK;
  }

  // ----------------------------------------------------------
  // Weight entry
  // ----------------------------------------------------------
  function weight(kg) {
    return numInRange(asNum(kg), 10, 500, 'Weight (kg)');
  }

  // ----------------------------------------------------------
  // Water intake
  // Water is set by clicking cups — the click handler bounds it
  // by goal cups, so free-text abuse is not possible. This
  // function is exposed for any future text-entry path.
  // ----------------------------------------------------------
  function water(cups) {
    return numInRange(asNum(cups), 0, 30, 'Water cups');
  }

  // ----------------------------------------------------------
  // Goals form
  // ----------------------------------------------------------
  function goals(g) {
    let r;
    r = numInRange(g.calories,   500, 10000, 'Calorie goal');  if (!r.ok) return r;
    r = numInRange(g.protein,    0,   500,   'Protein goal');   if (!r.ok) return r;
    r = numInRange(g.carbs,      0,   1000,  'Carbs goal');     if (!r.ok) return r;
    r = numInRange(g.fat,        0,   300,   'Fat goal');       if (!r.ok) return r;
    r = numInRange(g.fiber,      0,   100,   'Fiber goal');     if (!r.ok) return r;
    r = numInRange(g.water,      1,   30,    'Water goal');     if (!r.ok) return r;
    r = numInRange(g.weight,     10,  500,   'Current weight'); if (!r.ok) return r;
    r = numInRange(g.goalWeight, 10,  500,   'Goal weight');    if (!r.ok) return r;
    return OK;
  }

  // ----------------------------------------------------------
  // Profile name
  // ----------------------------------------------------------
  function profileName(name) {
    if (isBlank(name)) return fail('Name is required');
    if (name.trim().length > 50) return fail('Name must be 50 characters or less');
    return OK;
  }

  // ----------------------------------------------------------
  // Settings (name + email)
  // ----------------------------------------------------------
  function settings(name, email) {
    const r = profileName(name);
    if (!r.ok) return r;
    if (email && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return fail('Email address format is invalid');
    }
    return OK;
  }

  return {
    customFood,
    servings,
    exercise,
    weight,
    water,
    goals,
    profileName,
    settings,
  };
})();
