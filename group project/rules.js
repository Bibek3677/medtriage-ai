/* MedTriage AI — clinical protocol engine.
   No DOM access: this file is the "protocol" and is unit-tested in tests/rules.test.js.
   Loads as a browser global (MedTriageRules) or a CommonJS module. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MedTriageRules = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
"use strict";

/* ---------- Vocabulary ---------- */
const RED = [["chest","Chest pain or pressure"],["sob","Shortness of breath"],["stroke","Face drooping or slurred speech"],["weak","Sudden one-sided weakness"],["confused","New confusion"],["faint","Fainting"],["bleed","Heavy bleeding"]];
const COMMON = [["fever","Fever or chills"],["cough","Cough"],["throat","Sore throat"],["nose","Runny or stuffy nose"],["headache","Headache"],["abdo","Abdominal pain"],["vomit","Vomiting"],["diarrhea","Diarrhea"],["dizzy","Dizziness"],["rash","Rash"],["urine","Painful urination"],["ear","Ear pain"],["back","Back pain"],["fatigue","Fatigue"]];
const HISTORY = [["heart","Heart disease"],["diabetes","Diabetes"],["lung","Asthma or COPD"],["kidney","Kidney disease"],["htn","High blood pressure"],["immuno","Weakened immune system"],["preg","Currently pregnant"],["none","None known"]];
const LABEL = Object.fromEntries([...RED, ...COMMON, ...HISTORY]);

/* Triage categories. `window` is the booking target in hours from now;
   `target` is the same thing in words, for prose that reads properly. */
const LEVELS = {
  1:{name:"Emergency", sub:"Immediate", target:"immediate handoff", route:"Call 911 or go to the emergency department now", detail:"Don't drive yourself. Bring a medication list if it's safe to do so.", window:[0,0]},
  2:{name:"Urgent",    sub:"Within 1–4 hours", target:"1–4 hour", route:"Be seen at urgent care or the ED today", detail:"If symptoms get worse while waiting, treat it as an emergency.", window:[1,4]},
  3:{name:"Soon",      sub:"Within 24–72 hours", target:"24–72 hour", route:"Book primary care or a telehealth visit", detail:"Monitor symptoms. Move up to urgent care if anything on the warning list appears.", window:[24,72]},
  4:{name:"Self-care", sub:"Monitor at home", target:"1–7 day", route:"Home care with monitoring", detail:"Rest, fluids, and over-the-counter relief as appropriate. Reassess if not improving in a few days.", window:[24,168]}
};

/* ---------- Normalization ----------
   Unknown numbers become NaN so every comparison against them is false.
   That keeps a blank vital or age from silently satisfying a "less than" rule. */
function n(x){
  if (x === null || x === undefined || x === "") return NaN;
  const v = Number(x);
  return Number.isFinite(v) ? v : NaN;
}
function toSet(x){ return x instanceof Set ? x : new Set(x || []); }

function normalize(p){
  const v = p.v || {};
  const q = {
    name: p.name || "Unnamed patient",
    sex: p.sex || "", contact: p.contact || "Phone call",
    age: n(p.age), sev: n(p.sev), dur: n(p.dur),
    durLabel: p.durLabel || "", notes: (p.notes || "").trim(), meds: (p.meds || "").trim(),
    sym: toSet(p.sym), hx: toSet(p.hx),
    v: {temp:n(v.temp), hr:n(v.hr), sbp:n(v.sbp), dbp:n(v.dbp), rr:n(v.rr), spo2:n(v.spo2)}
  };
  q.fever = q.sym.has("fever") || q.v.temp >= 100.4;
  q.vitalsGiven = Object.values(q.v).filter(Number.isFinite).length;
  return q;
}

/* ---------- The rule book ----------
   Each rule is independent and testable. `criteria` is the plain-language form
   shown in the Protocol reference; `text` is what appears in "Why this category". */
