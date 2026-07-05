/* ============================================================
   AIIMS CRE 2026 — Application Logic (v3 — Gemini + Claude)
   Supports: Gemini 3.1 Pro (Google) & Claude Sonnet 4.6 (Replicate)
   ============================================================ */

'use strict';

// ── API Bases — local proxy (server.js)
const REPLICATE_API = '/replicate/v1';
const GEMINI_API    = '/gemini/v1beta';

// ── State ──────────────────────────────────────────────────
const State = {
  provider: 'gemini',   // 'gemini' or 'replicate'
  geminiModel: 'gemini-3.5-flash', // default Gemini model
  apiKey: '',           // Replicate key
  geminiKey: '',        // Gemini key
  examConfig: {
    mode: 'full',
    subjects: [],
    questionCount: 100,
    difficulty: 'Mixed',
  },
  questions: [],
  userAnswers: {},     // { qIndex: 'A'|'B'|'C'|'D' }
  markedForReview: new Set(),
  currentIndex: 0,
  timerInterval: null,
  timeLeft: 0,
  totalTimeSecs: 0,    // needed for ring calc
  examStarted: false,
  examSubmitted: false,
};

// ── Subjects Master List ────────────────────────────────────
const SUBJECTS = [
  { id: 'pharmacology',      label: 'Pharmacology',                  icon: '💊' },
  { id: 'pharmaceutics',     label: 'Pharmaceutics',                 icon: '⚗️'  },
  { id: 'pharmacy_practice', label: 'Pharmacy Practice',             icon: '🏥' },
  { id: 'pharmacognosy',     label: 'Pharmacognosy',                 icon: '🌿' },
  { id: 'biochemistry',      label: 'Biochemistry',                  icon: '🧬' },
  { id: 'anatomy_physio',    label: 'Anatomy & Physiology',          icon: '🫀' },
  { id: 'hospital_pharmacy', label: 'Hospital & Clinical Pharmacy',  icon: '🏨' },
  { id: 'drug_store',        label: 'Drug Store Management',         icon: '📦' },
];

// ── DOM Helpers ─────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);
const create = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
};

// Safe event binding — never crashes if element missing
function on(idOrEl, event, handler) {
  const el = typeof idOrEl === 'string' ? $(idOrEl) : idOrEl;
  if (el) el.addEventListener(event, handler);
}

// ── Screen Navigation ───────────────────────────────────────
function showScreen(id) {
  console.log('[NAV] showScreen →', id);

  // 1) Hide every screen
  $$('.screen').forEach(s => {
    s.classList.remove('active');
    s.style.cssText = 'display:none !important; opacity:0;';
  });

  // 2) Show the target
  const target = $(id);
  if (!target) { console.error('[NAV] element not found:', id); return; }
  target.style.cssText = 'display:flex !important; opacity:1 !important; visibility:visible !important;';
  target.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // 3) Pause/resume particles based on screen
  if (id === 'screen-hero' || id === 'screen-api') {
    resumeParticles();
  } else {
    pauseParticles();
  }

  // 4) Close mobile palette if switching screens
  closeMobilePalette();
}

// ── Toast Notifications ─────────────────────────────────────
const toastIcons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };

function toast(msg, type = 'info', duration = 3500) {
  const container = $('toast-container');
  if (!container) return;
  const t = create('div', `toast ${type}`,
    `<span>${toastIcons[type] || 'ℹ️'}</span><span>${msg}</span>`);
  container.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(50px)';
    t.style.transition = 'all 0.3s ease';
    setTimeout(() => t.remove(), 300);
  }, duration);
}

// ── Ripple Effect ────────────────────────────────────────────
function addRipple(btn) {
  btn.addEventListener('click', function (e) {
    const r = create('span', 'ripple');
    const rect = this.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    r.style.cssText = `width:${size}px;height:${size}px;top:${e.clientY - rect.top - size/2}px;left:${e.clientX - rect.left - size/2}px`;
    this.appendChild(r);
    setTimeout(() => r.remove(), 600);
  });
}

// ── Particle Canvas (pausable for performance) ──────────────
let _particleAnimId = null;
let _particlesRunning = false;
let _particlesInitialized = false;
let _particlesDraw = null;

function initParticles() {
  // Skip particles on mobile to save battery
  if (window.innerWidth < 768) return;
  // Listeners/particle array are set up once; resumeParticles() restarts the loop.
  if (_particlesInitialized) return;

  const canvas = $('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w, h, particles;
  let mouseX = 0, mouseY = 0;
  const PARTICLE_COUNT = 70;

  function resize() {
    w = canvas.width  = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }

  function makeParticle() {
    const hues = [260, 240, 280, 200, 250];
    return {
      x: Math.random() * (w || 800),
      y: Math.random() * (h || 600),
      r: Math.random() * 3 + 1,
      dx: (Math.random() - 0.5) * 0.4,
      dy: (Math.random() - 0.5) * 0.4,
      alpha: Math.random() * 0.5 + 0.1,
      hue: hues[Math.floor(Math.random() * hues.length)],
      sat: Math.floor(Math.random() * 40) + 60,
      pulse: Math.random() * Math.PI * 2,
      pulseSpeed: Math.random() * 0.02 + 0.005,
    };
  }

  resize();
  particles = Array.from({ length: PARTICLE_COUNT }, makeParticle);

  function draw() {
    if (!_particlesRunning) return;
    ctx.clearRect(0, 0, w, h);
    for (const p of particles) {
      p.x += p.dx + (mouseX - w / 2) * 0.00008;
      p.y += p.dy + (mouseY - h / 2) * 0.00008;
      p.pulse += p.pulseSpeed;
      if (p.x < -50) p.x = w + 50;
      if (p.x > w + 50) p.x = -50;
      if (p.y < -50) p.y = h + 50;
      if (p.y > h + 50) p.y = -50;
      const a = p.alpha * (0.7 + 0.3 * Math.sin(p.pulse));
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 8);
      g.addColorStop(0, `hsla(${p.hue},${p.sat}%,70%,${a})`);
      g.addColorStop(1, `hsla(${p.hue},${p.sat}%,70%,0)`);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 8, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }
    _particleAnimId = requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });

  _particlesDraw = draw;
  _particlesInitialized = true;

  // Start drawing
  _particlesRunning = true;
  draw();
}

function pauseParticles() {
  _particlesRunning = false;
  if (_particleAnimId) {
    cancelAnimationFrame(_particleAnimId);
    _particleAnimId = null;
  }
}

function resumeParticles() {
  if (_particlesRunning || window.innerWidth < 768) return;
  if (!_particlesInitialized) { initParticles(); return; }
  _particlesRunning = true;
  _particlesDraw();
}

// ── 3D Tilt Effect (disabled on touch devices) ──────────────
function initTilt(selector) {
  // Skip tilt on touch devices — wastes CPU and doesn't feel right
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) return;

  $$(selector).forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width  - 0.5) * 2;
      const y = ((e.clientY - rect.top)  / rect.height - 0.5) * 2;
      card.style.transform = `perspective(600px) rotateY(${x * 6}deg) rotateX(${-y * 6}deg) scale(1.02)`;
      card.style.transition = 'transform 0.1s ease';
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
      card.style.transition = 'transform 0.5s cubic-bezier(0.34,1.56,0.64,1)';
    });
  });
}

// ── API Key Management ───────────────────────────────────────
function loadSavedKeys() {
  try {
    const replicateKey = localStorage.getItem('aiims_replicate_key');
    const geminiKey    = localStorage.getItem('aiims_gemini_key');
    const provider     = localStorage.getItem('aiims_provider') || 'gemini';

    State.provider = provider;

    if (replicateKey) {
      State.apiKey = replicateKey;
      const input = $('api-key-input');
      if (input) input.value = replicateKey;
    }
    if (geminiKey) {
      State.geminiKey = geminiKey;
      const input = $('gemini-key-input');
      if (input) input.value = geminiKey;
    }

    // Load saved model
    const savedModel = localStorage.getItem('aiims_gemini_model');
    if (savedModel) {
      State.geminiModel = savedModel;
      const sel = $('gemini-model-select');
      if (sel) sel.value = savedModel;
    }

    // Show status for whichever has a key
    if (geminiKey)    updateProviderStatus('gemini',    'saved', '✓ Gemini key loaded');
    if (replicateKey) updateProviderStatus('replicate', 'saved', '✓ Replicate key loaded');
  } catch (_) { /* localStorage blocked */ }
}

function updateProviderStatus(provider, type, msg) {
  const elId = provider === 'gemini' ? 'api-status-gemini' : 'api-status';
  const el = $(elId);
  if (!el) return;
  const icons = { saved: '🟢', error: '🔴', verifying: '🟡', saved_ok: '🟢' };
  const color = type === 'error' ? 'var(--rose)' : type === 'verifying' ? 'var(--gold)' : 'var(--emerald)';
  el.innerHTML = `<span>${icons[type] || '⚪'}</span><span style="color:${color};">${msg}</span>`;
}

// Keep backward compat
function updateApiStatus(type, msg) { updateProviderStatus('replicate', type, msg); }

