/* Unit tests for the MedTriage AI clinical protocol.
   Run with:  node --test tests/     (from the "group project" folder)
   No dependencies — uses the built-in node:test runner. */
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../rules.js");

const HOUR = 3600e3;
/* A fixed Monday 09:00 local time, so slot assertions don't depend on when the suite runs. */
const MON_9AM = new Date(2026, 8, 28, 9, 0, 0, 0).getTime();

/* Minimal valid case: fill in only what a test cares about. */
function patient(over){
  return Object.assign({
    name:"Test patient", age:40, sex:"Female", contact:"Phone call",
    sym:[], hx:[], sev:0, dur:1, durLabel:"Today", notes:"",
    v:{temp:null, hr:null, sbp:null, dbp:null, rr:null, spo2:null}
  }, over);
}
const ids = r => r.reasons.map(x => x.id);

/* ---------------------------------------------------------------- triage */
test("a case with nothing abnormal lands on Self-care via the baseline rule", () => {
  const r = R.triage(patient());
  assert.equal(r.level, 4);
  assert.deepEqual(ids(r), ["R35"]);
});

test("the returned level is the most urgent rule that fired, not the last one", () => {
  const r = R.triage(patient({sym:["stroke", "cough"], sev:2}));
  assert.equal(r.level, 1);
  assert.equal(r.reasons[0].level, 1);
});

test("reasons are ordered most urgent first", () => {
  const r = R.triage(patient({age:58, sym:["chest", "sob"], sev:7, v:{spo2:94, hr:112, sbp:152, dbp:94, rr:24, temp:98.4}}));
  const levels = r.reasons.map(x => x.level);
  assert.deepEqual(levels, [...levels].sort((a, b) => a - b));
});

test("chest pain escalates to Emergency with a cardiac factor and stays Urgent without one", () => {
  assert.equal(R.triage(patient({age:58, sym:["chest"]})).level, 1);          // age 40+
  assert.equal(R.triage(patient({age:30, sym:["chest", "sob"]})).level, 1);   // + breathlessness
  assert.equal(R.triage(patient({age:30, sym:["chest"], hx:["heart"]})).level, 1);
  assert.equal(R.triage(patient({age:30, sym:["chest"]})).level, 2);          // none of the above
});

test("R04 and R05 are mutually exclusive — chest pain never reports two contradictory reasons", () => {
  for (const age of [20, 39, 40, 70]){
    const fired = ids(R.triage(patient({age, sym:["chest"]})));
    assert.equal(fired.includes("R04") && fired.includes("R05"), false, `both fired at age ${age}`);
  }
});

test("a blank vital never satisfies a less-than threshold", () => {
  // Guards the classic null-coercion bug: null < 95 is true in JavaScript.
  const r = R.triage(patient({v:{temp:null, hr:null, sbp:null, dbp:null, rr:null, spo2:null}}));
  assert.equal(r.level, 4);
  assert.deepEqual(ids(r), ["R35"]);
});

test("a missing age skips the age-based rules instead of treating the patient as an infant", () => {
  const r = R.triage(patient({age:null, sym:["fever"]}));
  assert.equal(ids(r).includes("R13"), false);
  assert.ok(r.flags.some(f => f.includes("Age not provided")));
});

test("fever bands by age do not overlap", () => {
  assert.deepEqual(ids(R.triage(patient({age:0.1, sym:["fever"]}))).filter(i => i[1] === "1"), ["R13"]);
  const infant = ids(R.triage(patient({age:0.5, sym:["fever"]})));
  assert.ok(infant.includes("R14") && !infant.includes("R13"));
  const elder = ids(R.triage(patient({age:70, sym:["fever"]})));
  assert.ok(elder.includes("R15") && !elder.includes("R14"));
});

test("fever is inferred from a measured temperature, not just the checkbox", () => {
  const r = R.triage(patient({age:70, sym:[], v:{temp:101.2, hr:null, sbp:null, dbp:null, rr:null, spo2:null}}));
  assert.ok(ids(r).includes("R15"), "age-65 fever rule should fire from the thermometer reading");
});