const RULES = [
  // Warning signs
  {id:"R01", level:1, group:"Warning signs", criteria:"Face drooping, slurred speech, or sudden one-sided weakness",
   when:p => p.sym.has("stroke") || p.sym.has("weak"), text:() => "Possible stroke warning signs reported"},
  {id:"R02", level:1, group:"Warning signs", criteria:"Heavy bleeding",
   when:p => p.sym.has("bleed"), text:() => "Heavy bleeding reported"},
  {id:"R03", level:1, group:"Warning signs", criteria:"New confusion",
   when:p => p.sym.has("confused"), text:() => "New confusion reported"},
  {id:"R04", level:1, group:"Warning signs", criteria:"Chest pain with shortness of breath, age 40+, or cardiac history",
   when:p => p.sym.has("chest") && (p.sym.has("sob") || p.age >= 40 || p.hx.has("heart")),
   text:p => `Chest pain with ${p.sym.has("sob") ? "shortness of breath" : p.hx.has("heart") ? "heart disease history" : "age 40 or over"}`},
  {id:"R05", level:2, group:"Warning signs", criteria:"Chest pain without the escalating factors in R04",
   when:p => p.sym.has("chest") && !(p.sym.has("sob") || p.age >= 40 || p.hx.has("heart")), text:() => "Chest pain reported"},
  {id:"R06", level:1, group:"Warning signs", criteria:"Shortness of breath with severity 7+ or asthma/COPD",
   when:p => p.sym.has("sob") && (p.sev >= 7 || p.hx.has("lung")),
   text:p => `Shortness of breath with ${p.sev >= 7 ? "high severity" : "asthma or COPD"}`},
  {id:"R07", level:2, group:"Warning signs", criteria:"Shortness of breath without the escalating factors in R06",
   when:p => p.sym.has("sob") && !(p.sev >= 7 || p.hx.has("lung")), text:() => "Shortness of breath reported"},
  {id:"R08", level:2, group:"Warning signs", criteria:"Fainting episode",
   when:p => p.sym.has("faint"), text:() => "Fainting episode"},

  // Symptom combinations
  {id:"R09", level:2, group:"Symptom combinations", criteria:"Abdominal pain at severity 7+",
   when:p => p.sym.has("abdo") && p.sev >= 7, text:() => "Severe abdominal pain"},
  {id:"R10", level:2, group:"Symptom combinations", criteria:"Pregnancy with abdominal pain or bleeding",
   when:p => p.hx.has("preg") && (p.sym.has("abdo") || p.sym.has("bleed")), text:() => "Pregnancy with abdominal pain or bleeding"},
  {id:"R11", level:3, group:"Symptom combinations", criteria:"Vomiting and diarrhea for 3+ days",
   when:p => p.sym.has("vomit") && p.sym.has("diarrhea") && p.dur >= 3, text:() => "Vomiting and diarrhea for several days — dehydration risk"},
  {id:"R12", level:2, group:"Symptom combinations", criteria:"Vomiting with diabetes",
   when:p => p.hx.has("diabetes") && p.sym.has("vomit"), text:() => "Vomiting with diabetes"},

  // Fever
  {id:"R13", level:1, group:"Fever", criteria:"Fever in an infant under 3 months",
   when:p => p.fever && p.age < 0.25, text:() => "Fever in an infant under 3 months"},
  {id:"R14", level:2, group:"Fever", criteria:"Fever in an infant 3–12 months",
   when:p => p.fever && p.age >= 0.25 && p.age < 1, text:() => "Fever in an infant under 1 year"},
  {id:"R15", level:2, group:"Fever", criteria:"Fever at age 65 or over",
   when:p => p.fever && p.age >= 65, text:() => "Fever at age 65 or over"},
  {id:"R16", level:2, group:"Fever", criteria:"Fever with a weakened immune system",
   when:p => p.fever && p.hx.has("immuno"), text:() => "Fever with a weakened immune system"},

  // Vitals (adult thresholds)
  {id:"R17", level:1, group:"Vitals", criteria:"Oxygen saturation below 90%",
   when:p => p.v.spo2 < 90, text:p => `Oxygen saturation ${p.v.spo2}% (below 90)`},
  {id:"R18", level:2, group:"Vitals", criteria:"Oxygen saturation 90–93%",
   when:p => p.v.spo2 >= 90 && p.v.spo2 <= 93, text:p => `Oxygen saturation ${p.v.spo2}% (90–93)`},
  {id:"R19", level:1, group:"Vitals", criteria:"Heart rate above 130 or below 40 bpm",
   when:p => p.v.hr > 130 || p.v.hr < 40, text:p => `Heart rate ${p.v.hr} bpm`},
  {id:"R20", level:2, group:"Vitals", criteria:"Heart rate 111–130 or 40–49 bpm",
   when:p => (p.v.hr > 110 && p.v.hr <= 130) || (p.v.hr >= 40 && p.v.hr < 50), text:p => `Heart rate ${p.v.hr} bpm`},
  {id:"R21", level:1, group:"Vitals", criteria:"Systolic blood pressure below 90 mmHg",
   when:p => p.v.sbp < 90, text:p => `Low blood pressure (${p.v.sbp} top number)`},
  {id:"R22", level:1, group:"Vitals", criteria:"Systolic blood pressure 180 mmHg or above",
   when:p => p.v.sbp >= 180, text:p => `Very high blood pressure (${p.v.sbp} top number)`},
  {id:"R23", level:3, group:"Vitals", criteria:"Systolic blood pressure 160–179 mmHg",
   when:p => p.v.sbp >= 160 && p.v.sbp < 180, text:p => `Elevated blood pressure (${p.v.sbp} top number)`},
  {id:"R24", level:1, group:"Vitals", criteria:"Diastolic blood pressure 120 mmHg or above",
   when:p => p.v.dbp >= 120, text:p => `Very high blood pressure (${p.v.dbp} bottom number)`},
  {id:"R25", level:1, group:"Vitals", criteria:"Breathing rate above 30 or below 8 per minute",
   when:p => p.v.rr > 30 || p.v.rr < 8, text:p => `Breathing rate ${p.v.rr}/min`},
  {id:"R26", level:2, group:"Vitals", criteria:"Breathing rate 23–30 per minute",
   when:p => p.v.rr > 22 && p.v.rr <= 30, text:p => `Breathing rate ${p.v.rr}/min`},
  {id:"R27", level:1, group:"Vitals", criteria:"Temperature 104°F or higher",
   when:p => p.v.temp >= 104, text:p => `Temperature ${p.v.temp}°F (104 or higher)`},
  {id:"R28", level:1, group:"Vitals", criteria:"Temperature below 95°F",
   when:p => p.v.temp < 95, text:p => `Low body temperature ${p.v.temp}°F`},
  {id:"R29", level:2, group:"Vitals", criteria:"Temperature 103–103.9°F",
   when:p => p.v.temp >= 103 && p.v.temp < 104, text:p => `Temperature ${p.v.temp}°F`},
  {id:"R30", level:3, group:"Vitals", criteria:"Temperature 100.4–102.9°F",
   when:p => p.v.temp >= 100.4 && p.v.temp < 103, text:p => `Temperature ${p.v.temp}°F`},

  // Patient-reported severity and duration
  {id:"R31", level:2, group:"Severity & duration", criteria:"Patient-reported severity 8–10",
   when:p => p.sev >= 8, text:p => `Severity ${p.sev}/10`},
  {id:"R32", level:3, group:"Severity & duration", criteria:"Patient-reported severity 5–7",
   when:p => p.sev >= 5 && p.sev < 8, text:p => `Severity ${p.sev}/10`},
  {id:"R33", level:3, group:"Severity & duration", criteria:"Symptoms lasting more than 2 weeks",
   when:p => p.dur >= 14, text:() => "Symptoms lasting more than 1–2 weeks"}
];