// ── Gemini Key Verify ────────────────────────────────────────
async function verifyAndSaveGeminiKey() {
  const input = $('gemini-key-input');
  const key   = (input?.value || '').trim();

  if (!key) { toast('Please enter your Gemini API key', 'error'); return; }

  const btn  = $('btn-save-gemini');
  const icon = $('verify-icon-gemini');
  const text = $('verify-text-gemini');
  if (!btn || !icon || !text) return;

  btn.disabled = true;
  icon.innerHTML = '<div class="spinner"></div>';
  text.textContent = 'Verifying…';
  updateProviderStatus('gemini', 'verifying', 'Contacting Gemini API…');

  try {
    // Test with a simple listModels call — key as query param
    const res = await fetch(`${GEMINI_API}/models?key=${key}`);
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new Error('Invalid API key — please check and try again');
    }

    State.geminiKey = key;
    State.provider  = 'gemini';
    try {
      localStorage.setItem('aiims_gemini_key', key);
      localStorage.setItem('aiims_provider', 'gemini');
    } catch (_) {}

    icon.innerHTML = '<span class="check-anim">✓</span>';
    text.textContent = 'Key Verified & Saved!';
    btn.style.background = 'linear-gradient(135deg, #059669, #10b981)';
    btn.style.boxShadow  = '0 4px 24px rgba(16,185,129,0.4)';
    updateProviderStatus('gemini', 'saved_ok', 'Connected · Gemini 3.1 Pro ready');
    toast('Gemini key verified & saved!', 'success');
    setTimeout(() => showScreen('screen-config'), 1200);

  } catch (err) {
    if (err instanceof TypeError && /load failed|failed to fetch|networkerror/i.test(err.message)) {
      State.geminiKey = key;
      State.provider  = 'gemini';
      try {
        localStorage.setItem('aiims_gemini_key', key);
        localStorage.setItem('aiims_provider', 'gemini');
      } catch (_) {}
      icon.innerHTML = '<span class="check-anim">✓</span>';
      text.textContent = 'Key Saved';
      btn.style.background = 'linear-gradient(135deg, #b45309, #d97706)';
      updateProviderStatus('gemini', 'saved', '⚠️ Key saved — will validate on generation');
      toast('Key saved! Will validate when generating.', 'warning', 5000);
      setTimeout(() => showScreen('screen-config'), 1500);
    } else {
      updateProviderStatus('gemini', 'error', err.message || 'Connection failed');
      toast(err.message || 'Verification failed', 'error');
      icon.innerHTML = '🔑';
      text.textContent = 'Save & Verify Key';
      btn.disabled = false;
      btn.style.background = '';
      btn.style.boxShadow  = '';
    }
  }
}