test("vitals bands are exclusive at their boundaries", () => {
  const spo2 = v => ids(R.triage(patient({v:{spo2:v, temp:null, hr:null, sbp:null, dbp:null, rr:null}})));
  assert.deepEqual(spo2(89).filter(i => i === "R17" || i === "R18"), ["R17"]);
  assert.deepEqual(spo2(90).filter(i => i === "R17" || i === "R18"), ["R18"]);
  assert.deepEqual(spo2(93).filter(i => i === "R17" || i === "R18"), ["R18"]);
  assert.deepEqual(spo2(94).filter(i => i === "R17" || i === "R18"), []);

  const hr = v => ids(R.triage(patient({v:{hr:v, temp:null, sbp:null, dbp:null, rr:null, spo2:null}})));
  assert.deepEqual(hr(131).filter(i => i === "R19" || i === "R20"), ["R19"]);
  assert.deepEqual(hr(130).filter(i => i === "R19" || i === "R20"), ["R20"]);
  assert.deepEqual(hr(39).filter(i => i === "R19" || i === "R20"), ["R19"]);
  assert.deepEqual(hr(45).filter(i => i === "R19" || i === "R20"), ["R20"]);

  const temp = v => ids(R.triage(patient({v:{temp:v, hr:null, sbp:null, dbp:null, rr:null, spo2:null}})));
  assert.deepEqual(temp(104).filter(i => i.match(/R2[789]|R30/)), ["R27"]);
  assert.deepEqual(temp(103.5).filter(i => i.match(/R2[789]|R30/)), ["R29"]);
  assert.deepEqual(temp(101).filter(i => i.match(/R2[789]|R30/)), ["R30"]);
  assert.deepEqual(temp(94).filter(i => i.match(/R2[789]|R30/)), ["R28"]);
});

test("the chronic-condition rule only fires when nothing more urgent already did", () => {
  const quiet = R.triage(patient({sym:["fatigue"], hx:["heart"], sev:1}));
  assert.ok(ids(quiet).includes("R34"), "should fire for a chronic patient with only mild new symptoms");

  const loud = R.triage(patient({sym:["fatigue"], hx:["heart"], sev:6}));
  assert.equal(ids(loud).includes("R34"), false, "should stay quiet once severity already reached Soon");
});

test("the baseline rule never fires alongside another reason", () => {
  const cases = [patient({sym:["cough"], sev:5}), patient({sym:["chest"], age:58}), patient({dur:30, sym:["back"]})];
  for (const p of cases){
    const fired = ids(R.triage(p));
    assert.equal(fired.includes("R35") && fired.length > 1, false);
  }
});

/* -------------------------------------------------------------- ambiguity */
test("a high-priority result with no measurements is flagged for human review", () => {
  const r = R.triage(patient({age:58, sym:["chest"]}));
  assert.equal(r.level, 1);
  assert.ok(r.flags.some(f => f.includes("A clinician should confirm")));
});

test("signals spread across three categories are flagged as ambiguous", () => {
  // Emergency (low SpO2) + Urgent (severity 8) + Soon (long duration) all at once.
  const r = R.triage(patient({sym:["sob", "cough"], sev:8, dur:30, v:{spo2:88, temp:101, hr:null, sbp:null, dbp:null, rr:null}}));
  assert.ok(new Set(r.reasons.map(x => x.level)).size >= 3);
  assert.ok(r.flags.some(f => f.includes("Recommend human review")));
});

test("free-text notes on a lower-priority case are flagged as unread by the rules", () => {
  const r = R.triage(patient({sym:["cough"], sev:5, notes:"Coughing up blood"}));
  assert.ok(r.level >= 3);
  assert.ok(r.flags.some(f => f.includes("Free-text notes")));
});

test("a pediatric case is flagged because the vitals thresholds are adult values", () => {
  const r = R.triage(patient({age:2, sym:["fever", "cough"], sev:5, v:{temp:103.2, hr:140, rr:30, spo2:97, sbp:null, dbp:null}}));
  assert.ok(r.flags.some(f => f.includes("Pediatric case")));
});

/* ---------------------------------------------------------------- routing */
test("an Emergency case routes to the ED with no appointment to book", () => {
  const r = R.route(1, patient({age:58, sym:["chest", "sob"]}), MON_9AM);
  assert.equal(r.immediate, true);
  assert.equal(r.recommended.id, "ed");
  assert.deepEqual(r.recommended.slots, []);
});

test("every non-emergency level gets a bookable destination", () => {
  for (const level of [2, 3, 4]){
    const r = R.route(level, patient(), MON_9AM);
    assert.ok(r.recommended, `level ${level} had no destination`);
    assert.ok(r.recommended.slots.length > 0, `level ${level} had no slots`);
  }
});

