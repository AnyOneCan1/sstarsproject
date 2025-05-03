// ───────── CONFIG ─────────
const SHEET_ENDPOINT   = 'https://script.google.com/macros/s/AKfycbyzUrGRF4lDc0xVVWk1CKUWKk5Bg0fmGUXMQjlzqMQFC8OSs_9t99GSzqO0SgQsKwlT/exec';
const API_KEY          = 'AIzaSyBeYsmwrdh0OTxBxPlfB2OtIUZxRxREHiI';
const MODEL            = 'gemini-2.0-flash';
const ENDPOINT         = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
const MAX_WORDS        = 50;
const COOLDOWN         = 5;             // ثواني بين الإرسال
const TOTAL_QUESTIONS  = 5;             // عدد الأسئلة قبل التوصيات النهائية / النصائح
const DAY_MS           = 24*60*60*1000; // مللي ثواني في 24 ساعة
const HOME_URL         = 'index.html';  // رابط الصفحة الرئيسية

// ───────── ELEMENTS ─────────
const form             = document.getElementById('talentForm');
const otherTalentInput = document.getElementById('otherTalent');
const talentSelect     = document.getElementById('talent');
const goalField        = document.getElementById('goalField');
const goalTextarea     = document.getElementById('goal');
const successModal     = document.getElementById('successModal');
const closeModalBtn    = document.getElementById('closeModal');

const cooldownNotice   = document.getElementById('cooldownNotice');
const aiContainer      = document.getElementById('aiContainer');
const loadingEl        = document.getElementById('loading');
const progressEl       = document.getElementById('progress');
const chatEl           = document.getElementById('chat');
const answerEl         = document.getElementById('answer');
const wordCounter      = document.getElementById('wordCounter');
const submitBtn        = document.getElementById('submit');
const restartBtn       = document.getElementById('restart');
const homeBtn          = document.getElementById('homeBtn');

// ───────── 24h COOLDOWN CHECK ─────────
const lastRun = localStorage.getItem('lastTestRun');
if (lastRun && Date.now() - +lastRun < DAY_MS) {
  const diff = DAY_MS - (Date.now() - +lastRun);
  const hrs  = Math.floor(diff/3600000);
  const mins = Math.floor((diff%3600000)/60000);
  cooldownNotice.textContent = `يمكنك إعادة الاختبار بعد ${hrs} س و${mins} د.`;
  cooldownNotice.classList.remove('hidden');
  form.querySelector('button[type=submit]').disabled = true;
}

// ───────── WIRING ─────────
// عند تغيير الهواية: إظهار حقل "أخرى" وإخفاء/إظهار سؤال الهدف
talentSelect.addEventListener('change', () => {
  const showOther = talentSelect.value === 'أخرى';
  otherTalentInput.classList.toggle('hidden', !showOther);
  otherTalentInput.required = showOther;

  // إخفاء سؤال الهدف الرياضي عند اختيار "لا أعلم"
  const hideGoal = talentSelect.value === 'لا أعلم';
  if (goalField) {
    goalField.classList.toggle('hidden', hideGoal);
    goalTextarea.required = !hideGoal;
  }
});

// غلق المودال وإعادة تحميل الصفحة
closeModalBtn.addEventListener('click', () => {
  successModal.style.display = 'none';
  window.location.reload();
});

// ───────── HELPERS ─────────
let conversation = [];
function appendMessage(role, text) {
  conversation.push({ role, text });
  const msg = document.createElement('div');
  msg.className = `message ${role}`;
  msg.innerHTML = text.replace(/\n/g,'<br>');
  chatEl.append(msg);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function countWords(txt) {
  return txt.trim().split(/\s+/).filter(w => w).length;
}
answerEl.addEventListener('input', () => {
  const cnt = countWords(answerEl.value);
  wordCounter.textContent = `${Math.min(cnt,MAX_WORDS)} / ${MAX_WORDS} كلمات`;
  wordCounter.style.color = cnt > MAX_WORDS ? 'red' : '#555';
  submitBtn.disabled = cnt === 0 || cnt > MAX_WORDS;
});

function startCooldown() {
  let rem = COOLDOWN;
  submitBtn.disabled = answerEl.disabled = true;
  const orig = submitBtn.textContent;
  const timer = setInterval(() => {
    submitBtn.textContent = `انتظر ${rem--} ث`;
    if (rem < 0) {
      clearInterval(timer);
      submitBtn.textContent = orig;
      submitBtn.disabled = answerEl.disabled = false;
    }
  }, 1000);
}

function recordRun() {
  localStorage.setItem('lastTestRun', Date.now().toString());
}

// ───────── CALL GEMINI ─────────
let greeted = false;
async function callGemini(ctx, userPrompt, phase = 'question') {
  // phase: 'question' أو 'final'
  let systemInstruction;
  if (phase === 'question') {
    systemInstruction =
      `أنت "مستكشف هوايات" ودود. اطرح سؤالاً واحداً يستكشف اهتمامات المستخدم وميوله تجاه الأنشطة، بدون تقديم نصائح أو اقتراح هواية جديدة. لا تتجاوز 100 كلمة.`;
  } else {
    // إذا لم يحدد هواية يختار "لا أعلم" → قدم اقتراحات هوايات
    if (ctx.includes('لا أعلم')) {
      systemInstruction =
        `أنت مساعد ودود. قدم قائمة بـ3 هوايات مناسبة للمستخدم بناءً على إجاباته السابقة، ثم جملة نصيحة عامة واحدة. لا تتجاوز 100 كلمة.`;
    } else {
      // المستخدم يعرف هوايته → قدم نصائح لتحسين مهاراته في هذه الهواية
      systemInstruction =
        `أنت خبير في تنمية المهارات. قدم 3 نصائح عملية لتحسين أداء المستخدم في هوايته المحددة "${ctx}". لا تتجاوز 100 كلمة.`;
    }
  }

  loadingEl.classList.remove('hidden');
  let inputText = '';
  if (!greeted) {
    inputText += (phase === 'question'
      ? `مرحبًا! `
      : `شكرًا لإجاباتك. `);
    greeted = true;
  }
  inputText += userPrompt;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents:          [{ role: 'user', parts: [{ text: inputText }] }]
    })
  });
  loadingEl.classList.add('hidden');

  if (!res.ok) {
    const e = await res.json().catch(() => null);
    throw new Error(e?.error?.message || res.statusText);
  }
  const j = await res.json();
  return j.candidates[0].content.parts[0].text.trim();
}