// ── Replicate Key Verify ─────────────────────────────────────
async function verifyAndSaveKey() {
  const input = $('api-key-input');
  const key   = (input?.value || '').trim();

  if (!key) { toast('Please enter your Replicate API key', 'error'); return; }
  if (!key.startsWith('r8_')) { toast('Replicate API keys start with "r8_"', 'warning'); return; }

  const btn  = $('btn-save-api');
  const icon = $('verify-icon');
  const text = $('verify-text');
  if (!btn || !icon || !text) return;

  btn.disabled = true;
  icon.innerHTML = '<div class="spinner"></div>';
  text.textContent = 'Verifying…';
  updateApiStatus('verifying', 'Contacting Replicate API…');

  try {
    const res = await fetch(`${REPLICATE_API}/account`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${key}` },
    });
    if (res.status === 401) throw new Error('Invalid API key — please check and try again');
    if (res.status === 403) throw new Error('Access denied — check your API key permissions');

    saveKey(key);
    icon.innerHTML = '<span class="check-anim">✓</span>';
    text.textContent = 'Key Verified & Saved!';
    btn.style.background = 'linear-gradient(135deg, #059669, #10b981)';
    btn.style.boxShadow  = '0 4px 24px rgba(16,185,129,0.4)';
    updateApiStatus('saved_ok', 'Connected · Claude Sonnet 4.6 ready');
    toast('API key verified & saved!', 'success');
    setTimeout(() => showScreen('screen-config'), 1200);

  } catch (err) {
    if (err instanceof TypeError && /load failed|failed to fetch|networkerror/i.test(err.message)) {
      saveKey(key);
      icon.innerHTML = '<span class="check-anim">✓</span>';
      text.textContent = 'Key Saved';
      btn.style.background = 'linear-gradient(135deg, #b45309, #d97706)';
      btn.style.boxShadow  = '0 4px 24px rgba(217,119,6,0.4)';
      updateApiStatus('saved', '⚠️ Key saved — will validate on generation');
      toast('Key saved! Will validate when generating.', 'warning', 5000);
      setTimeout(() => showScreen('screen-config'), 1500);
    } else {
      updateApiStatus('error', err.message || 'Connection failed');
      toast(err.message || 'Verification failed', 'error');
      resetVerifyButton(btn, icon, text);
    }
  }
}

function saveKey(key) {
  State.apiKey = key;
  State.provider = 'replicate';
  try {
    localStorage.setItem('aiims_replicate_key', key);
    localStorage.setItem('aiims_provider', 'replicate');
  } catch (_) {}
}

function resetVerifyButton(btn, icon, text) {
  icon.innerHTML = '🔑';
  text.textContent = 'Save & Verify Key';
  btn.disabled = false;
  btn.style.background = '';
  btn.style.boxShadow  = '';
}

function hasActiveKey() {
  if (State.provider === 'gemini') return !!State.geminiKey;
  return !!State.apiKey;
}

// ── Subject Grid ─────────────────────────────────────────────
function renderSubjectGrid() {
  const grid = $('subject-grid');
  if (!grid) return;
  grid.innerHTML = '';
  State.examConfig.subjects = []; // reset to avoid duplicates on re-render

  SUBJECTS.forEach(sub => {
    const chip = create('div', 'subject-chip selected shine-hover');
    chip.dataset.id = sub.id;
    chip.setAttribute('role', 'checkbox');
    chip.setAttribute('aria-checked', 'true');
    chip.setAttribute('tabindex', '0');
    chip.innerHTML = `
      <span class="chip-icon">${sub.icon}</span>
      <span class="chip-label">${sub.label}</span>
      <span class="chip-check">✓</span>
    `;
    chip.addEventListener('click', () => toggleSubject(chip, sub.id));
    chip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSubject(chip, sub.id); }
    });
    grid.appendChild(chip);
    State.examConfig.subjects.push(sub.id);
  });
}

// Quick Quiz mode locks question count to 25 — disable the slider/pills so they can't override it
function setQCountControlsEnabled(enabled) {
  const slider = $('q-count-slider');
  if (slider) slider.disabled = !enabled;
  $$('[data-qcount]').forEach(btn => {
    btn.disabled = !enabled;
    btn.classList.toggle('disabled', !enabled);
  });
}

function toggleSubject(chip, id) {
  const idx = State.examConfig.subjects.indexOf(id);
  if (idx > -1) {
    if (State.examConfig.subjects.length === 1) { toast('At least one subject required', 'warning'); return; }
    State.examConfig.subjects.splice(idx, 1);
    chip.classList.remove('selected');
    chip.setAttribute('aria-checked', 'false');
  } else {
    State.examConfig.subjects.push(id);
    chip.classList.add('selected');
    chip.setAttribute('aria-checked', 'true');
  }
}

// ── AI Prompt Builder (enhanced with previous year patterns) ─
function buildSystemPrompt() {
  return `You are an expert AIIMS CRE (Combined Recruitment Examination) question paper setter for Pharmacist Grade II posts with 20+ years of experience.

Your task is to generate a complete PREDICTED question paper for the AIIMS CRE 2026 examination, following the EXACT pattern of real AIIMS exams from 2019-2025.

EXAM PATTERN REFERENCE (Previous Years):
- AIIMS CRE exams typically include: Pharmacology (25-30%), Pharmaceutics (15-20%), Hospital & Clinical Pharmacy (15%), Pharmacy Practice (10-15%), Pharmacognosy (8-10%), Biochemistry (5-8%), Anatomy & Physiology (5-8%), Drug Store Management (5%)
- Recurring high-yield topics: Drug interactions, Adverse drug reactions (ADR reporting), Pharmacovigilance, Drug calculations & dosage, Schedule H/H1/X drugs, Drug & Cosmetics Act 1940, Pharmacy Practice regulations, Bioavailability & Bioequivalence, Antimicrobial resistance, National Health Programs, NABH/NABL accreditation, Clinical Pharmacy protocols
- Question style: Single-best-answer MCQs, clinical scenario-based, "Which of the following" format, drug identification, mechanism-based, calculation-based
- Recent trends (2023-2025): Increased emphasis on Clinical Pharmacy, Pharmacovigilance (PvPI), Rational Drug Use, COVID-19 therapeutics aftermath, Biosimilars, Digital health in pharmacy, New drug approvals (2024-2025)

CRITICAL RULES:
1. Generate ONLY valid JSON — no markdown, no backticks, no commentary.
2. Questions must be single-best-answer MCQs with exactly 4 options (A, B, C, D).
3. Base questions on actual AIIMS CRE pharmacist syllabus patterns from previous years.
4. Include clinical scenarios, drug calculations, mechanism of action, drug interactions, pharmaceutical jurisprudence, and pharmacovigilance.
5. Each question MUST have a detailed, educational explanation (3-5 sentences) explaining WHY the correct answer is right and why others are wrong.
6. Each question MUST have a realistic 2026 prediction probability note.
7. Ensure questions are exam-realistic — match the actual difficulty and style of AIIMS papers.
8. Your entire output must be a single valid JSON object. Nothing else.
9. NEVER repeat questions. Each question must be unique.
10. Distractors (wrong options) must be plausible — avoid obviously wrong choices.`;
}

function buildUserPrompt(config) {
  const subjectNames = config.subjects.map(id => SUBJECTS.find(s => s.id === id)?.label || id).join(', ');
  const durationMins = Math.round(config.questionCount * 1.2);

  return `Generate a complete AIIMS CRE 2026 Pharmacist Grade II predicted question paper.

SPECIFICATIONS:
- Total Questions: ${config.questionCount}
- Subjects: ${subjectNames}
- Difficulty: ${config.difficulty} ${config.difficulty === 'Mixed' ? '(~30% Easy, ~50% Medium, ~20% Hard — mirrors real AIIMS pattern)' : ''}
- Mode: ${config.mode === 'full' ? 'Full mixed paper (questions from all subjects randomly ordered)' : config.mode === 'topic' ? 'Topic-focused (group by subject)' : 'Quick quiz (high-yield topics only)'}
- Duration: ${durationMins} minutes
- Predict trending topics for 2026 based on recent AIIMS CRE patterns

PREVIOUS YEAR HIGH-YIELD TOPICS TO INCLUDE:
- Pharmacology: Drug interactions, ADRs, MOA of antihypertensives/antibiotics/antidiabetics, pharmacokinetics calculations, drug schedules
- Hospital Pharmacy: Drug distribution systems, formulary management, medication errors, TPN preparation, IV admixture
- Clinical Pharmacy: Patient counseling, therapeutic drug monitoring, drug information services, evidence-based medicine
- Pharmaceutics: Biopharmaceutics, stability testing, dosage form design, sterilization methods
- Pharmacy Practice: DCA 1940, Pharmacy Act, Drug pricing (DPCO), CDSCO regulations, Good Pharmacy Practice
- Pharmacognosy: Alkaloids, glycosides, volatile oils, biological source identification

Return ONLY a JSON object (no markdown). Format:
{"paperTitle":"...","totalQuestions":${config.questionCount},"duration":${durationMins},"questions":[{"id":1,"subject":"...","topic":"...","difficulty":"Easy|Medium|Hard","aiims2026Prediction":"...","question":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"correctAnswer":"B","explanation":"3-5 sentence explanation"}]}

Generate exactly ${config.questionCount} questions distributed across subjects proportionally. Exam-realistic with plausible distractors.`;
}

// ── Gemini prompt (uses google_search for grounding) ─────────
function buildGeminiInput(config) {
  const subjectNames = config.subjects.map(id => SUBJECTS.find(s => s.id === id)?.label || id).join(', ');
  const durationMins = Math.round(config.questionCount * 1.2);
  const explanationLength = config.questionCount > 100 ? '2-3 sentence' : '3-5 sentence';

  return `STEP 1: Search the web for these to ground your questions in real, verifiable data:
- "AIIMS CRE Pharmacist Grade II 2023 question paper" and "AIIMS CRE Pharmacist Grade II 2022 question paper" (search each year separately — 2019 through 2025 — not as one combined query)
- "AIIMS CRE Pharmacist Grade II previous year question papers PDF"
- "AIIMS Pharmacist exam analysis" (year-wise, if available — topic-wise weightage breakdowns published by coaching sites are useful signal)
- "AIIMS CRE 2024 2025 pharmacist exam pattern syllabus official notification"
- Recent drug approvals and CDSCO/DCA regulatory updates in India (2024-2026) relevant to pharmacist exams

STEP 2: From what you found, extract the REAL recurring pattern — which topics appeared across multiple years, how marks were distributed by subject, and the actual question phrasing style. Use this as ground truth instead of guessing.

STEP 3: Using that real exam pattern, generate a PREDICTED ${config.questionCount}-question paper for AIIMS CRE 2026 Pharmacist Grade II exam.

Specifications:
- Subjects: ${subjectNames}
- Difficulty: ${config.difficulty} ${config.difficulty === 'Mixed' ? '(30% Easy, 50% Medium, 20% Hard — real AIIMS distribution)' : ''}
- Mode: ${config.mode === 'full' ? 'Full mixed paper' : config.mode === 'topic' ? 'Topic-wise' : 'Quick quiz (high-yield only)'}
- Duration: ${durationMins} minutes

Real AIIMS CRE subject weightage (match this distribution across the paper):
Pharmacology 25-30%, Pharmaceutics 15-20%, Hospital & Clinical Pharmacy 15%, Pharmacy Practice 10-15%, Pharmacognosy 8-10%, Biochemistry 5-8%, Anatomy & Physiology 5-8%, Drug Store Management 5%.

Recurring high-yield topics found across previous years (weight questions toward these):
Drug interactions, ADR reporting & Pharmacovigilance (PvPI), drug calculations & dosage, Schedule H/H1/X drugs, Drug & Cosmetics Act 1940, Pharmacy Act, Bioavailability & Bioequivalence, antimicrobial resistance, National Health Programs, NABH/NABL accreditation, TPN/IV admixture, therapeutic drug monitoring, DPCO drug pricing.

Question quality rules:
- Match the EXACT style of real AIIMS CRE papers (clinical scenarios, "Which of the following", drug identification, calculations) based on what you found in search
- Do NOT copy any real exam question verbatim, even one you find in search results — write a new question that tests the same concept, topic, and difficulty level instead
- Distractors must be plausible — commonly confused drugs/values, not obviously wrong choices
- Before finalizing each question, verify drug names, mechanisms, doses, and regulatory facts against what you found in search — do not rely on memory alone for factual details
- Explanations must be educational (${explanationLength}), explaining why the correct answer is right AND why the key distractor is wrong
- Include a realistic 2026 prediction probability for each question, grounded in how often that topic recurred in the years you searched
- Use Indian Pharmacopoeia (IP) drug naming conventions where applicable, consistent with real AIIMS papers

Return ONLY a JSON object (no markdown). Format:
{"paperTitle":"...","totalQuestions":${config.questionCount},"duration":${durationMins},"questions":[{"id":1,"subject":"...","topic":"...","difficulty":"Easy|Medium|Hard","aiims2026Prediction":"...","question":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"correctAnswer":"B","explanation":"..."}]}

Generate exactly ${config.questionCount} unique questions distributed across subjects proportionally to the real weightage above.`;
}

// ── Gemini Interactions API Call ──────────────────────────────
// Docs: https://ai.google.dev/gemini-api/docs/gemini-3
// Endpoint: POST /v1beta/interactions
// Response: { steps: [ { type: 'model_output', content: [{ type: 'text', text: '...' }] } ] }
async function generateQuestionsWithGemini(config, signal) {
  if (!State.geminiKey) throw new Error('No Gemini API key set');

  const userInput = buildGeminiInput(config);

  updateLoadingStatus('Sending to Gemini 3.1 Pro with Google Search…', 10);
  updateStreamOutput('Connecting to Gemini Interactions API…');

  const questionSchema = {
    type: 'object',
    properties: {
      paperTitle: { type: 'string', description: 'Title of the paper' },
      totalQuestions: { type: 'integer', description: 'Total number of questions' },
      duration: { type: 'integer', description: 'Duration in minutes' },
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            subject: { type: 'string' },
            topic: { type: 'string' },
            difficulty: { type: 'string' },
            aiims2026Prediction: { type: 'string' },
            question: { type: 'string' },
            options: {
              type: 'object',
              properties: {
                A: { type: 'string' },
                B: { type: 'string' },
                C: { type: 'string' },
                D: { type: 'string' },
              },
              required: ['A', 'B', 'C', 'D'],
            },
            correctAnswer: { type: 'string' },
            explanation: { type: 'string' },
          },
          required: ['id', 'subject', 'question', 'options', 'correctAnswer', 'explanation'],
        },
      },
    },
    required: ['questions'],
  };

  // Interactions API body format per docs
  const body = {
    model: State.geminiModel,
    input: userInput,
    tools: [
      { type: 'google_search' },
      { type: 'url_context' },
    ],
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: questionSchema,
    },
    generation_config: {
      thinking_level: 'medium',
    },
  };

  // POST to /v1beta/interactions — key as both query param and header for compatibility
  const res = await fetch(`${GEMINI_API}/interactions?key=${encodeURIComponent(State.geminiKey)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': State.geminiKey,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    let errMsg = `Gemini API error: ${res.status}`;
    try {
      const d = await res.json();
      errMsg = d.error?.message || d.detail || errMsg;
      console.error('[GEMINI] Error response:', d);
    } catch (_) {}
    if (res.status === 401 || res.status === 403) errMsg = 'Invalid Gemini API key. Please update your key.';
    if (res.status === 429) errMsg = 'Rate limited. Please wait a moment and try again.';
    if (res.status === 404) errMsg = 'Endpoint not found. Ensure your API key has access to Gemini 3.1 Pro.';
    throw new Error(errMsg);
  }

  updateLoadingStatus('Gemini is generating questions with search grounding…', 40);

  const data = await res.json();
  console.log('[GEMINI] Response keys:', Object.keys(data));
  console.log('[GEMINI] Response preview:', JSON.stringify(data).slice(0, 800));

  // Extract output_text directly (SDK uses interaction.output_text)
  let outputText = '';

  // Method 1: Direct output_text field
  if (data.output_text) {
    outputText = data.output_text;
  }

  // Method 2: steps[] → model_output → content[] → text
  if (!outputText && data.steps && Array.isArray(data.steps)) {
    for (const step of data.steps) {
      if (step.type === 'model_output' && step.content) {
        for (const block of step.content) {
          if (block.text) {
            outputText += block.text;
          }
        }
      }
    }
  }

  // Method 3: Fallback — try other common shapes
  if (!outputText && data.output) {
    outputText = typeof data.output === 'string' ? data.output : JSON.stringify(data.output);
  }
  if (!outputText && data.candidates) {
    for (const c of data.candidates) {
      if (c.content?.parts) {
        for (const p of c.content.parts) {
          if (p.text) outputText += p.text;
        }
      }
    }
  }
  if (!outputText && data.response) {
    outputText = typeof data.response === 'string' ? data.response : JSON.stringify(data.response);
  }

  if (!outputText) {
    console.error('[GEMINI] Full response:', JSON.stringify(data, null, 2));
    throw new Error('Could not extract questions from Gemini response. Check browser console for details.');
  }

  updateLoadingStatus('Parsing Gemini response…', 85);
  updateStreamOutput(outputText.slice(-400));

  return outputText;
}

// ── Replicate API Call ───────────────────────────────────────
async function generateQuestionsWithReplicate(config, signal) {
  if (!State.apiKey) throw new Error('No API key set');

  const systemPrompt = buildSystemPrompt();
  const userPrompt   = buildUserPrompt(config);

  updateLoadingStatus('Creating prediction on Replicate…', 10);

  const createRes = await fetch(`${REPLICATE_API}/models/anthropic/claude-sonnet-4.6/predictions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${State.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: {
        prompt: userPrompt,
        system_prompt: systemPrompt,
        max_tokens: 16000,
      },
    }),
    signal,
  });

  if (!createRes.ok) {
    let errMsg = `Replicate API error: ${createRes.status}`;
    try { const d = await createRes.json(); errMsg = d.detail || d.error || errMsg; } catch (_) {}
    if (createRes.status === 401) errMsg = 'Invalid API key. Please update your key and try again.';
    if (createRes.status === 422) errMsg = 'Model error: invalid input. Please try again.';
    throw new Error(errMsg);
  }

  const prediction = await createRes.json();
  updateStreamOutput(`✅ Prediction created: ${prediction.id}\nStatus: ${prediction.status}\nPolling for results…`);

  // If the prediction already completed (e.g. from Prefer:wait)
  if (prediction.status === 'succeeded' && prediction.output) {
    const output = Array.isArray(prediction.output) ? prediction.output.join('') : String(prediction.output);
    return output;
  }

  return await pollPrediction(prediction.id, signal);
}

async function pollPrediction(predId, signal) {
  updateLoadingStatus('Waiting for AI to generate questions…', 25);
  const pollUrl = `${REPLICATE_API}/predictions/${predId}`;
  const maxWait = 300; // 5 minutes max
  let elapsed = 0;

  while (elapsed < maxWait) {
    await sleep(2500, signal);
    elapsed += 2.5;

    let data;
    try {
      const res = await fetch(pollUrl, {
        headers: { 'Authorization': `Bearer ${State.apiKey}` },
        signal,
      });
      data = await res.json();
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      // Network blip — retry
      updateLoadingStatus(`Connection hiccup, retrying… (${Math.round(elapsed)}s)`, 25);
      continue;
    }

    const progress = Math.min(90, 25 + Math.floor((elapsed / maxWait) * 65));

    if (data.output) {
      const text = Array.isArray(data.output) ? data.output.join('') : String(data.output);
      const qCount = (text.match(/"id"\s*:/g) || []).length;
      updateLoadingStatus(`Generating… ${qCount} questions (${Math.round(elapsed)}s)`, progress);
      updateStreamOutput(text.slice(-400));
    } else {
      updateLoadingStatus(`AI thinking… (${Math.round(elapsed)}s elapsed)`, progress);
    }

    if (data.status === 'succeeded') {
      const output = Array.isArray(data.output) ? data.output.join('') : String(data.output || '');
      return output;
    }

    if (data.status === 'failed' || data.status === 'canceled') {
      throw new Error(data.error || `Prediction ${data.status}. Please try again.`);
    }
  }

  throw new Error('Timeout: AI took too long. Try fewer questions.');
}

// ── Loading UI Helpers ───────────────────────────────────────
function updateLoadingStatus(msg, pct) {
  const el  = $('loading-status');
  const bar = $('progress-bar');
  if (el)  el.textContent = msg;
  if (bar) bar.style.width = `${pct}%`;
}

function updateStreamOutput(text) {
  const el = $('stream-output');
  if (el) el.textContent = text;
}

// ── JSON Parser (robust) ─────────────────────────────────────
function parseQuestionsFromText(rawText) {
  // Strip markdown code fences if present
  let cleaned = rawText.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

  // 1. Try direct parse
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.questions && Array.isArray(parsed.questions)) return parsed;
  } catch (_) {}

  // 2. Find outermost { ... } containing "questions"
  const first = cleaned.indexOf('{');
  const last  = cleaned.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try {
      const parsed = JSON.parse(cleaned.slice(first, last + 1));
      if (parsed.questions && Array.isArray(parsed.questions)) return parsed;
    } catch (_) {}
  }

  // 3. Try to find just the array of questions
  const arrMatch = cleaned.match(/\[\s*\{[\s\S]*"question"[\s\S]*\}\s*\]/);
  if (arrMatch) {
    try {
      const arr = JSON.parse(arrMatch[0]);
      if (Array.isArray(arr)) return { questions: arr };
    } catch (_) {}
  }

  throw new Error('Could not parse AI response. Please try again.');
}

// ── Sanitize Questions ──────────────────────────────────────
function sanitizeQuestions(questions) {
  return questions.map((q, i) => ({
    id: i + 1,
    subject: String(q.subject || 'General'),
    topic: String(q.topic || ''),
    difficulty: String(q.difficulty || 'Medium'),
    aiims2026Prediction: String(q.aiims2026Prediction || ''),
    question: String(q.question || `Question ${i + 1}`),
    options: {
      A: String(q.options?.A ?? q.options?.a ?? 'Option A'),
      B: String(q.options?.B ?? q.options?.b ?? 'Option B'),
      C: String(q.options?.C ?? q.options?.c ?? 'Option C'),
      D: String(q.options?.D ?? q.options?.d ?? 'Option D'),
    },
    correctAnswer: ['A','B','C','D'].includes(String(q.correctAnswer).toUpperCase())
      ? String(q.correctAnswer).toUpperCase() : 'A',
    explanation: String(q.explanation || 'Refer standard pharmacist textbooks.'),
  }));
}

// ── Main Generate Flow ───────────────────────────────────────
let _generationAbortController = null;

function cancelGeneration() {
  if (_generationAbortController) _generationAbortController.abort();
}

async function startGeneration() {
  const config = State.examConfig;
  if (config.subjects.length === 0) {
    toast('Select at least one subject', 'warning');
    return;
  }
  if (!hasActiveKey()) {
    toast('Please set an API key first', 'error');
    showScreen('screen-api');
    return;
  }

  showScreen('screen-loading');
  const providerName = State.provider === 'gemini' ? State.geminiModel : 'Claude Sonnet 4.6';
  updateStreamOutput(`Connecting to ${providerName}…`);
  updateLoadingStatus('Initializing…', 5);

  // Update loading screen title
  const lt = $('loading-title');
  if (lt) lt.textContent = `Generating with ${providerName}…`;

  _generationAbortController = new AbortController();
  const signal = _generationAbortController.signal;

  try {
    let rawText;
    if (State.provider === 'gemini') {
      rawText = await generateQuestionsWithGemini(config, signal);
    } else {
      rawText = await generateQuestionsWithReplicate(config, signal);
    }
    updateLoadingStatus('Parsing question paper…', 93);

    const paperData = parseQuestionsFromText(rawText);
    const questions = sanitizeQuestions(paperData.questions || []);

    if (questions.length === 0) throw new Error('AI returned 0 questions. Please try again.');

    // Reset exam state completely
    State.questions      = questions;
    State.userAnswers    = {};
    State.markedForReview = new Set();
    State.currentIndex   = 0;
    State.examSubmitted  = false;
    State.examStarted    = false;

    const durationMins = paperData.duration || Math.round(questions.length * 1.2);
    State.timeLeft      = durationMins * 60;
    State.totalTimeSecs  = State.timeLeft;

    updateLoadingStatus(`✅ ${questions.length} questions ready!`, 100);
    await sleep(700);

    initExamInterface();
    showScreen('screen-exam');

  } catch (err) {
    if (err.name === 'AbortError') {
      toast('Generation cancelled', 'info', 2500);
      showScreen('screen-config');
      return;
    }
    console.error('Generation error:', err);
    toast(err.message || 'Failed to generate questions', 'error', 6000);
    updateLoadingStatus('❌ ' + (err.message || 'Error'), 0);
    setTimeout(() => showScreen('screen-config'), 3000);
  } finally {
    _generationAbortController = null;
  }
}

// ══════════════════════════════════════════════════════════════
// EXAM ENGINE
// ══════════════════════════════════════════════════════════════

function initExamInterface() {
  clearInterval(State.timerInterval); // kill any old timer
  renderPaletteGrid();
  renderQuestion(0);
  startTimer();
  State.examStarted = true;
  toast(`📋 ${State.questions.length} questions loaded. Good luck!`, 'success', 4000);
}

function renderPaletteGrid() {
  const grid = $('palette-grid');
  if (!grid) return;
  grid.innerHTML = '';

  // Use DocumentFragment for batch DOM insertion (performance)
  const frag = document.createDocumentFragment();
  State.questions.forEach((_, i) => {
    const btn = create('button', 'palette-btn', String(i + 1));
    btn.id = `pal-btn-${i}`;
    btn.addEventListener('click', () => {
      navigateToQuestion(i);
      closeMobilePalette();
    });
    frag.appendChild(btn);
  });
  grid.appendChild(frag);
  refreshPalette();
}

// Recompute one palette button's class from current state (cheap — no full scan)
function updatePaletteButtonClass(i) {
  const btn = $(`pal-btn-${i}`);
  if (!btn) return;
  btn.className = 'palette-btn';
  if (i === State.currentIndex) {
    btn.classList.add('current');
  } else if (State.markedForReview.has(i)) {
    btn.classList.add('marked');
  } else if (State.userAnswers[i] !== undefined) {
    btn.classList.add('answered');
  }
}

function updatePaletteStats() {
  const total = State.questions.length;
  const answered = Object.keys(State.userAnswers).length;
  const sa = $('stat-answered');
  const ss = $('stat-skipped');
  if (sa) sa.textContent = answered;
  if (ss) ss.textContent = total - answered;
}

// Full re-scan of every palette button — only needed on initial grid build
function refreshPalette() {
  const total = State.questions.length;
  for (let i = 0; i < total; i++) updatePaletteButtonClass(i);
  updatePaletteStats();
}

function navigateToQuestion(index) {
  if (index < 0 || index >= State.questions.length) return;
  const prevIndex = State.currentIndex;
  State.currentIndex = index;
  renderQuestion(index);
  if (prevIndex !== index) {
    updatePaletteButtonClass(prevIndex);
    updatePaletteButtonClass(index);
  }
  saveExamSnapshot();
}

function renderQuestion(index) {
  if (index < 0 || index >= State.questions.length) return;
  State.currentIndex = index;
  const q = State.questions[index];
  if (!q) return;

  // Header badges
  const nb = $('q-number-badge');
  const sb = $('q-subject-badge');
  const db = $('q-difficulty-badge');
  const pg = $('q-progress-text');
  const qt = $('question-text');
  const pt = $('ai-prediction-tag');

  if (nb) nb.textContent = `Q. ${index + 1}`;
  if (sb) sb.textContent = q.subject;
  if (db) {
    db.textContent = q.difficulty;
    db.className = 'badge ' + (
      q.difficulty === 'Easy' ? 'badge-success' :
      q.difficulty === 'Hard' ? 'badge-error'   : 'badge-warning'
    );
  }
  if (pg) pg.textContent = `${index + 1} of ${State.questions.length}`;
  if (qt) qt.textContent = q.question;
  if (pt) {
    pt.style.display = (q.aiims2026Prediction && /high/i.test(q.aiims2026Prediction)) ? 'block' : 'none';
  }

  renderOptions(q, index, false);

  // Scroll question area to top
  const scroll = document.querySelector('.exam-main-scroll');
  if (scroll) scroll.scrollTop = 0;
}

function renderOptions(q, qIndex, showExplanation = false) {
  const list = $('options-list');
  if (!list) return;
  list.innerHTML = '';

  const selected = State.userAnswers[qIndex];
  const isLocked = selected !== undefined; // If any answer is selected, this question is locked.
  const cleanCorrectAns = q.correctAnswer ? String(q.correctAnswer).trim().toUpperCase() : '';

  ['A', 'B', 'C', 'D'].forEach(key => {
    const isSelected = selected === key;
    const isThisCorrect = (key === cleanCorrectAns);
    
    let extraClass = '';
    if (isLocked) {
      extraClass += ' locked';
      if (isThisCorrect) extraClass += ' correct-locked';
      else if (isSelected && !isThisCorrect) extraClass += ' wrong-locked';
    } else if (isSelected) {
      extraClass += ' selected';
    }

    const item = create('div', `option-item${extraClass}`);
    if (!isLocked) {
      item.classList.add('shine-hover');
    }
    
    item.setAttribute('role', 'radio');
    item.setAttribute('aria-checked', String(isSelected));
    item.setAttribute('tabindex', '0');
    
    let badgeHtml = '';
    if (isLocked) {
      if (isThisCorrect) badgeHtml = `<div style="margin-left:auto;background:var(--emerald);color:white;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;">Correct</div>`;
      else if (isSelected) badgeHtml = `<div style="margin-left:auto;background:var(--rose);color:white;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;">Your Answer</div>`;
    }

    item.innerHTML = `
      <div class="option-key">${key}</div>
      <div class="option-text">${q.options[key]}</div>
      ${badgeHtml}
    `;
    
    if (!isLocked) {
      item.addEventListener('click', () => selectAnswer(qIndex, key));
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectAnswer(qIndex, key); }
      });
    }
    
    list.appendChild(item);
  });

  // Clear only makes sense before an answer locks the question
  const clearBtn = $('btn-clear');
  if (clearBtn) clearBtn.style.display = isLocked ? 'none' : '';

  // Remove ALL stale instant-explanation divs (fixes bug where old explanations persist)
  document.querySelectorAll('.instant-explanation').forEach(el => el.remove());

  // Show explanation after answering (both correct and wrong)
  if (isLocked && showExplanation) {
    const expDiv = document.createElement('div');
    expDiv.id = 'instant-exp-' + qIndex;
    expDiv.className = 'instant-explanation';
    expDiv.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
        <span style="font-size:16px;">💡</span>
        <span style="color:var(--violet-bright); font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:1px;">Explanation</span>
      </div>
      <div style="color:var(--text-secondary); font-size:14px; line-height:1.7;">
        ${q.explanation || 'No detailed explanation provided for this question.'}
      </div>
      ${q.aiims2026Prediction ? `<div style="margin-top:14px; display:inline-flex; align-items:center; gap:6px; background:rgba(255,255,255,0.05); padding:6px 14px; border-radius:20px; font-size:12px; color:white; font-weight:600;"><span style="font-size:14px;">🔮</span> ${q.aiims2026Prediction}</div>` : ''}
    `;
    // Insert after options list
    list.parentNode.insertBefore(expDiv, list.nextSibling);
  }
}

function selectAnswer(qIndex, key) {
  if (State.examSubmitted) return;
  // INSTANT FEEDBACK MODE: Do not allow changing answer once selected.
  if (State.userAnswers[qIndex] !== undefined) return; 

  State.userAnswers[qIndex] = key;
  renderOptions(State.questions[qIndex], qIndex, true); // Show explanation right after answering
  updatePaletteButtonClass(qIndex);
  updatePaletteStats();
  saveExamSnapshot();
}

// ── Timer ────────────────────────────────────────────────────
function startTimer() {
  clearInterval(State.timerInterval);
  const circumf = 2 * Math.PI * 14; // r=14 from SVG

  // Fix: initialize strokeDasharray via JS to match circumference exactly
  const ring = $('timer-ring');
  if (ring) {
    ring.style.strokeDasharray = String(circumf);
    ring.style.strokeDashoffset = '0';
  }

  updateTimerDisplay();

  State.timerInterval = setInterval(() => {
    if (State.timeLeft <= 0) {
      clearInterval(State.timerInterval);
      toast('⏱️ Time up! Auto-submitting…', 'warning', 2000);
      setTimeout(() => doSubmitExam(), 1500);
      return;
    }

    State.timeLeft--;
    updateTimerDisplay();
    saveExamSnapshot();

    // Timer ring
    const ring = $('timer-ring');
    if (ring && State.totalTimeSecs > 0) {
      const pct = State.timeLeft / State.totalTimeSecs;
      ring.style.strokeDashoffset = String(circumf * (1 - pct));
      ring.className = 'timer-fill';
      if (State.timeLeft <= 300) ring.classList.add('danger');
      else if (State.timeLeft <= 900) ring.classList.add('warning');
    }

    // Announcements
    if (State.timeLeft > 0 && State.timeLeft <= 300 && State.timeLeft % 60 === 0) {
      toast(`⏰ ${Math.ceil(State.timeLeft / 60)} minutes remaining!`, 'warning');
    }
  }, 1000);
}

function updateTimerDisplay() {
  const d = $('timer-display');
  if (!d) return;
  const t = Math.max(0, State.timeLeft);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  d.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// ══════════════════════════════════════════════════════════════
// SUBMIT EXAM  (this was the main bug area)
// ══════════════════════════════════════════════════════════════

function openSubmitModal() {
  if (State.examSubmitted) return; // prevent double submit

  const answered = Object.keys(State.userAnswers).length;
  const total    = State.questions.length;
  const skipped  = total - answered;

  const ma = $('modal-answered');
  const mt = $('modal-total');
  const ms = $('modal-skipped-msg');
  const mo = $('submit-modal');

  if (ma) ma.textContent = String(answered);
  if (mt) mt.textContent = String(total);
  if (ms) ms.textContent = skipped > 0 ? `⚠️ ${skipped} questions are unattempted. ` : '';

  // Show modal — must set both display AND ensure visibility
  if (mo) {
    mo.style.display = 'flex';
    mo.style.visibility = 'visible';
    mo.style.opacity = '1';
    mo.style.pointerEvents = 'auto';
    // Refocus to ensure interactive
    const confirmBtn = $('btn-confirm-submit');
    if (confirmBtn) confirmBtn.focus();
  }
}

function closeSubmitModal() {
  const mo = $('submit-modal');
  if (mo) {
    mo.style.display = 'none';
    mo.style.visibility = 'hidden';
    mo.style.opacity = '0';
    mo.style.pointerEvents = 'none';
  }
}

function doSubmitExam() {
  if (State.examSubmitted) return;

  // 1. Immediate state changes
  State.examSubmitted = true;
  State.examStarted   = false;
  clearExamSnapshot();
  closeSubmitModal();
  clearInterval(State.timerInterval);
  State.timerInterval = null;

  // 2. Calculate results
  let results;
  try {
    results = calculateResults();
  } catch (err) {
    console.error('[SUBMIT] calculateResults error:', err);
    results = {
      correct: 0, wrong: 0, skipped: State.questions.length,
      rawScore: 0, penalty: 0, finalScore: 0,
      maxScore: State.questions.length, percentage: 0,
      subjectMap: {}
    };
  }

  // 3. FIRST switch to results screen (so elements are visible)
  showScreen('screen-results');

  // 4. THEN populate data (elements are now visible/findable)
  try {
    populateResults(results);
  } catch (err) {
    console.error('[SUBMIT] populateResults error:', err);
  }

  // 5. Confetti
  if (results.percentage >= 60) {
    setTimeout(launchConfetti, 600);
  }
}


// ── Score Calculation ─────────────────────────────────────────
function calculateResults() {
  let correct = 0, wrong = 0, skipped = 0;
  const subjectMap = {};

  State.questions.forEach((q, i) => {
    const sub = q.subject;
    if (!subjectMap[sub]) subjectMap[sub] = { correct: 0, total: 0 };
    subjectMap[sub].total++;

    const ans = State.userAnswers[i];
    if (ans === undefined) {
      skipped++;
    } else if (ans === q.correctAnswer) {
      correct++;
      subjectMap[sub].correct++;
    } else {
      wrong++;
    }
  });

  const rawScore   = correct;
  const penalty    = parseFloat((wrong / 3).toFixed(2));
  const finalScore = parseFloat((rawScore - penalty).toFixed(2));
  const maxScore   = State.questions.length;
  const percentage = maxScore > 0 ? parseFloat(((Math.max(0, finalScore) / maxScore) * 100).toFixed(1)) : 0;

  return { correct, wrong, skipped, rawScore, penalty, finalScore, maxScore, percentage, subjectMap };
}

// ── Populate Results (called AFTER screen is already visible) ───
function populateResults(results) {
  // Score ring
  try {
    const ring = $('score-ring');
    if (ring) {
      const circumf = 2 * Math.PI * 80;
      ring.style.strokeDasharray  = String(circumf);
      ring.style.strokeDashoffset = String(circumf);
      ring.setAttribute('class', 'score-ring-fill ' + (results.percentage >= 70 ? 'high' : results.percentage >= 40 ? 'medium' : 'low'));
      setTimeout(() => {
        ring.style.strokeDashoffset = String(circumf * (1 - results.percentage / 100));
      }, 400);
    }
  } catch (e) { console.error('[RESULTS] Ring error:', e); }

  // Score percentage text
  try {
    const pct = $('score-pct-display');
    if (pct) pct.textContent = results.percentage.toFixed(1) + '%';
  } catch (e) { console.error('[RESULTS] Pct error:', e); }

  // Stat counters — just set text directly, no animation that could fail
  try {
    const rc = $('res-correct');  if (rc) rc.textContent = String(results.correct);
    const rw = $('res-wrong');    if (rw) rw.textContent = String(results.wrong);
    const rs = $('res-skipped');  if (rs) rs.textContent = String(results.skipped);
  } catch (e) { console.error('[RESULTS] Stats error:', e); }

  // Score breakdown
  try {
    const rr = $('res-raw');     if (rr) rr.textContent = results.rawScore + '/' + results.maxScore;
    const rp = $('res-penalty'); if (rp) rp.textContent = '−' + results.penalty.toFixed(2);
    const rf = $('res-final');
    if (rf) rf.textContent = results.finalScore + '/' + results.maxScore + (results.finalScore < 0 ? ' (shown as 0% above)' : '');
  } catch (e) { console.error('[RESULTS] Breakdown error:', e); }

  // Verdict
  try {
    const verdict = $('result-verdict');
    if (verdict) {
      const v = results.percentage >= 80 ? '🏆 Outstanding!'
              : results.percentage >= 60 ? '✅ Good Performance'
              : results.percentage >= 40 ? '📚 Needs Improvement'
              :                            '❌ Revise & Retry';
      verdict.textContent = v;
      verdict.style.cssText = 'width:fit-content;padding:10px 24px;font-size:14px;margin:20px auto 0;display:inline-block;';
    }
  } catch (e) { console.error('[RESULTS] Verdict error:', e); }

  // Title
  try {
    const title = $('results-title');
    if (title) title.innerHTML = 'Your Score: <span class="gradient-text">' + results.percentage + '%</span>';
  } catch (e) { console.error('[RESULTS] Title error:', e); }

  // Section bars
  try { renderSectionBars(results.subjectMap); } catch (e) { console.error('[RESULTS] Bars error:', e); }

}

function renderSectionBars(subjectMap) {
  const bars = $('section-bars');
  if (!bars) return;
  bars.innerHTML = '';

  Object.entries(subjectMap).forEach(([subj, data]) => {
    const pct = data.total ? Math.round((data.correct / data.total) * 100) : 0;
    const div = document.createElement('div');
    div.className = 'section-bar-item';
    div.innerHTML =
      '<div class="section-bar-label"><span>' + subj + '</span><span>' + data.correct + '/' + data.total + ' (' + pct + '%)</span></div>' +
      '<div class="section-bar-track"><div class="section-bar-fill" style="width:0%" data-pct="' + pct + '"></div></div>';
    bars.appendChild(div);
  });

  setTimeout(() => {
    bars.querySelectorAll('.section-bar-fill').forEach(bar => {
      bar.style.width = bar.dataset.pct + '%';
    });
  }, 400);
}

// ── Animate Counter ───────────────────────────────────────────
function animateCounter(el, from, to, duration, suffix = '') {
  const start = performance.now();
  const diff  = to - from;

  function step(now) {
    const t     = Math.min((now - start) / duration, 1);
    const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const val   = from + diff * eased;
    el.textContent = (Number.isInteger(to) ? Math.round(val) : val.toFixed(1)) + suffix;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ── Confetti ──────────────────────────────────────────────────
function launchConfetti() {
  const colors = ['#7c3aed','#6366f1','#22d3ee','#f59e0b','#10b981','#f43f5e','#a78bfa','#fbbf24'];
  for (let i = 0; i < 120; i++) {
    setTimeout(() => {
      const piece = create('div', 'confetti-piece');
      piece.style.cssText = `
        left:${Math.random()*100}vw;top:-20px;
        background:${colors[Math.floor(Math.random()*colors.length)]};
        width:${Math.random()*10+6}px;height:${Math.random()*10+6}px;
        border-radius:${Math.random()>0.5?'50%':'2px'};
        animation-duration:${Math.random()*2.5+2}s;
        animation-delay:${Math.random()*0.5}s;
      `;
      document.body.appendChild(piece);
      setTimeout(() => piece.remove(), 4500);
    }, i * 15);
  }
}
// ── Print Full Paper as PDF ──────────────────────────────────
function printFullPaper() {
  if (!State.questions.length) {
    toast('No questions to print', 'warning');
    return;
  }

  const results = calculateResults();
  const totalQ = State.questions.length;
  const answered = Object.keys(State.userAnswers).length;

  // Build question HTML
  let questionsHtml = '';
  State.questions.forEach((q, i) => {
    const userAns = State.userAnswers[i];
    const correctAns = q.correctAnswer ? String(q.correctAnswer).trim().toUpperCase() : '';
    const isCorrect = userAns === correctAns;
    const isWrong = userAns && userAns !== correctAns;
    const isSkipped = userAns === undefined;

    const statusIcon = isCorrect ? '✅' : isWrong ? '❌' : '⬜';
    const statusText = isCorrect ? 'Correct' : isWrong ? 'Wrong' : 'Not Attempted';
    const statusColor = isCorrect ? '#10b981' : isWrong ? '#f43f5e' : '#9ca3af';

    let optionsHtml = '';
    ['A', 'B', 'C', 'D'].forEach(key => {
      const isUserChoice = userAns === key;
      const isCorrectOpt = key === correctAns;

      let optBg = '#ffffff';
      let optBorder = '#e5e7eb';
      let optColor = '#374151';
      let label = '';

      if (isCorrectOpt && isUserChoice) {
        optBg = '#d1fae5'; optBorder = '#10b981'; label = ' ✅ Your Answer (Correct)';
      } else if (isCorrectOpt) {
        optBg = '#d1fae5'; optBorder = '#10b981'; label = ' ✅ Correct Answer';
      } else if (isUserChoice) {
        optBg = '#ffe4e6'; optBorder = '#f43f5e'; label = ' ❌ Your Answer';
      }

      optionsHtml += `
        <div style="display:flex;align-items:flex-start;gap:10px;padding:8px 12px;margin:4px 0;border-radius:8px;border:1.5px solid ${optBorder};background:${optBg};">
          <div style="width:28px;height:28px;border-radius:6px;border:1.5px solid ${optBorder};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:${optColor};flex-shrink:0;${isCorrectOpt ? 'background:#10b981;color:white;border-color:#10b981;' : isUserChoice ? 'background:#f43f5e;color:white;border-color:#f43f5e;' : ''}">${key}</div>
          <div style="font-size:13px;line-height:1.6;color:#374151;padding-top:4px;flex:1;">${q.options[key]}${label ? `<span style="font-size:11px;font-weight:600;color:${isCorrectOpt ? '#059669' : '#e11d48'};margin-left:8px;">${label}</span>` : ''}</div>
        </div>`;
    });

    questionsHtml += `
      <div style="page-break-inside:avoid;margin-bottom:24px;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;${i > 0 ? '' : ''}">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#f9fafb;border-bottom:1px solid #e5e7eb;">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <span style="background:#6366f1;color:white;padding:4px 12px;border-radius:8px;font-weight:700;font-size:13px;">Q.${i + 1}</span>
            <span style="background:#ede9fe;color:#6366f1;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;">${q.subject}</span>
            <span style="background:${q.difficulty === 'Easy' ? '#d1fae5' : q.difficulty === 'Hard' ? '#ffe4e6' : '#fef3c7'};color:${q.difficulty === 'Easy' ? '#059669' : q.difficulty === 'Hard' ? '#e11d48' : '#d97706'};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;">${q.difficulty}</span>
          </div>
          <span style="font-size:12px;font-weight:700;color:${statusColor};">${statusIcon} ${statusText}</span>
        </div>

        <div style="padding:16px;">
          <p style="font-size:14px;line-height:1.7;color:#111827;margin-bottom:14px;font-weight:500;">${q.question}</p>
          ${optionsHtml}

          <div style="margin-top:14px;padding:14px;background:#f5f3ff;border-radius:10px;border-left:4px solid #7c3aed;">
            <div style="font-size:11px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">💡 Explanation</div>
            <div style="font-size:13px;line-height:1.7;color:#4b5563;">${q.explanation || 'No detailed explanation provided.'}</div>
          </div>
          ${q.topic ? `<div style="margin-top:8px;font-size:11px;color:#9ca3af;">Topic: ${q.topic}</div>` : ''}
        </div>
      </div>`;
  });

  // Build the full document
  const printHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AIIMS CRE 2026 — Full Paper with Answers</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', system-ui, sans-serif; color: #111827; background: white; line-height: 1.6; }
    @page { margin: 1cm; }
    @media print {
      body { font-size: 12px; }
      .no-print { display: none !important; }
      .page-break { page-break-before: always; }
    }
  </style>
</head>
<body style="max-width:900px;margin:0 auto;padding:24px;">

  <!-- Header -->
  <div style="text-align:center;margin-bottom:32px;padding-bottom:20px;border-bottom:3px solid #6366f1;">
    <div style="font-size:11px;font-weight:700;color:#6366f1;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:8px;">AI-Predicted Question Paper</div>
    <h1 style="font-size:26px;font-weight:800;color:#111827;margin-bottom:6px;">AIIMS CRE 2026 — Pharmacist Grade II</h1>
    <p style="color:#6b7280;font-size:13px;">Generated by ${State.provider === 'gemini' ? 'Gemini 3.1 Pro' : 'Claude Sonnet'} AI · ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
  </div>

  <!-- Score Summary -->
  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:32px;">
    <div style="text-align:center;padding:16px 8px;border-radius:12px;background:#f9fafb;border:1px solid #e5e7eb;">
      <div style="font-size:24px;font-weight:800;color:#6366f1;">${totalQ}</div>
      <div style="font-size:10px;color:#9ca3af;font-weight:600;text-transform:uppercase;">Total</div>
    </div>
    <div style="text-align:center;padding:16px 8px;border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0;">
      <div style="font-size:24px;font-weight:800;color:#10b981;">${results.correct}</div>
      <div style="font-size:10px;color:#059669;font-weight:600;text-transform:uppercase;">Correct</div>
    </div>
    <div style="text-align:center;padding:16px 8px;border-radius:12px;background:#fff1f2;border:1px solid #fecdd3;">
      <div style="font-size:24px;font-weight:800;color:#f43f5e;">${results.wrong}</div>
      <div style="font-size:10px;color:#e11d48;font-weight:600;text-transform:uppercase;">Wrong</div>
    </div>
    <div style="text-align:center;padding:16px 8px;border-radius:12px;background:#fffbeb;border:1px solid #fde68a;">
      <div style="font-size:24px;font-weight:800;color:#f59e0b;">${results.skipped}</div>
      <div style="font-size:10px;color:#d97706;font-weight:600;text-transform:uppercase;">Skipped</div>
    </div>
    <div style="text-align:center;padding:16px 8px;border-radius:12px;background:#ede9fe;border:1px solid #c4b5fd;">
      <div style="font-size:24px;font-weight:800;color:#7c3aed;">${results.percentage}%</div>
      <div style="font-size:10px;color:#6d28d9;font-weight:600;text-transform:uppercase;">Score</div>
    </div>
  </div>

  <!-- Score Details -->
  <div style="display:flex;gap:20px;margin-bottom:32px;padding:16px;background:#f9fafb;border-radius:12px;border:1px solid #e5e7eb;font-size:13px;">
    <div><strong>Raw Score:</strong> ${results.rawScore}/${results.maxScore}</div>
    <div><strong>Penalty (−⅓):</strong> <span style="color:#f43f5e;">−${results.penalty.toFixed(2)}</span></div>
    <div><strong>Final Score:</strong> <span style="color:#6366f1;font-weight:700;">${results.finalScore}/${results.maxScore}</span></div>
    <div><strong>Marking:</strong> +1 correct, −⅓ wrong, 0 skipped</div>
  </div>

  <!-- Print Button -->
  <div class="no-print" style="text-align:center;margin-bottom:32px;">
    <button onclick="window.print()" style="background:#6366f1;color:white;border:none;padding:14px 40px;border-radius:999px;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit;">🖨️ Print / Save as PDF</button>
    <p style="color:#9ca3af;font-size:12px;margin-top:8px;">Use "Save as PDF" in the print dialog to download</p>
  </div>

  <!-- Questions -->
  <h2 style="font-size:18px;font-weight:800;margin-bottom:20px;color:#111827;">📋 Questions & Answers</h2>
  ${questionsHtml}

  <!-- Footer -->
  <div style="text-align:center;margin-top:40px;padding-top:20px;border-top:2px solid #e5e7eb;color:#9ca3af;font-size:11px;">
    <p>AIIMS CRE 2026 AI-Predicted Paper · Generated ${new Date().toLocaleString('en-IN')}</p>
    <p>Powered by Claude Sonnet AI · For practice only — not affiliated with AIIMS</p>
  </div>

</body>
</html>`;

  // Open in new window for printing
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    toast('Pop-up blocked! Please allow pop-ups to print.', 'error', 5000);
    return;
  }
  printWindow.document.write(printHtml);
  printWindow.document.close();
  printWindow.focus();

  // Auto-trigger print dialog after content loads
  printWindow.onload = () => {
    setTimeout(() => printWindow.print(), 500);
  };
}

// ── Utility ───────────────────────────────────────────────────
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (!signal) return;
    if (signal.aborted) { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); return; }
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

// ── Mobile Palette Toggle ────────────────────────────────────
function toggleMobilePalette() {
  const panel = document.querySelector('.palette-panel');
  const overlay = $('palette-overlay');
  if (!panel) return;

  const isOpen = panel.classList.contains('mobile-open');
  if (isOpen) {
    closeMobilePalette();
  } else {
    panel.classList.add('mobile-open');
    if (overlay) overlay.classList.add('active');
  }
}

function closeMobilePalette() {
  const panel = document.querySelector('.palette-panel');
  const overlay = $('palette-overlay');
  if (panel) panel.classList.remove('mobile-open');
  if (overlay) overlay.classList.remove('active');
}

// ── Touch Swipe Gestures (mobile question navigation) ────────
function initSwipeGestures() {
  const examMain = document.querySelector('.exam-main-scroll');
  if (!examMain) return;

  let touchStartX = 0;
  let touchStartY = 0;
  const MIN_SWIPE = 50;

  examMain.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
  }, { passive: true });

  examMain.addEventListener('touchend', (e) => {
    if (!State.examStarted || State.examSubmitted) return;
    const dx = e.changedTouches[0].screenX - touchStartX;
    const dy = e.changedTouches[0].screenY - touchStartY;

    // Only handle horizontal swipes (ignore vertical scrolling)
    if (Math.abs(dx) < MIN_SWIPE || Math.abs(dy) > Math.abs(dx)) return;

    if (dx < 0 && State.currentIndex + 1 < State.questions.length) {
      // Swipe left → next
      navigateToQuestion(State.currentIndex + 1);
    } else if (dx > 0 && State.currentIndex > 0) {
      // Swipe right → prev
      navigateToQuestion(State.currentIndex - 1);
    }
  }, { passive: true });
}

// ══════════════════════════════════════════════════════════════
// EVENT WIRING (all in one place, safe null handling)
// ══════════════════════════════════════════════════════════════

function wireEvents() {
  // ── Hero ──
  on('btn-hero-start', 'click', () => {
    if (hasActiveKey()) showScreen('screen-config');
    else showScreen('screen-api');
  });

  // ── API Screen ──
  on('btn-back-hero', 'click', () => showScreen('screen-hero'));

  // Model tab switching
  const providerTabs = document.querySelectorAll('[data-provider]');
  providerTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const provider = tab.dataset.provider;
      // Update tab active states
      providerTabs.forEach(t => {
        t.classList.toggle('active', t.dataset.provider === provider);
        t.setAttribute('aria-selected', String(t.dataset.provider === provider));
      });
      // Toggle panels
      const geminiPanel    = $('provider-gemini');
      const replicatePanel = $('provider-replicate');
      if (geminiPanel)    geminiPanel.style.display    = provider === 'gemini'    ? '' : 'none';
      if (replicatePanel) replicatePanel.style.display = provider === 'replicate' ? '' : 'none';
    });
  });

  // Gemini key events
  on('toggle-eye-gemini', 'click', () => {
    const inp = $('gemini-key-input');
    const btn = $('toggle-eye-gemini');
    if (!inp || !btn) return;
    inp.type = inp.type === 'password' ? 'text' : 'password';
    btn.textContent = inp.type === 'password' ? '👁️' : '🙈';
  });
  on('gemini-key-input', 'keydown', (e) => { if (e.key === 'Enter') verifyAndSaveGeminiKey(); });
  on('btn-save-gemini', 'click', verifyAndSaveGeminiKey);

  // Gemini model selector
  on('gemini-model-select', 'change', () => {
    const sel = $('gemini-model-select');
    if (sel) {
      State.geminiModel = sel.value;
      try { localStorage.setItem('aiims_gemini_model', sel.value); } catch (_) {}
    }
  });

  // Replicate key events
  on('toggle-eye', 'click', () => {
    const inp = $('api-key-input');
    const btn = $('toggle-eye');
    if (!inp || !btn) return;
    inp.type = inp.type === 'password' ? 'text' : 'password';
    btn.textContent = inp.type === 'password' ? '👁️' : '🙈';
  });

  on('api-key-input', 'keydown', (e) => { if (e.key === 'Enter') verifyAndSaveKey(); });
  on('btn-save-api', 'click', verifyAndSaveKey);

  // ── Config Screen ──
  on('btn-back-api', 'click', () => showScreen('screen-api'));

  // Mode tabs
  $$('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.mode-tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected','false'); });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      State.examConfig.mode = tab.dataset.mode;

      if (tab.dataset.mode === 'quick') {
        if ($('q-count-slider'))  $('q-count-slider').value = 25;
        if ($('q-count-display')) $('q-count-display').textContent = '25';
        State.examConfig.questionCount = 25;
      } else if (tab.dataset.mode === 'full') {
        if ($('q-count-slider'))  $('q-count-slider').value = 100;
        if ($('q-count-display')) $('q-count-display').textContent = '100';
        State.examConfig.questionCount = 100;
      }

      setQCountControlsEnabled(tab.dataset.mode !== 'quick');
    });
  });

  // Select all
  on('btn-select-all', 'click', () => {
    const chips = $$('.subject-chip');
    const allSelected = State.examConfig.subjects.length === SUBJECTS.length;
    if (allSelected) {
      State.examConfig.subjects = [SUBJECTS[0].id];
      chips.forEach((c, i) => {
        c.classList.toggle('selected', i === 0);
        c.setAttribute('aria-checked', i === 0 ? 'true' : 'false');
      });
    } else {
      State.examConfig.subjects = SUBJECTS.map(s => s.id);
      chips.forEach(c => { c.classList.add('selected'); c.setAttribute('aria-checked','true'); });
    }
  });

  // Q-count slider
  on('q-count-slider', 'input', (e) => {
    if (State.examConfig.mode === 'quick') return; // locked to 25 in Quick Quiz mode
    const val = parseInt(e.target.value, 10);
    if ($('q-count-display')) $('q-count-display').textContent = String(val);
    State.examConfig.questionCount = val;
  });

  // Quick count buttons
  $$('[data-qcount]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (State.examConfig.mode === 'quick') return; // locked to 25 in Quick Quiz mode
      const val = parseInt(btn.dataset.qcount, 10);
      if ($('q-count-slider'))  $('q-count-slider').value = val;
      if ($('q-count-display')) $('q-count-display').textContent = String(val);
      State.examConfig.questionCount = val;
    });
  });

  // Difficulty
  $$('[data-diff]').forEach(pill => {
    pill.addEventListener('click', () => {
      $$('[data-diff]').forEach(p => { p.className = 'diff-pill'; });
      const d = pill.dataset.diff;
      pill.className = `diff-pill active-${d === 'Easy' ? 'easy' : d === 'Hard' ? 'hard' : 'medium'}`;
      State.examConfig.difficulty = d;
    });
  });

  on('btn-generate', 'click', startGeneration);
  on('btn-cancel-generation', 'click', cancelGeneration);

  // ── Exam Navigation ──
  on('btn-next', 'click', () => {
    if (State.currentIndex + 1 < State.questions.length) {
      navigateToQuestion(State.currentIndex + 1);
    } else {
      toast('Last question — click Submit when ready.', 'info');
    }
  });

  on('btn-prev', 'click', () => {
    if (State.currentIndex > 0) navigateToQuestion(State.currentIndex - 1);
  });

  on('btn-mark-review', 'click', () => {
    if (!State.examStarted || State.examSubmitted) return;
    const i = State.currentIndex;
    if (State.markedForReview.has(i)) {
      State.markedForReview.delete(i);
      toast('Removed from review', 'info', 1500);
    } else {
      State.markedForReview.add(i);
      toast('Marked for review 🏷️', 'info', 1500);
    }
    updatePaletteButtonClass(i);
    saveExamSnapshot();
  });

  on('btn-clear', 'click', () => {
    if (!State.examStarted || State.examSubmitted) return;
    if (!State.questions.length) return;
    const i = State.currentIndex;
    // In instant feedback mode, can't clear a locked (answered) question
    if (State.userAnswers[i] !== undefined) {
      toast('Answer locked in instant feedback mode', 'info', 1500);
      return;
    }
    delete State.userAnswers[i];
    renderOptions(State.questions[i], i);
    updatePaletteButtonClass(i);
    updatePaletteStats();
    saveExamSnapshot();
  });

  // Mobile palette toggle
  on('mobile-palette-btn', 'click', toggleMobilePalette);
  on('palette-overlay', 'click', closeMobilePalette);

  // ── Submit — THE FIX ──
  on('btn-submit-exam',   'click', () => openSubmitModal());
  on('btn-submit-exam-2', 'click', () => openSubmitModal());
  on('btn-confirm-submit','click', () => doSubmitExam());
  on('btn-cancel-submit', 'click', () => closeSubmitModal());

  // Close modal on overlay click
  on('submit-modal', 'click', (e) => {
    if (e.target === $('submit-modal')) closeSubmitModal();
  });

  // ── Results ──
  on('btn-new-paper', 'click', () => {
    resetExamState();
    showScreen('screen-config');
  });

  on('btn-retry', 'click', () => {
    State.userAnswers    = {};
    State.markedForReview = new Set();
    State.currentIndex   = 0;
    State.examSubmitted  = false;
    State.examStarted    = false;
    State.timeLeft       = State.totalTimeSecs || Math.round(State.questions.length * 1.2) * 60;
    initExamInterface();
    showScreen('screen-exam');
  });

  on('btn-print', 'click', () => printFullPaper());

  // ── Keyboard Shortcuts ──
  document.addEventListener('keydown', (e) => {
    // Only active during an exam
    if (!State.examStarted || State.examSubmitted) return;
    // Don't capture if typing in an input
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown':
        e.preventDefault();
        if (State.currentIndex + 1 < State.questions.length) navigateToQuestion(State.currentIndex + 1);
        break;
      case 'ArrowLeft': case 'ArrowUp':
        e.preventDefault();
        if (State.currentIndex > 0) navigateToQuestion(State.currentIndex - 1);
        break;
      case 'a': case 'b': case 'c': case 'd':
      case 'A': case 'B': case 'C': case 'D':
        selectAnswer(State.currentIndex, e.key.toUpperCase());
        break;
      case 'm': case 'M':
        $('btn-mark-review')?.click();
        break;
    }
  });
}

function resetExamState() {
  clearInterval(State.timerInterval);
  State.timerInterval  = null;
  State.questions      = [];
  State.userAnswers    = {};
  State.markedForReview = new Set();
  State.currentIndex   = 0;
  State.examStarted    = false;
  State.examSubmitted  = false;
  State.timeLeft       = 0;
  State.totalTimeSecs  = 0;
  clearExamSnapshot();
}

// ── Exam Snapshot (survive page refresh mid-exam) ────────────
const EXAM_SNAPSHOT_KEY = 'aiims_exam_snapshot';

function saveExamSnapshot() {
  if (!State.examStarted || State.examSubmitted) return;
  try {
    localStorage.setItem(EXAM_SNAPSHOT_KEY, JSON.stringify({
      questions: State.questions,
      userAnswers: State.userAnswers,
      markedForReview: Array.from(State.markedForReview),
      currentIndex: State.currentIndex,
      timeLeft: State.timeLeft,
      totalTimeSecs: State.totalTimeSecs,
    }));
  } catch (_) { /* localStorage blocked or full */ }
}

function clearExamSnapshot() {
  try { localStorage.removeItem(EXAM_SNAPSHOT_KEY); } catch (_) {}
}

function loadExamSnapshot() {
  try {
    const raw = localStorage.getItem(EXAM_SNAPSHOT_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    if (!snap || !Array.isArray(snap.questions) || snap.questions.length === 0) return null;
    return snap;
  } catch (_) { return null; }
}

function resumeExamFromSnapshot(snap) {
  State.questions       = snap.questions;
  State.userAnswers     = snap.userAnswers || {};
  State.markedForReview = new Set(snap.markedForReview || []);
  State.currentIndex    = snap.currentIndex || 0;
  State.timeLeft        = snap.timeLeft || 0;
  State.totalTimeSecs   = snap.totalTimeSecs || 0;
  State.examSubmitted   = false;
  State.examStarted     = false;

  initExamInterface();
  showScreen('screen-exam');
}

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════

function init() {
  initParticles();
  loadSavedKeys();
  renderSubjectGrid();
  wireEvents();
  initSwipeGestures();

  // Ripple on all buttons
  $$('.btn').forEach(btn => addRipple(btn));
  initTilt('.hero-stat-card');

  // Hero "API Ready" indicator — show which provider is active
  if (hasActiveKey()) {
    const heroBadge = document.querySelector('.hero-badge');
    const provLabel = State.provider === 'gemini' ? 'Gemini Ready' : 'Claude Ready';
    if (heroBadge && !heroBadge.querySelector('.api-ready-tag')) {
      heroBadge.innerHTML += ` · <span class="api-ready-tag" style="color:var(--emerald);font-weight:700;">${provLabel} ✓</span>`;
    }
  }

  // Default difficulty
  const defaultDiff = document.querySelector('[data-diff="Mixed"]');
  if (defaultDiff) defaultDiff.className = 'diff-pill active-medium';

  // Ensure modal is hidden on init
  closeSubmitModal();

  // Offer to resume an in-progress exam interrupted by a refresh/crash
  const snapshot = loadExamSnapshot();
  if (snapshot) {
    if (window.confirm(`You have an unfinished exam (${snapshot.questions.length} questions). Resume where you left off?`)) {
      resumeExamFromSnapshot(snapshot);
    } else {
      clearExamSnapshot();
    }
  }

  console.log('%c AIIMS CRE 2026 AI Exam Generator ', 'background:#7c3aed;color:white;font-size:16px;padding:8px 16px;border-radius:8px;font-weight:bold;');
  console.log('%c Powered by Gemini 3.1 Pro & Claude Sonnet 4.6 ', 'color:#22d3ee;font-size:12px;');
}

document.addEventListener('DOMContentLoaded', init);