test("offered slots fall inside the triage level's target window", () => {
  for (const level of [2, 3, 4]){
    const [lo, hi] = R.LEVELS[level].window;
    for (const c of R.route(level, patient(), MON_9AM).candidates){
      for (const t of c.slots){
        assert.ok(t >= MON_9AM + lo * HOUR, `${c.name} slot too early for level ${level}`);
        assert.ok(t <= MON_9AM + hi * HOUR, `${c.name} slot too late for level ${level}`);
      }
    }
  }
});

test("offered slots fall inside the provider's own clinic hours", () => {
  for (const level of [2, 3, 4]){
    for (const c of R.route(level, patient({age:10, hx:["preg"]}), MON_9AM).candidates){
      const pr = R.PROVIDER_BY_ID[c.id];
      for (const t of c.slots){
        const h = new Date(t).getHours() + new Date(t).getMinutes() / 60;
        assert.ok(h >= pr.open && h < pr.close, `${c.name} offered ${new Date(t)} outside ${pr.open}-${pr.close}`);
      }
    }
  }
});

test("an overnight intake still gets a destination, marked as outside the target window", () => {
  const MON_3AM = new Date(2026, 8, 28, 3, 0, 0, 0).getTime();
  const r = R.route(2, patient({age:30, sym:["faint"]}), MON_3AM);
  assert.ok(r.recommended, "overnight urgent case must still have somewhere to go");
  assert.equal(r.outsideWindow, true);
  assert.ok(r.recommended.slots[0] > MON_3AM + R.LEVELS[2].window[1] * HOUR);
});

test("a pediatric case is offered Pediatrics ahead of the general clinics", () => {
  const r = R.route(3, patient({age:6, sym:["ear", "fever"]}), MON_9AM);
  assert.equal(r.recommended.id, "peds");
  assert.match(r.recommended.match, /under 18/);
});

test("a pregnant patient is offered Obstetrics", () => {
  const r = R.route(2, patient({age:28, hx:["preg"], sym:["abdo"], sev:7}), MON_9AM);
  assert.equal(r.candidates.some(c => c.id === "ob"), true);
  assert.equal(r.recommended.id, "ob");
});

test("cardiac and respiratory pictures surface the matching specialty", () => {
  const cardiac = R.route(3, patient({age:58, sym:["chest"], hx:["heart"]}), MON_9AM);
  assert.ok(cardiac.candidates.some(c => c.id === "cardio"));
  const resp = R.route(3, patient({age:45, sym:["sob"], hx:["lung"]}), MON_9AM);
  assert.ok(resp.candidates.some(c => c.id === "pulm"));
});

test("specialty clinics are not offered to patients who do not match them", () => {
  const r = R.route(3, patient({age:30, sym:["throat"]}), MON_9AM);
  for (const id of ["peds", "ob", "cardio", "pulm", "endo"])
    assert.equal(r.candidates.some(c => c.id === id), false, `${id} should not be offered`);
});

test("adults are never routed to Pediatrics", () => {
  for (const level of [2, 3, 4])
    assert.equal(R.route(level, patient({age:45, sym:["cough"]}), MON_9AM).candidates.some(c => c.id === "peds"), false);
});

/* -------------------------------------------------------------- reminders */
test("an Emergency case gets reminders anchored to the handoff, not to an appointment", () => {
  const rem = R.defaultReminders(1, patient(), null, MON_9AM);
  assert.ok(rem.length >= 3);
  assert.equal(rem[0].due, MON_9AM);
  assert.match(rem[0].text, /emergency care/i);
});

test("a booked visit produces both a pre-visit reminder and a post-visit follow-up", () => {
  const appt = {at:MON_9AM + 48 * HOUR, clinician:"Dr. J. Whitfield", name:"Primary Care"};
  const rem = R.defaultReminders(3, patient(), appt, MON_9AM);
  assert.ok(rem.some(r => r.due < appt.at && /reminder/i.test(r.text)), "missing pre-visit reminder");
  assert.ok(rem.some(r => r.due > appt.at && /post-visit/i.test(r.text)), "missing post-visit follow-up");
});

test("reminders are never scheduled in the past", () => {
  // An appointment 90 minutes out leaves no room for a 24-hour-before reminder.
  const appt = {at:MON_9AM + 1.5 * HOUR, clinician:"Dr. A. Okafor"};
  for (const r of R.defaultReminders(2, patient(), appt, MON_9AM))
    assert.ok(r.due >= MON_9AM, `${r.text} was scheduled before now`);
});