/* Rules that depend on what the first pass produced. */
const DEPENDENT_RULES = [
  {id:"R34", level:3, group:"Chronic conditions", criteria:"Chronic cardiac, respiratory, or kidney condition with new symptoms and nothing already at Soon or above",
   when:(p, fired) => (p.hx.has("heart") || p.hx.has("lung") || p.hx.has("kidney")) && p.sym.size > 0 && !fired.some(x => x.level <= 3),
   text:() => "Chronic condition with new symptoms"},
  {id:"R35", level:4, group:"Baseline", criteria:"No other rule fired",
   when:(p, fired) => fired.length === 0,
   text:() => "No warning signs, mild severity, and normal or missing vitals"}
];

const ALL_RULES = [...RULES, ...DEPENDENT_RULES];

/* ---------- Triage ---------- */
function triage(patient){
  const p = normalize(patient);
  const fired = [];
  for (const rule of RULES){
    if (rule.when(p)) fired.push({id:rule.id, level:rule.level, group:rule.group, text:rule.text(p)});
  }
  for (const rule of DEPENDENT_RULES){
    if (rule.when(p, fired)) fired.push({id:rule.id, level:rule.level, group:rule.group, text:rule.text(p)});
  }
  fired.sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));

  const level = fired[0].level;
  const levels = new Set(fired.map(x => x.level));
  const flags = [];
  if (p.vitalsGiven === 0) flags.push("No vitals entered — this result is based on reported symptoms only.");
  if (level <= 2 && p.vitalsGiven === 0) flags.push("High-priority result without measurements. A clinician should confirm.");
  if (levels.size >= 3) flags.push("Signals point to several different categories. Recommend human review.");
  if (p.notes && level >= 3) flags.push("Free-text notes aren't analyzed by the rules. Read them before finalizing.");
  if (Number.isFinite(p.age) && p.age < 18) flags.push("Pediatric case — the vitals thresholds in this rule set are adult values. Clinician review recommended.");
  if (!Number.isFinite(p.age)) flags.push("Age not provided — age-based rules were skipped.");

  return {level, reasons:fired, flags};
}

