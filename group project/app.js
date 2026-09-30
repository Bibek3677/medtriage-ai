/* MedTriage AI — UI layer. All clinical logic lives in rules.js. */
(function(){
const R = window.MedTriageRules;
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const {LEVELS, LABEL} = R;

const STEPS = [
  {t:"Patient intake", s:"Who the patient is"},
  {t:"Symptom review", s:"What they're experiencing"},
  {t:"Vitals & history", s:"Measurements and conditions"},
  {t:"Triage assessment", s:"Category and why"},
  {t:"Provider & appointment", s:"Where the case goes"},
  {t:"Follow-up", s:"Reminders and handoff"}
];
const LAST = STEPS.length - 1;

let step = 0, maxStep = 0;
let result = null, override = null;
let routing = null, appointment = null, noAppt = false;
let reminders = [], remKey = null;

/* ---------- Build the symptom / history pickers ---------- */
function chips(el, list, name){
  el.innerHTML = list.map(([v,l]) => `<label class="chip"><input type="checkbox" name="${name}" value="${v}"><span>${l}</span></label>`).join("");
}
chips($("#chips-red"), R.RED, "sym"); chips($("#chips-common"), R.COMMON, "sym"); chips($("#chips-history"), R.HISTORY, "hx");
$$('input[name=hx]').forEach(cb => cb.addEventListener("change", () => {
  if (cb.value === "none" && cb.checked) $$('input[name=hx]').forEach(o => { if (o !== cb) o.checked = false; });
  else if (cb.checked) $('input[name=hx][value=none]').checked = false;
}));
$("#sev").addEventListener("input", e => $("#sev-out").textContent = e.target.value);

/* ---------- Stepper ---------- */
function renderSteps(){
  $("#steps").innerHTML = STEPS.map((s,i) => `<li><button class="step-btn ${i<step?'done':''}" data-go="${i}" ${i>maxStep?'disabled':''} ${i===step?'aria-current="step"':''}>
    <span class="step-num">${i<step?'✓':i+1}</span><span class="step-txt"><strong>${s.t}</strong><span>${s.s}</span></span></button></li>`).join("");
}
$("#steps").addEventListener("click", e => { const b = e.target.closest("[data-go]"); if (b && !b.disabled) go(+b.dataset.go); });

function go(n){
  step = n; maxStep = Math.max(maxStep, n);
  $$(".step").forEach(el => el.classList.toggle("hidden", +el.dataset.step !== n));
  $("#back").style.visibility = n === 0 ? "hidden" : "visible";
  $("#next").textContent = n === 2 ? "Run triage" : n === 3 ? "Route to provider" : n === LAST ? "Save to care queue" : "Continue";
  $("#copy").classList.toggle("hidden", n < 3);
  if (n === 3) renderResult(true);
  if (n === 4) renderRouting();
  if (n === LAST){ ensureReminders(); renderReminders(); }
  renderSteps();
  const panel = $(".panel"); if (panel.getBoundingClientRect().top < 0) panel.scrollIntoView({behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto":"smooth"});
  const h = $(`.step[data-step="${n}"] h2`); h.setAttribute("tabindex","-1"); h.focus({preventScroll:true});
}

/* ---------- Validation ---------- */
function setErr(id, msg){
  const f = $(id).closest(".field"); f.classList.toggle("invalid", !!msg); f.querySelector(".err").textContent = msg || "";
  return !msg;
}
function num(id){ const v = $(id).value.trim(); return v === "" ? null : Number(v); }
function validate(n){
  let ok = true;
  if (n === 0){
    const age = num("#p-age");
    ok &= setErr("#p-age", age === null ? "Enter the patient's age." : (age < 0 || age > 120) ? "Enter an age between 0 and 120." : "");
    ok &= setErr("#p-sex", $("#p-sex").value ? "" : "Select an option.");
  }
  if (n === 1){
    const any = $$('input[name=sym]:checked').length || $("#notes").value.trim();
    $("#sym-err").textContent = any ? "" : "Select at least one symptom, or describe it in the notes.";
    ok &= !!any;
    ok &= setErr("#dur", $("#dur").value ? "" : "Select when it started.");
  }
  if (n === 2){
    const RANGES = {"#v-temp":[86,110],"#v-hr":[20,250],"#v-sbp":[50,260],"#v-dbp":[20,160],"#v-rr":[4,60],"#v-spo2":[50,100]};
    for (const [id,[lo,hi]] of Object.entries(RANGES)){
      const v = num(id); ok &= setErr(id, v !== null && (isNaN(v) || v < lo || v > hi) ? `Check this value (expected ${lo}–${hi}).` : "");
    }
  }
  if (n === 4){
    const missing = !appointment && !noAppt;
    $("#rt-err").textContent = missing ? (effLevel() === 4 ? "Pick a time, or choose “No appointment”." : "Choose an appointment time to continue.") : "";
    if (missing){ const first = $("#rt-list input[name=slot]"); if (first) first.focus(); }
    ok &= !missing;
  }
  if (!ok){ const bad = $(`.step[data-step="${n}"] .invalid input, .step[data-step="${n}"] .invalid select`); if (bad) bad.focus(); }
  return !!ok;
}

/* ---------- Collect the case ---------- */
function collect(){
  return {
    name: $("#p-name").value.trim() || "Unnamed patient",
    age: num("#p-age"), sex: $("#p-sex").value, contact: $("#p-contact").value,
    sym: $$('input[name=sym]:checked').map(c => c.value),
    hx: $$('input[name=hx]:checked').map(c => c.value),
    sev: +$("#sev").value, dur: +$("#dur").value, durLabel: $("#dur").selectedOptions[0].text,
    notes: $("#notes").value.trim(), meds: $("#meds").value.trim(),
    v: {temp:num("#v-temp"), hr:num("#v-hr"), sbp:num("#v-sbp"), dbp:num("#v-dbp"), rr:num("#v-rr"), spo2:num("#v-spo2")}
  };
}

/* ---------- Step 4: triage result ---------- */
function effLevel(){ return override ? override.level : result.level; }
function renderResult(fresh){
  const p = collect();
  if (fresh){ result = R.triage(p); override = null; $("#ov-level").value = ""; }
  const L = effLevel(), info = LEVELS[L];
  const tag = $("#tag");
  tag.className = `tag t${L}` + (fresh ? " pop" : "");
  tag.innerHTML = `<div class="tag-head"><div class="tag-level">${info.name}</div><div class="tag-sub">${info.sub}</div></div>
    <div class="tag-strip" aria-hidden="true">${[1,2,3,4].map(i=>`<i class="${i===L?'on':''}" style="background:var(--t${i})"></i>`).join("")}</div>
    <div class="tag-body"><dl>
      <dt>Patient</dt><dd>${esc(p.name)}</dd>
      <dt>Age / sex</dt><dd>${fmtAge(p.age)} · ${esc(p.sex)}</dd>
      <dt>Started</dt><dd>${esc(p.durLabel)}</dd>
      <dt>Severity</dt><dd>${p.sev}/10</dd>
      ${override ? `<dt>Override</dt><dd>${esc(override.by)}</dd>` : ""}
    </dl></div>`;
  if (fresh) setTimeout(() => tag.classList.remove("pop"), 500);
  $("#route").className = `route t${L}`;
  $("#route").innerHTML = `<h3>${esc(info.route)}</h3><p>${esc(info.detail)}</p>`;
  $("#flags").innerHTML = result.flags.length ? `<div class="flag"><strong>Needs a closer look</strong><ul style="margin:6px 0 0;padding-left:20px">${result.flags.map(f=>`<li>${esc(f)}</li>`).join("")}</ul></div>` : "";
  $("#why").innerHTML = result.reasons.map(x => `<li><i class="dot" style="--dc:var(--t${x.level})"></i><span>${esc(x.text)}</span><small class="mono">${x.id}</small><small>${LEVELS[x.level].name}</small></li>`).join("");
  $("#ov-note").textContent = override ? `Changed from ${LEVELS[result.level].name} to ${LEVELS[override.level].name} by ${override.by}: “${override.reason}”` : "";
}
$("#ov-apply").addEventListener("click", () => {
  const lvl = $("#ov-level").value;
  if (!lvl){
    if (!override) return;
    override = null; appointment = null; noAppt = false; renderResult(false); toast("Override removed"); return;
  }
  const ok1 = setErr("#ov-by", $("#ov-by").value.trim() ? "" : "Enter reviewer initials.");
  const ok2 = setErr("#ov-reason", $("#ov-reason").value.trim() ? "" : "Give a reason for the change.");
  if (!ok1 || !ok2) return;
  override = {level:+lvl, by:$("#ov-by").value.trim().toUpperCase(), reason:$("#ov-reason").value.trim(), at:Date.now()};
  appointment = null; noAppt = false;               // a new category needs a new destination
  renderResult(false);
  toast(`Category changed to ${LEVELS[+lvl].name}`);
});

/* ---------- Step 5: provider routing & scheduling ---------- */
function renderRouting(){
  const p = collect(), L = effLevel(), info = LEVELS[L];
  routing = R.route(L, p);

  // Drop a previously chosen slot if this routing no longer offers it.
  if (appointment && !appointment.immediate){
    const c = routing.candidates.find(x => x.id === appointment.providerId);
    if (!c || !c.slots.includes(appointment.at)) appointment = null;
  }
  if (routing.immediate && routing.recommended) appointment = apptFrom(routing.recommended, null);
  if (!routing.candidates.length) noAppt = true;

  $("#rt-lede").textContent = routing.immediate
    ? "Emergency cases are handed off immediately rather than scheduled. Confirm the destination and continue."
    : `Destinations that accept this ${info.name.toLowerCase()} case. Every time shown falls inside the ${info.target} booking target.`;

  const notes = [];
  if (routing.outsideWindow) notes.push(`<div class="flag"><strong>Outside the booking target</strong><p>Nothing is open inside the ${esc(info.target)} target for this category. The earliest times below fall outside it — consider urgent care or the ED if the patient can't wait.</p></div>`);
  if (!routing.candidates.length) notes.push(`<div class="flag"><strong>No destination available</strong><p>No provider in the directory accepts this category right now. Continue and record the case for manual routing.</p></div>`);
  $("#rt-window").innerHTML = notes.join("");

  $("#rt-tags").innerHTML = routing.tags.length
    ? `<p class="group-title">Specialty signals picked up from this case</p><div class="chips static">${routing.tags.map(t=>`<span class="chip-static">${esc(cap(t.tag))}<small> — ${esc(t.why)}</small></span>`).join("")}</div>`
    : "";

  $("#rt-list").innerHTML = routing.candidates.map((c,i) => `
    <article class="prov">
      <div class="prov-head">
        <h3>${esc(c.name)}</h3>
        ${i === 0 ? `<span class="badge">${c.priority === 0 ? "Best specialty match" : "Recommended"}</span>` : ""}
      </div>
      <p class="q-meta">${esc(c.specialty)} · ${esc(c.clinician)}</p>
      <p class="q-meta">${esc(c.site)} · ${esc(c.mode)}</p>
      <p class="prov-match">${esc(c.match)}</p>
      ${routing.immediate
        ? `<p class="prov-now"><strong>Immediate handoff</strong> — no appointment is booked.</p>`
        : `<div class="slots" role="group" aria-label="Available times at ${esc(c.name)}">${c.slots.map(t =>
            `<label class="slot"><input type="radio" name="slot" value="${c.id}|${t}" ${appointment && appointment.providerId === c.id && appointment.at === t ? "checked" : ""}><span>${fmtSlot(t)}</span></label>`).join("")}</div>`}
    </article>`).join("")
    + (!routing.immediate && L === 4
        ? `<label class="slot no-appt"><input type="radio" name="slot" value="none" ${noAppt ? "checked" : ""}><span>No appointment — self-care with reminders only</span></label>` : "");

  updateBooked();
}
function apptFrom(c, at){
  return {providerId:c.id, name:c.name, clinician:c.clinician, specialty:c.specialty, site:c.site, mode:c.mode, at, immediate:at === null};
}
function updateBooked(){
  const el = $("#rt-booked");
  if (!appointment) el.textContent = noAppt ? "No appointment — this case will be followed up by reminders only." : "";
  else if (appointment.immediate) el.textContent = `Handoff recorded: ${appointment.name} — ${appointment.site} (${appointment.mode}).`;
  else el.textContent = `Booked: ${appointment.name} with ${appointment.clinician}, ${fmtSlot(appointment.at)} — ${appointment.site}.`;
}
$("#rt-list").addEventListener("change", e => {
  if (e.target.name !== "slot") return;
  if (e.target.value === "none"){ appointment = null; noAppt = true; }
  else {
    const [id, ts] = e.target.value.split("|");
    const c = routing.candidates.find(x => x.id === id);
    if (!c) return;
    appointment = apptFrom(c, +ts); noAppt = false;
  }
  $("#rt-err").textContent = "";
  updateBooked();
});

/* ---------- Step 6: reminders ---------- */
function ensureReminders(){
  const key = `${effLevel()}|${appointment ? appointment.providerId + ":" + appointment.at : "none"}`;
  if (key === remKey) return;                       // keep the reviewer's edits
  remKey = key;
  reminders = R.defaultReminders(effLevel(), collect(), appointment)
    .map(r => ({id:uid(), text:r.text, due:r.due, done:false}));
}
function renderReminders(){
  const L = effLevel();
  $("#fu-lede").textContent = appointment && appointment.at
    ? `Suggested for this ${LEVELS[L].name.toLowerCase()} case, anchored to the visit booked ${fmtSlot(appointment.at)}. Edit them, then save the case to the care queue.`
    : `Suggested for this ${LEVELS[L].name.toLowerCase()} case. Edit them, then save the case to the care queue.`;
  $("#rem-list").innerHTML = reminders.length ? reminders.map(r => `<li class="rem"><input type="checkbox" id="r-${r.id}" data-id="${r.id}" ${r.done?'checked':''}>
    <label for="r-${r.id}"><div>${esc(r.text)}</div><div class="when">${fmtDue(r.due)}</div></label>
    <button class="btn small ghost rm" data-rm="${r.id}" aria-label="Remove reminder: ${esc(r.text)}">Remove</button></li>`).join("")
    : `<li class="rem"><span class="q-meta">No reminders yet. Add one below so this case doesn't fall through the cracks.</span></li>`;
}
$("#rem-list").addEventListener("change", e => { const r = reminders.find(x => x.id === e.target.dataset.id); if (r) r.done = e.target.checked; });
$("#rem-list").addEventListener("click", e => { const id = e.target.dataset.rm; if (id){ reminders = reminders.filter(x => x.id !== id); renderReminders(); } });
$("#rem-add").addEventListener("click", () => {
  const t = $("#rem-text").value.trim(); if (!t){ $("#rem-text").focus(); return; }
  reminders.push({id:uid(), text:t, due:Date.now()+(+$("#rem-when").value)*3600e3, done:false});
  reminders.sort((a,b)=>a.due-b.due); $("#rem-text").value = ""; renderReminders();
});
$("#rem-text").addEventListener("keydown", e => { if (e.key === "Enter"){ e.preventDefault(); $("#rem-add").click(); } });

/* ---------- Care queue (localStorage) ---------- */
const KEY = "medtriage-queue-v2";
function loadQ(){ try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch(e){ return []; } }
function saveQ(q){ try { localStorage.setItem(KEY, JSON.stringify(q)); } catch(e){ toast("Couldn't save — browser storage is unavailable"); } }
let queue = loadQ();

function saveCase(){
  const p = collect();
  queue.push({
    id:uid(), at:Date.now(), name:p.name, age:p.age, sex:p.sex, contact:p.contact,
    level:effLevel(), assessed:result.level, override,
    reasons:result.reasons, flags:result.flags,
    sym:p.sym.map(k=>LABEL[k]), hx:p.hx.map(k=>LABEL[k]),
    sev:p.sev, durLabel:p.durLabel, notes:p.notes, meds:p.meds, v:p.v,
    appointment, reminders
  });
  saveQ(queue); renderQueue(); resetForm(); showView("queue"); toast("Saved to care queue");
}
function renderQueue(){
  $("#qcount").textContent = queue.length;
  const q = [...queue].sort((a,b) => a.level - b.level || apptTime(a) - apptTime(b) || a.at - b.at);
  if (!q.length){
    $("#queue").innerHTML = `<div class="q-empty panel"><p>No cases in the queue. Complete an intake to add one.</p><button class="btn primary" id="q-start">Start an intake</button></div>`;
    $("#q-start").onclick = () => showView("intake"); return;
  }
  $("#queue").innerHTML = q.map(c => {
    const open = c.reminders.filter(r=>!r.done).sort((a,b)=>a.due-b.due), next = open[0];
    const vit = Object.entries({Temp:[c.v.temp,"°F"],HR:[c.v.hr," bpm"],BP:[c.v.sbp!==null?`${c.v.sbp}/${c.v.dbp??"–"}`:null,""],RR:[c.v.rr,"/min"],SpO2:[c.v.spo2,"%"]})
      .filter(([,x])=>x[0]!==null && x[0]!==undefined).map(([k,x])=>`${k} ${x[0]}${x[1]}`).join(", ") || "None entered";
    const a = c.appointment;
    const apptLine = !a ? "No appointment booked"
      : a.immediate ? `${a.name} — ${a.mode}`
      : `${a.name} · ${fmtSlot(a.at)}`;
    return `<article class="q-item t${c.level}">
      <div class="q-bar"></div>
      <div class="q-main"><h3>${esc(c.name)}</h3>
        <p class="q-meta">${fmtAge(c.age)} · ${esc(c.sex)} · added ${new Date(c.at).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}</p>
        <p>${esc(c.reasons.length ? c.reasons[0].text : "—")}</p>
        <p class="q-appt">${esc(apptLine)}</p>
        <p class="q-meta">${next ? `Next: ${esc(next.text)} (${fmtDue(next.due)})` : "All reminders done"}</p></div>
      <div class="q-side"><span class="pill t${c.level}">${LEVELS[c.level].name}</span>${c.override?`<span class="q-meta">Overridden by ${esc(c.override.by)}</span>`:""}
        <button class="btn small ghost" data-del="${c.id}" aria-label="Remove ${esc(c.name)} from queue">Remove</button></div>
      <details><summary>Case details</summary>
        <p style="margin-top:8px"><strong>Route:</strong> ${esc(LEVELS[c.level].route)}</p>
        <p><strong>Appointment:</strong> ${a ? `${esc(a.name)} — ${esc(a.specialty)}, ${esc(a.clinician)} · ${esc(a.site)} · ${esc(a.mode)}${a.at?` · ${fmtSlot(a.at)}`:""}` : "None booked"}</p>
        <p><strong>Symptoms:</strong> ${esc(c.sym.join(", ") || "—")} · severity ${c.sev}/10 · ${esc(c.durLabel)}</p>
        <p><strong>Vitals:</strong> ${esc(vit)}</p>
        <p><strong>History:</strong> ${esc(c.hx.join(", ") || "Not recorded")}</p>
        ${c.meds?`<p><strong>Medications / allergies:</strong> ${esc(c.meds)}</p>`:""}
        ${c.notes?`<p><strong>Notes:</strong> ${esc(c.notes)}</p>`:""}
        ${c.override?`<p><strong>Override:</strong> ${esc(LEVELS[c.assessed].name)} → ${esc(LEVELS[c.level].name)}, “${esc(c.override.reason)}”</p>`:""}
        <p style="margin-top:6px"><strong>Rules that fired:</strong></p><ul>${c.reasons.map(r=>`<li><span class="mono">${esc(r.id||"—")}</span> ${esc(r.text)} (${esc(LEVELS[r.level].name)})</li>`).join("")}</ul>
        ${c.flags && c.flags.length?`<p style="margin-top:6px"><strong>Review flags:</strong></p><ul>${c.flags.map(f=>`<li>${esc(f)}</li>`).join("")}</ul>`:""}
        <p style="margin-top:6px"><strong>Reminders:</strong></p><ul>${c.reminders.map(r=>`<li>${r.done?"✓ ":""}${esc(r.text)} — ${fmtDue(r.due)}</li>`).join("") || "<li>None</li>"}</ul>
      </details></article>`;
  }).join("") + `<div class="q-tools"><button class="btn small ghost" id="q-export">Export JSON</button><button class="btn small ghost" id="q-clear">Clear queue</button></div>`;
  $("#q-clear").onclick = () => { if (confirm("Remove all cases from the queue?")){ queue = []; saveQ(queue); renderQueue(); } };
  $("#q-export").onclick = exportQueue;
}
function apptTime(c){ return c.appointment && c.appointment.at ? c.appointment.at : Infinity; }
$("#queue").addEventListener("click", e => { const id = e.target.dataset.del; if (id){ queue = queue.filter(c => c.id !== id); saveQ(queue); renderQueue(); toast("Case removed"); } });

function exportQueue(){
  const blob = new Blob([JSON.stringify({exported:new Date().toISOString(), source:"MedTriage AI prototype", cases:queue}, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = `medtriage-queue-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Exported ${queue.length} case${queue.length === 1 ? "" : "s"}`);
}

/* ---------- Protocol reference ---------- */
let protoDrawn = false;
function renderProtocol(){
  if (protoDrawn) return; protoDrawn = true;
  $("#proto-levels").innerHTML = [1,2,3,4].map(L => {
    const i = LEVELS[L];
    return `<div class="cat t${L}"><div class="cat-bar"></div><div class="cat-body">
      <strong>${esc(i.name)}</strong><p class="q-meta">${esc(i.sub)}</p><p>${esc(i.route)}</p>
      <p class="q-meta">Booking target: ${i.window[1] === 0 ? "immediate handoff, no appointment" : `${esc(i.target)}s from intake`}</p>
    </div></div>`;
  }).join("");

  const groups = new Map();
  R.ALL_RULES.forEach(r => { if (!groups.has(r.group)) groups.set(r.group, []); groups.get(r.group).push(r); });
  $("#proto-rules").innerHTML = [...groups].map(([g, rs]) => `
    <h4 class="grp">${esc(g)}</h4>
    <div class="table-scroll"><table class="tbl">
      <thead><tr><th>Rule</th><th>Category</th><th>Fires when</th></tr></thead>
      <tbody>${rs.map(r => `<tr><td class="mono">${esc(r.id)}</td><td><span class="pill t${r.level}">${esc(LEVELS[r.level].name)}</span></td><td>${esc(r.criteria)}</td></tr>`).join("")}</tbody>
    </table></div>`).join("");

  $("#proto-providers").innerHTML = `<thead><tr><th>Destination</th><th>Specialty</th><th>Clinician</th><th>Location</th><th>Hours</th><th>Accepts</th></tr></thead>
    <tbody>${R.PROVIDERS.map(p => `<tr><td><strong>${esc(p.name)}</strong></td><td>${esc(p.specialty)}</td><td>${esc(p.clinician)}</td><td>${esc(p.site)}</td>
      <td class="mono">${p.open === 0 && p.close === 24 ? "24/7" : `${p.open}:00–${p.close}:00`}</td>
      <td>${p.accepts.map(l => `<span class="pill t${l}">${esc(LEVELS[l].name)}</span>`).join(" ")}</td></tr>`).join("")}</tbody>`;
}

/* ---------- Navigation ---------- */
$("#next").addEventListener("click", () => {
  if (!validate(step)) return;
  if (step === LAST) return saveCase();
  go(step + 1);
});
$("#back").addEventListener("click", () => go(Math.max(0, step - 1)));

const VIEWS = ["intake","queue","protocol"];
function showView(v){
  VIEWS.forEach(name => {
    $(`#view-${name}`).classList.toggle("hidden", name !== v);
    const t = $(`#tab-${name}`);
    t.setAttribute("aria-selected", String(name === v));
    t.tabIndex = name === v ? 0 : -1;
  });
  if (v === "protocol") renderProtocol();
}
$(".tabs").addEventListener("click", e => { const b = e.target.closest(".tab"); if (b) showView(b.id.slice(4)); });
$(".tabs").addEventListener("keydown", e => {
  const cur = VIEWS.indexOf((document.activeElement.id || "").slice(4));
  if (cur < 0) return;
  let i = null;
  if (e.key === "ArrowRight") i = (cur + 1) % VIEWS.length;
  else if (e.key === "ArrowLeft") i = (cur - 1 + VIEWS.length) % VIEWS.length;
  else if (e.key === "Home") i = 0;
  else if (e.key === "End") i = VIEWS.length - 1;
  if (i === null) return;
  e.preventDefault(); showView(VIEWS[i]); $(`#tab-${VIEWS[i]}`).focus();
});

$("#copy").addEventListener("click", async () => {
  const p = collect(), L = effLevel(), a = appointment;
  const txt = [`MedTriage AI summary (educational prototype)`,
    `Patient: ${p.name}, ${fmtAge(p.age)}, ${p.sex}`,
    `Category: ${LEVELS[L].name} — ${LEVELS[L].route}`,
    override ? `Override by ${override.by}: ${override.reason}` : "",
    `Symptoms: ${p.sym.map(k=>LABEL[k]).join(", ")||"—"}; severity ${p.sev}/10; ${p.durLabel}`,
    a ? `Destination: ${a.name} (${a.specialty}, ${a.clinician}) — ${a.site}${a.at ? `, ${fmtSlot(a.at)}` : ` — ${a.mode}`}` : "Destination: not yet routed",
    `Reasons: ${result.reasons.map(r=>`${r.id} ${r.text}`).join("; ")}`,
    result.flags.length ? `Review flags: ${result.flags.join(" ")}` : ""
  ].filter(Boolean).join("\n");
  try { await navigator.clipboard.writeText(txt); toast("Summary copied"); } catch(e){ toast("Copy isn't available in this browser"); }
});

/* ---------- Samples & reset ---------- */
const SAMPLES = {
  chest:{name:"Patient A-102",age:58,sex:"Male",sym:["chest","sob"],sev:7,dur:"0.1",v:{temp:98.4,hr:112,sbp:152,dbp:94,rr:24,spo2:94},hx:["htn","diabetes"],notes:"Pressure in chest, started while climbing stairs."},
  child:{name:"Patient B-207",age:2,sex:"Female",sym:["fever","cough","ear"],sev:5,dur:"1",v:{temp:103.2,hr:140,sbp:"",dbp:"",rr:30,spo2:97},hx:["none"],notes:"Parent reports child is irritable and pulling at ear."},
  cold:{name:"Patient C-315",age:29,sex:"Female",sym:["nose","throat","cough"],sev:2,dur:"3",v:{temp:99.1,hr:76,sbp:118,dbp:76,rr:14,spo2:99},hx:["none"],notes:""}
};
$$("[data-sample]").forEach(b => b.addEventListener("click", () => {
  resetForm(); const s = SAMPLES[b.dataset.sample];
  $("#p-name").value = s.name; $("#p-age").value = s.age; $("#p-sex").value = s.sex;
  s.sym.forEach(k => $(`input[name=sym][value=${k}]`).checked = true);
  s.hx.forEach(k => $(`input[name=hx][value=${k}]`).checked = true);
  $("#sev").value = s.sev; $("#sev-out").textContent = s.sev; $("#dur").value = s.dur; $("#notes").value = s.notes;
  const map = {temp:"#v-temp",hr:"#v-hr",sbp:"#v-sbp",dbp:"#v-dbp",rr:"#v-rr",spo2:"#v-spo2"};
  for (const k in map) $(map[k]).value = s.v[k] ?? "";
  maxStep = 3; showView("intake"); go(3); toast("Sample case loaded");
}));
function resetForm(){
  $$(".step input:not([type=range]):not([type=checkbox]), .step textarea").forEach(i => i.value = "");
  $$(".step select").forEach(s => s.selectedIndex = 0);
  $$(".step input[type=checkbox]").forEach(c => c.checked = false);
  $$(".field.invalid").forEach(f => { f.classList.remove("invalid"); f.querySelector(".err").textContent = ""; });
  $("#sym-err").textContent = ""; $("#rt-err").textContent = ""; $("#rt-booked").textContent = "";
  $("#sev").value = 3; $("#sev-out").textContent = 3; $("#override").open = false; $("#ov-note").textContent = "";
  result = null; override = null; routing = null; appointment = null; noAppt = false;
  reminders = []; remKey = null; maxStep = 0; go(0);
}

/* ---------- Theme ---------- */
let theme = null; try { theme = localStorage.getItem("medtriage-theme"); } catch(e){}
function applyTheme(t){
  if (t) document.documentElement.setAttribute("data-theme", t);
  else document.documentElement.removeAttribute("data-theme");
  const dark = t === "dark" || (!t && matchMedia("(prefers-color-scheme: dark)").matches);
  $("#theme").setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  $("#theme-icon").textContent = dark ? "☀" : "☾";
}
applyTheme(theme);
$("#theme").addEventListener("click", () => {
  const dark = theme === "dark" || (!theme && matchMedia("(prefers-color-scheme: dark)").matches);
  theme = dark ? "light" : "dark"; applyTheme(theme);
  try { localStorage.setItem("medtriage-theme", theme); } catch(e){}
});

/* ---------- Utils ---------- */
function esc(s){ return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function uid(){ return Math.random().toString(36).slice(2,10); }
function cap(s){ return String(s).charAt(0).toUpperCase() + String(s).slice(1); }
function fmtAge(a){ if (a === null || a === undefined) return "—"; return a < 1 ? `${Math.round(a*12)} mo` : `${Math.round(a)} yr`; }
function fmtSlot(t){
  const d = new Date(t), today = new Date();
  const time = d.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
  const sameDay = d.toDateString() === today.toDateString();
  const tomorrow = new Date(today.getTime() + 864e5).toDateString() === d.toDateString();
  return `${sameDay ? "Today" : tomorrow ? "Tomorrow" : d.toLocaleDateString([], {weekday:"short", month:"short", day:"numeric"})} · ${time}`;
}
function fmtDue(t){
  const d = t - Date.now(), h = Math.round(d/3600e3);
  if (d < 5*60e3) return "Now";
  if (h < 1) return `In ${Math.round(d/60e3)} min`;
  if (h < 24) return `In ${h} hr`;
  return new Date(t).toLocaleDateString([], {weekday:"short", month:"short", day:"numeric"});
}
let tt; function toast(m){ const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(tt); tt = setTimeout(()=>t.classList.remove("show"), 2200); }

renderQueue(); go(0);
})();
