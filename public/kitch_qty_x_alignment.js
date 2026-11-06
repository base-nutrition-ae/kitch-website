/* KITCH — Qty remove (×) button alignment.
   Targets only the × next to an input with placeholder="Qty".
   No changes to other buttons, orders, or stored data. */
(() => {
  'use strict';
  const applied = new WeakMap();
  let pending = false;
  function align() {
    pending = false;
    for (const input of document.querySelectorAll('input[placeholder="Qty"],input[placeholder="qty"]')) {
      const field = input.getBoundingClientRect();
      if (!field.width || !field.height) continue;
      let container = input.parentElement;
      let best = null;
      for (let level = 0; container && level < 5; level++, container = container.parentElement) {
        for (const button of container.querySelectorAll('button')) {
          if (!/^[×✕✖x]$/i.test((button.textContent || '').trim())) continue;
          const box = button.getBoundingClientRect();
          const dx = box.left - field.right;
          const dy = Math.abs((box.top + box.height / 2) - (field.top + field.height / 2));
          if (dx < -12 || dx > 100 || dy > 85) continue;
          const score = Math.abs(dx - 12) + dy;
          if (!best || score < best.score) best = { button, box, score };
        }
        if (best) break;
      }
      if (!best) continue;
      const oldOffset = applied.get(best.button) || 0;
      const difference = (field.top + field.height / 2) - (best.box.top + best.box.height / 2);
      if (Math.abs(difference) < 0.5) continue;
      const offset = oldOffset + difference;
      best.button.style.translate = `0 ${offset.toFixed(2)}px`;
      applied.set(best.button, offset);
    }
  }
  function schedule() {
    if (!pending) { pending = true; requestAnimationFrame(align); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
  else schedule();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('resize', schedule, { passive: true });
})();