/* ---------- Provider directory & routing ----------
   `open`/`close` are local clinic hours; `accepts` lists the triage levels a
   destination will take. `tags` drive specialty matching. */
const PROVIDERS = [
  {id:"ed",    name:"Emergency Department",        clinician:"ED attending on duty",  specialty:"Emergency medicine", site:"Northeast General — Main Campus", mode:"Walk-in or EMS", open:0,  close:24, accepts:[1],       tags:[]},
  {id:"uc",    name:"Riverside Urgent Care",       clinician:"Dr. A. Okafor",         specialty:"Urgent care",        site:"Riverside Clinic, Suite 200",     open:8,  close:22, accepts:[2,3],     tags:[]},
  {id:"peds",  name:"Pediatrics",                  clinician:"Dr. M. Alvarez",        specialty:"Pediatrics",         site:"Riverside Clinic, Suite 110",     open:8,  close:17, accepts:[2,3,4],   tags:["pediatric"]},
  {id:"pcp",   name:"Primary Care",                clinician:"Dr. J. Whitfield",      specialty:"Family medicine",    site:"Northeast General — Clinic B",    open:8,  close:18, accepts:[3,4],     tags:[]},
  {id:"tele",  name:"Telehealth Visit",            clinician:"Next available clinician", specialty:"Telehealth",      site:"Video visit",                     open:7,  close:21, accepts:[3,4],     tags:[]},
  {id:"nurse", name:"Nurse Advice Line",           clinician:"Triage nurse",          specialty:"Nurse triage",       site:"Phone",                           open:0,  close:24, accepts:[4],       tags:[]},
  {id:"cardio",name:"Cardiology",                  clinician:"Dr. S. Patel",          specialty:"Cardiology",         site:"Heart Center, 3rd floor",         open:9,  close:17, accepts:[2,3],     tags:["cardiac"]},
  {id:"pulm",  name:"Pulmonology",                 clinician:"Dr. R. Lindqvist",      specialty:"Pulmonology",        site:"Northeast General — Clinic D",    open:9,  close:16, accepts:[3],       tags:["respiratory"]},
  {id:"ob",    name:"Obstetrics",                  clinician:"Dr. H. Nakamura",       specialty:"Obstetrics",         site:"Women's Health, 2nd floor",       open:8,  close:17, accepts:[2,3],     tags:["obstetric"]},
  {id:"endo",  name:"Endocrinology",               clinician:"Dr. T. Brennan",        specialty:"Endocrinology",      site:"Northeast General — Clinic C",    open:9,  close:16, accepts:[3],       tags:["metabolic"]}
];
const PROVIDER_BY_ID = Object.fromEntries(PROVIDERS.map(x => [x.id, x]));

/* Which specialty tags does this patient's picture suggest, and why. */
function specialtyTags(patient){
  const p = normalize(patient);
  const out = [];
  const push = (tag, why) => out.push({tag, why});
  if (Number.isFinite(p.age) && p.age < 18) push("pediatric", "Patient is under 18");
  if (p.hx.has("preg")) push("obstetric", "Patient is currently pregnant");
  if (p.sym.has("chest") || p.hx.has("heart") || p.v.sbp >= 160 || p.v.dbp >= 120)
    push("cardiac", p.sym.has("chest") ? "Chest pain reported" : p.hx.has("heart") ? "Heart disease history" : "Elevated blood pressure");
  if (p.sym.has("sob") || p.hx.has("lung") || p.v.spo2 <= 93 || p.v.rr > 22)
    push("respiratory", p.sym.has("sob") ? "Shortness of breath reported" : p.hx.has("lung") ? "Asthma or COPD history" : "Abnormal breathing vitals");
  if (p.hx.has("diabetes") && (p.sym.has("vomit") || p.sym.has("fatigue") || p.sym.has("urine")))
    push("metabolic", "Diabetes with related symptoms");
  return out;
}

function ceilTo(ms, unit){ return Math.ceil(ms / unit) * unit; }

/* Bookable times for a provider inside the triage level's target window.
   `hoursCap` overrides the window's upper bound when nothing fits inside it. */
