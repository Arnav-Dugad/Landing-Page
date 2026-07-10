/* ===========================================================================
   effects.js  (classic script)
   Ambient / sensory layer: audio UI clicks, starfield, confetti, custom cursor,
   magnetic buttons, scroll progress + scroll-to-top, live clock, opt-in weather.
   No project data here.
   =========================================================================== */

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* -------- Audio UI effects ---------------------------------------------- */
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let isMuted = true; // Muted by default

window.toggleMute = () => {
    isMuted = !isMuted;
    const btn = document.getElementById('muteBtn');
    btn.innerHTML = isMuted ? '<i class="fas fa-volume-mute text-red-400"></i>' : '<i class="fas fa-volume-up"></i>';
    if (!isMuted && audioCtx.state === 'suspended') audioCtx.resume();
    showToast(isMuted ? "Sound Muted" : "Sound Enabled", "info");
};

window.playHoverSound = () => {
    if (isMuted || audioCtx.state === 'suspended') { if (!isMuted) audioCtx.resume(); return; }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 0.05);
    gain.gain.setValueAtTime(0.02, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
    osc.start(); osc.stop(audioCtx.currentTime + 0.05);
};

window.playClickSound = () => {
    if (isMuted) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(600, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(200, audioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
    osc.start(); osc.stop(audioCtx.currentTime + 0.1);
};

/* -------- Scroll progress + scroll-to-top ------------------------------- */
const progressBar = document.getElementById("progress-bar");
const scrollBtn = document.getElementById('scrollTopBtn');
window.addEventListener('scroll', () => {
    const winScroll = document.body.scrollTop || document.documentElement.scrollTop;
    const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const scrolled = height > 0 ? (winScroll / height) * 100 : 0;
    if (progressBar) progressBar.style.width = scrolled + "%";
    if (scrollBtn) scrollBtn.classList.toggle('visible', window.scrollY > 300);
}, { passive: true });

/* -------- Confetti ------------------------------------------------------ */
window.fireConfetti = () => {
    if (prefersReducedMotion) return;
    const canvas = document.getElementById('confetti-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = [];
    const colors = ['#f43f5e', '#ec4899', '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b'];
    for (let i = 0; i < 150; i++) {
        particles.push({
            x: window.innerWidth / 2, y: window.innerHeight / 2,
            w: Math.random() * 10 + 5, h: Math.random() * 10 + 5,
            dx: Math.random() * 10 - 5, dy: Math.random() * 10 - 5,
            color: colors[Math.floor(Math.random() * colors.length)],
            angle: Math.random() * 360, spin: Math.random() * 10 - 5, life: 100
        });
    }
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let active = false;
        particles.forEach(p => {
            if (p.life > 0) {
                active = true;
                p.x += p.dx; p.y += p.dy; p.dy += 0.1; p.life -= 1; p.angle += p.spin;
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.angle * Math.PI / 180);
                ctx.fillStyle = p.color;
                ctx.globalAlpha = p.life / 100;
                ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
                ctx.restore();
            }
        });
        if (active) requestAnimationFrame(animate);
        else ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    animate();
};

/* -------- Live clock ---------------------------------------------------- */
function updateClock() {
    const el = document.getElementById('live-clock');
    if (el) el.innerText = new Date().toLocaleTimeString();
}
setInterval(updateClock, 1000);
updateClock();

/* -------- Weather — OPT-IN (fixes auto geolocation prompt) --------------- */
const weatherEl = document.getElementById('weather-widget');
function fetchWeather() {
    weatherEl.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Loading...`;
    if (!navigator.geolocation) { weatherEl.innerHTML = `<i class="fas fa-ban"></i> No Geo`; return; }
    navigator.geolocation.getCurrentPosition(async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
            const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`);
            const data = await res.json();
            const temp = data.current_weather.temperature;
            const code = data.current_weather.weathercode;
            let icon = "fa-cloud";
            if (code <= 1) icon = "fa-sun";
            else if (code <= 3) icon = "fa-cloud-sun";
            else if (code <= 67) icon = "fa-cloud-rain";
            else if (code <= 77) icon = "fa-snowflake";
            else icon = "fa-bolt";
            weatherEl.innerHTML = `<i class="fas ${icon}"></i> ${temp}°C`;
        } catch (e) {
            weatherEl.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Error`;
        }
    }, () => { weatherEl.innerHTML = `<i class="fas fa-map-marker-alt"></i> Set Loc`; });
}
if (weatherEl) {
    // Only fetch (and prompt for location) when the user clicks — never on load.
    weatherEl.addEventListener('click', fetchWeather);
    weatherEl.innerHTML = `<i class="fas fa-cloud"></i> <span>Weather</span>`;
}

/* -------- Starfield ----------------------------------------------------- */
const canvas = document.getElementById('starfield');
const starCtx = canvas.getContext('2d');
let sfWidth, sfHeight, stars = [];
let mouseX = 0, mouseY = 0;

function initStars() {
    sfWidth = window.innerWidth; sfHeight = window.innerHeight;
    canvas.width = sfWidth; canvas.height = sfHeight;
    stars = [];
    for (let i = 0; i < 100; i++) {
        stars.push({ x: Math.random() * sfWidth, y: Math.random() * sfHeight, size: Math.random() * 2, speed: Math.random() * 0.5 + 0.1 });
    }
}
function animateStars() {
    starCtx.clearRect(0, 0, sfWidth, sfHeight);
    starCtx.fillStyle = "rgba(255, 255, 255, 0.5)";
    const connectDistance = 150;
    stars.forEach(star => {
        starCtx.beginPath();
        starCtx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        starCtx.fill();
        star.y -= star.speed;
        if (star.y < 0) star.y = sfHeight;
        const dx = mouseX - star.x, dy = mouseY - star.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < connectDistance) {
            starCtx.beginPath();
            starCtx.strokeStyle = `rgba(255, 255, 255, ${1 - distance / connectDistance})`;
            starCtx.lineWidth = 0.5;
            starCtx.moveTo(star.x, star.y);
            starCtx.lineTo(mouseX, mouseY);
            starCtx.stroke();
        }
    });
    requestAnimationFrame(animateStars);
}
window.addEventListener('resize', initStars);
initStars();
if (!prefersReducedMotion) animateStars();
else { starCtx.fillStyle = "rgba(255,255,255,0.4)"; stars.forEach(s => { starCtx.beginPath(); starCtx.arc(s.x, s.y, s.size, 0, Math.PI * 2); starCtx.fill(); }); }

/* -------- Custom cursor (+ grows over interactive targets) -------------- */
const cursorDot = document.querySelector('.cursor-dot');
const cursorOutline = document.querySelector('.cursor-outline');
window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX; mouseY = e.clientY;
    if (cursorDot) { cursorDot.style.left = `${e.clientX}px`; cursorDot.style.top = `${e.clientY}px`; }
    if (cursorOutline) {
        cursorOutline.animate({ left: `${e.clientX}px`, top: `${e.clientY}px` }, { duration: 500, fill: "forwards" });
    }
});
document.addEventListener('mouseover', (e) => {
    if (!cursorOutline) return;
    if (e.target.closest('a, button, .project-card, .tag-chip, .icon-option, input, select, textarea, [role="button"]')) {
        cursorOutline.classList.add('cursor-hover');
    } else {
        cursorOutline.classList.remove('cursor-hover');
    }
});

/* -------- Magnetic buttons ---------------------------------------------- */
window.initMagnetic = () => {
    if (prefersReducedMotion) return;
    document.querySelectorAll('.magnetic').forEach(el => {
        if (el.dataset.magneticBound) return;
        el.dataset.magneticBound = '1';
        el.addEventListener('mousemove', (e) => {
            const r = el.getBoundingClientRect();
            const x = e.clientX - r.left - r.width / 2;
            const y = e.clientY - r.top - r.height / 2;
            el.style.transform = `translate(${x * 0.25}px, ${y * 0.35}px)`;
        });
        el.addEventListener('mouseleave', () => { el.style.transform = 'translate(0, 0)'; });
    });
};
window.addEventListener('DOMContentLoaded', () => window.initMagnetic());

/* -------- Hero typing subtitle ------------------------------------------ */
(function typeHeroSubtitle() {
    const el = document.getElementById('typing-text');
    if (!el) return;
    const text = "A collection of interactive web experiences, games, and tools.";
    if (prefersReducedMotion) {
        el.textContent = text;
        el.classList.remove('typing-cursor');
        return;
    }
    let i = 0;
    const tick = () => {
        if (i < text.length) {
            el.textContent += text.charAt(i++);
            setTimeout(tick, 45);
        } else {
            setTimeout(() => el.classList.remove('typing-cursor'), 2000);
        }
    };
    setTimeout(tick, 900);
})();

/* -------- Loading screen — hide once ready (bulletproof) ---------------- */
(function hideLoader() {
    const hide = () => {
        const loader = document.getElementById('loader');
        if (loader) loader.classList.add('loaded');
    };
    window.addEventListener('load', hide);
    // Fallback so a slow/blocked resource can never leave the loader stuck.
    setTimeout(hide, 2200);
})();