// ───────── STATE & CHAT FLOW ─────────
let systemCtx     = '';
let questionCount = 0;
let adviceDone    = false;
let restartUsed   = false;

// بداية الأسئلة عند الإرسال الأول
form.addEventListener('submit', async e => {
  e.preventDefault();
  const fd     = new FormData(form);
  const rawTal = fd.get('talent');
  const talent = rawTal === 'أخرى'
    ? fd.get('otherTalent')
    : rawTal === '' ? 'لا أعلم' : rawTal;

  // جهز الـ system context بناءً على الهواية
  systemCtx = (talent === 'لا أعلم')
    ? `لا أعلم`
    : talent;

  form.classList.add('hidden');
  aiContainer.classList.remove('hidden');
  progressEl.textContent = `السؤال 1 من ${TOTAL_QUESTIONS}`;
  progressEl.classList.remove('hidden');

  try {
    const q = await callGemini(systemCtx, 'اطرح سؤالك الأول.', 'question');
    appendMessage('assistant', q);
    questionCount = 1;
  } catch(err) {
    appendMessage('assistant', 'خطأ: ' + err.message);
  }
});

// التعامل مع الإجابات
submitBtn.addEventListener('click', async () => {
  const txt = answerEl.value.trim();
  const w   = countWords(txt);
  if (!w)            return alert('أرجو كتابة إجابة.');
  if (w > MAX_WORDS) return alert(`الحد ${MAX_WORDS} كلمة، كتبت ${w}.`);

  appendMessage('user', txt);
  startCooldown();

  if (!adviceDone) {
    if (questionCount < TOTAL_QUESTIONS) {
      // أسئلة استكشافية
      try {
        const q = await callGemini(systemCtx, `إجابة المستخدم: "${txt}".`, 'question');
        appendMessage('assistant', q);
        questionCount++;
        progressEl.textContent = `السؤال ${questionCount} من ${TOTAL_QUESTIONS}`;
        answerEl.value = '';
      } catch(err) {
        appendMessage('assistant', 'خطأ: ' + err.message);
      }
    } else {
      // المرحلة النهائية ← نصائح أو اقتراحات
      try {
        const adv = await callGemini(systemCtx, `إجابة المستخدم الأخيرة: "${txt}".`, 'final');
        appendMessage('assistant', adv);
      } catch(err) {
        appendMessage('assistant', 'خطأ: ' + err.message);
      }
      adviceDone = true;
      recordRun();

      // عرض عداد 24 ساعة
      const next = +localStorage.getItem('lastTestRun') + DAY_MS;
      const rem  = next - Date.now();
      const hrs  = Math.floor(rem/3600000);
      const mins = Math.floor((rem%3600000)/60000);
      cooldownNotice.textContent = `يمكنك إعادة الاختبار بعد ${hrs} س و${mins} د.`;
      cooldownNotice.classList.remove('hidden');

      progressEl.classList.add('hidden');
      restartBtn.classList.add('hidden');
      homeBtn.classList.remove('hidden');
      submitBtn.disabled = answerEl.disabled = true;

      // وأخيراً أرسل النتائج إلى Google sheet
      const base = Object.fromEntries(new FormData(form).entries());
      fetch(SHEET_ENDPOINT, {
        method: 'POST', mode: 'no-cors',
        headers:{ 'Content-Type':'application/json' },
        body:   JSON.stringify({ ...base, answers: conversation })
      }).catch(console.error);
    }
  }
});

// إعادة البدء مرة واحدة فقط
restartBtn.addEventListener('click', () => {
  if (restartUsed) return;
  restartUsed      = true;
  conversation     = [];
  chatEl.innerHTML = '';
  progressEl.classList.add('hidden');
  restartBtn.classList.add('hidden');
  homeBtn.classList.add('hidden');
  form.reset();
  form.classList.remove('hidden');
  aiContainer.classList.add('hidden');
  greeted         = false;
  questionCount   = 0;
  adviceDone      = false;
  submitBtn.disabled = answerEl.disabled = false;
  wordCounter.textContent = `0 / ${MAX_WORDS} كلمات`;
});

// زر العودة للرئيسية
homeBtn.addEventListener('click', () => {
  window.location.href = HOME_URL;
});