function slotsFor(provider, level, now, count, hoursCap){
  count = count || 4;
  const [lo, hi] = LEVELS[level].window;
  if (lo === 0 && hi === 0) return [];
  const end = now + (hoursCap === undefined ? hi : hoursCap) * 3600e3;
  const step = 45 * 60e3, out = [];
  let t = ceilTo(now + lo * 3600e3, 30 * 60e3), guard = 0;
  while (out.length < count && t <= end && guard++ < 2000){
    const d = new Date(t), h = d.getHours() + d.getMinutes() / 60;
    if (h >= provider.open && h < provider.close) out.push(t);
    t += step;
  }
  return out;
}

/* Route a triaged case to destinations, most appropriate first. */
function route(level, patient, now){
  now = now === undefined ? Date.now() : now;
  const tags = specialtyTags(patient);
  const tagSet = new Set(tags.map(t => t.tag));
  const why = Object.fromEntries(tags.map(t => [t.tag, t.why]));

  const eligible = PROVIDERS
    .filter(pr => pr.accepts.includes(level))
    .filter(pr => pr.tags.length === 0 || pr.tags.some(t => tagSet.has(t)));

  const build = (hoursCap) => eligible
    .map(pr => {
      const matched = pr.tags.filter(t => tagSet.has(t));
      return {
        id:pr.id, name:pr.name, clinician:pr.clinician, specialty:pr.specialty, site:pr.site,
        mode:level === 1 ? pr.mode : pr.id === "tele" ? "Video visit" : pr.id === "nurse" ? "Phone" : "In person",
        match:matched.length ? `Matched on ${matched.map(t => why[t] ? why[t].toLowerCase() : t).join(" and ")}` : "General availability for this category",
        priority:matched.length ? 0 : 1,
        slots:slotsFor(pr, level, now, 4, hoursCap)
      };
    })
    .filter(c => level === 1 || c.slots.length > 0)
    .sort((a, b) => a.priority - b.priority || a.slots[0] - b.slots[0] || a.name.localeCompare(b.name));

  let candidates = build(undefined), outsideWindow = false;
  if (!candidates.length){
    // Nothing bookable inside the target window (e.g. an overnight intake).
    // Widen the search to two weeks so the case always has a destination.
    candidates = build(336);
    outsideWindow = candidates.length > 0;
  }

  return {
    level,
    immediate: level === 1,
    outsideWindow,
    tags,
    candidates,
    recommended: candidates[0] || null
  };
}

/* ---------- Follow-up reminders ----------
   Anchored to the booked visit when there is one, so post-visit follow-up
   actually tracks the appointment rather than the time of intake. */
function defaultReminders(level, patient, appointment, now){
  now = now === undefined ? Date.now() : now;
  const p = normalize(patient);
  const via = (p.contact || "phone call").toLowerCase();
  const out = [];
  const at = (t, text) => { if (t > now - 60e3) out.push({text, due:Math.max(t, now)}); };

  if (level === 1){
    at(now, "Confirm patient reached emergency care");
    at(now + 4 * 3600e3, "Check ED arrival status and notify primary care");
    at(now + 24 * 3600e3, `Post-discharge follow-up ${via}`);
  } else if (appointment && appointment.at){
    const appt = appointment.at, who = appointment.clinician || appointment.name || "the provider";
    at(now + 1 * 3600e3, `Send appointment details by ${via} (${who})`);
    at(appt - 24 * 3600e3, `Appointment reminder ${via}`);
    at(appt - 2 * 3600e3, `Confirm the patient is still able to attend`);
    at(appt + 24 * 3600e3, `Post-visit follow-up ${via}: symptoms improving?`);
    if (level <= 2) at(appt + 4 * 3600e3, "Check visit outcome and whether escalation is needed");
    else at(appt + 168 * 3600e3, "Close the case or reassess if still symptomatic");
  } else if (level === 2){
    at(now + 1 * 3600e3, "Confirm urgent care or ED visit is underway");
    at(now + 24 * 3600e3, `Follow-up ${via} on visit outcome`);
    at(now + 72 * 3600e3, "Check that symptoms are improving");
  } else if (level === 3){
    at(now + 4 * 3600e3, "Book primary care or telehealth appointment");
    at(now + 24 * 3600e3, `Send appointment details by ${via}`);
    at(now + 72 * 3600e3, "Check symptoms after appointment");
  } else {
    at(now + 24 * 3600e3, `Check-in ${via}: symptoms improving?`);
    at(now + 72 * 3600e3, "Reassess if not improving — escalate if needed");
  }
  return out.sort((a, b) => a.due - b.due);
}

return {RED, COMMON, HISTORY, LABEL, LEVELS, RULES, DEPENDENT_RULES, ALL_RULES,
        PROVIDERS, PROVIDER_BY_ID, normalize, triage, specialtyTags, slotsFor, route, defaultReminders};
});