test("reminders come back in chronological order", () => {
  const appt = {at:MON_9AM + 48 * HOUR, clinician:"Dr. J. Whitfield"};
  for (const [level, a] of [[1, null], [2, appt], [3, appt], [4, null], [4, appt]]){
    const due = R.defaultReminders(level, patient(), a, MON_9AM).map(r => r.due);
    assert.deepEqual(due, [...due].sort((x, y) => x - y), `level ${level} out of order`);
  }
});

test("reminders name the patient's chosen contact channel", () => {
  const rem = R.defaultReminders(4, patient({contact:"Text message"}), null, MON_9AM);
  assert.ok(rem.some(r => r.text.includes("text message")));
});

test("every triage level produces at least two reminders", () => {
  for (const level of [1, 2, 3, 4])
    assert.ok(R.defaultReminders(level, patient(), null, MON_9AM).length >= 2, `level ${level} produced too few`);
});

/* ------------------------------------------------------- protocol integrity */
test("rule ids are unique and every rule is well formed", () => {
  const seen = new Set();
  for (const rule of R.ALL_RULES){
    assert.equal(seen.has(rule.id), false, `duplicate rule id ${rule.id}`);
    seen.add(rule.id);
    assert.ok(R.LEVELS[rule.level], `${rule.id} has an unknown level`);
    assert.equal(typeof rule.when, "function", `${rule.id} has no condition`);
    assert.ok(rule.criteria && rule.group, `${rule.id} is missing documentation`);
  }
});

test("every provider accepts only known levels and has sane clinic hours", () => {
  for (const pr of R.PROVIDERS){
    assert.ok(pr.accepts.length > 0, `${pr.id} accepts nothing`);
    for (const l of pr.accepts) assert.ok(R.LEVELS[l], `${pr.id} accepts unknown level ${l}`);
    assert.ok(pr.open >= 0 && pr.close <= 24 && pr.open < pr.close, `${pr.id} has impossible hours`);
  }
});

test("the three demo cases triage to the categories the walkthrough expects", () => {
  const chest = R.triage(patient({name:"Patient A-102", age:58, sex:"Male", sym:["chest", "sob"], sev:7, dur:0.1,
    v:{temp:98.4, hr:112, sbp:152, dbp:94, rr:24, spo2:94}, hx:["htn", "diabetes"]}));
  assert.equal(chest.level, 1);

  const cold = R.triage(patient({name:"Patient C-315", age:29, sex:"Female", sym:["nose", "throat", "cough"], sev:2, dur:3,
    v:{temp:99.1, hr:76, sbp:118, dbp:76, rr:14, spo2:99}, hx:["none"]}));
  assert.equal(cold.level, 4);
});

/* KNOWN LIMITATION — this is the demo's reviewer-override case.
   The vitals rules carry adult thresholds. A heart rate of 140 is normal for a
   two-year-old but trips R19 (>130 bpm), so the toddler case escalates to
   Emergency on a vital sign that is not actually abnormal for their age.
   The protocol does not guess: it raises the category, states which rule did it,
   and flags the case as pediatric so a reviewer can override it down to Urgent.
   This test pins that behaviour so the team notices if the rule set changes. */
test("the toddler demo case over-escalates on an adult heart-rate threshold, and says so", () => {
  const child = R.triage(patient({name:"Patient B-207", age:2, sex:"Female", sym:["fever", "cough", "ear"], sev:5, dur:1,
    v:{temp:103.2, hr:140, sbp:null, dbp:null, rr:30, spo2:97}, hx:["none"]}));

  assert.equal(child.level, 1, "adult tachycardia rule drives this case to Emergency");
  const hr = child.reasons.find(r => r.id === "R19");
  assert.ok(hr && hr.text.includes("140"), "the escalating vital must be named in the reasons");
  assert.ok(child.flags.some(f => f.includes("Pediatric case")), "the pediatric caveat must be shown");
  assert.ok(child.flags.some(f => f.includes("Recommend human review")), "conflicting categories must be flagged");

  // Everything below Emergency still points at Urgent, which is where a reviewer would land it.
  assert.equal(Math.min(...child.reasons.filter(r => r.id !== "R19").map(r => r.level)), 2);
});
