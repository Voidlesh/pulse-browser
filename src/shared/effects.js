// Mouse-reactive background effects for the start page (and the Easy Setup
// preview). Pure canvas 2D, DPR-aware, paused while the document is hidden.

const MAX_DPR = 2

export const EFFECTS = {
  particles: { label: 'Partikel', create: particles },
  aurora: { label: 'Aurora', create: aurora },
  grid: { label: 'Neon-Grid', create: grid },
  stars: { label: 'Sterne', create: stars },
  none: { label: 'Aus', create: null },
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ type: string, accent: string, motion: 'full'|'reduced'|'off', interactive?: boolean }} options
 */
export function createBackground(canvas, options) {
  const ctx = canvas.getContext('2d')
  const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999, inside: false }
  let opts = { interactive: true, ...options }
  let effect = null
  let raf = 0
  let width = 0
  let height = 0
  let createdFor = { w: 0, h: 0 }
  let last = performance.now()

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
    width = canvas.clientWidth
    height = canvas.clientHeight
    canvas.width = Math.max(1, Math.round(width * dpr))
    canvas.height = Math.max(1, Math.round(height * dpr))
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (effect && effect.resize) effect.resize(width, height)
  }

  const onMove = (e) => {
    const r = canvas.getBoundingClientRect()
    mouse.tx = e.clientX - r.left
    mouse.ty = e.clientY - r.top
    if (!mouse.inside) { mouse.x = mouse.tx; mouse.y = mouse.ty }
    mouse.inside = true
  }
  const onLeave = () => { mouse.inside = false }
  const onVisibility = () => {
    cancelAnimationFrame(raf)
    if (!document.hidden && effect && opts.motion !== 'off') {
      last = performance.now()
      raf = requestAnimationFrame(frame)
    }
  }

  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const speed = opts.motion === 'reduced' ? 0.35 : 1
    // Smooth the cursor so effects glide instead of jitter.
    mouse.x += (mouse.tx - mouse.x) * Math.min(1, dt * 10)
    mouse.y += (mouse.ty - mouse.y) * Math.min(1, dt * 10)
    ctx.clearRect(0, 0, width, height)
    if (effect) effect.draw(ctx, dt * speed, opts.interactive && mouse.inside ? mouse : null)
    if (opts.motion !== 'off' && !document.hidden) raf = requestAnimationFrame(frame)
  }

  const start = () => {
    cancelAnimationFrame(raf)
    const def = EFFECTS[opts.type] || EFFECTS.none
    resize()
    createdFor = { w: width, h: height }
    effect = def.create && width > 0 && height > 0 ? def.create(width, height, rgbOf(opts.accent)) : null
    last = performance.now()
    if (!effect) return ctx.clearRect(0, 0, width, height)
    if (opts.motion === 'off') {
      // Static frame: let the effect settle a little first.
      for (let i = 0; i < 30; i++) effect.draw(ctx, 1 / 60, null)
      ctx.clearRect(0, 0, width, height)
      effect.draw(ctx, 0, null)
    } else {
      raf = requestAnimationFrame(frame)
    }
  }

  // Density-based effects (particles, stars) are rebuilt when the size changes a lot,
  // e.g. when the canvas had no layout yet at creation time.
  const ro = new ResizeObserver(() => {
    resize()
    const grew = Math.abs(width - createdFor.w) > createdFor.w * 0.25 || Math.abs(height - createdFor.h) > createdFor.h * 0.25
    if (opts.motion === 'off' || grew || (!effect && opts.type !== 'none')) start()
  })
  ro.observe(canvas)
  window.addEventListener('pointermove', onMove, { passive: true })
  document.documentElement.addEventListener('mouseleave', onLeave)
  window.addEventListener('blur', onLeave)
  document.addEventListener('visibilitychange', onVisibility)
  start()

  return {
    update(next) {
      const restart = next.type !== opts.type || next.accent !== opts.accent || next.motion !== opts.motion
      opts = { ...opts, ...next }
      if (restart) start()
    },
    destroy() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('blur', onLeave)
      document.removeEventListener('visibilitychange', onVisibility)
    },
  }
}

// ---------------------------------------------------------------- effects

function particles(w, h, rgb) {
  const count = Math.min(150, Math.round((w * h) / 11000))
  const pts = Array.from({ length: count }, () => ({
    x: Math.random() * w, y: Math.random() * h,
    vx: (Math.random() - 0.5) * 22, vy: (Math.random() - 0.5) * 22,
    r: 1 + Math.random() * 1.8,
  }))
  const LINK = 120
  const REACH = 170
  return {
    resize(nw, nh) { w = nw; h = nh },
    draw(ctx, dt, mouse) {
      for (const p of pts) {
        if (mouse) {
          const dx = p.x - mouse.x
          const dy = p.y - mouse.y
          const d = Math.hypot(dx, dy)
          if (d < REACH && d > 0.1) {
            // Gentle push away from the cursor.
            const f = (1 - d / REACH) * 260 * dt
            p.vx += (dx / d) * f
            p.vy += (dy / d) * f
          }
        }
        p.vx *= 0.985; p.vy *= 0.985
        if (Math.hypot(p.vx, p.vy) < 8) { p.vx += (Math.random() - 0.5) * 4; p.vy += (Math.random() - 0.5) * 4 }
        p.x += p.vx * dt; p.y += p.vy * dt
        if (p.x < -10) p.x = w + 10; if (p.x > w + 10) p.x = -10
        if (p.y < -10) p.y = h + 10; if (p.y > h + 10) p.y = -10
      }
      ctx.lineWidth = 1
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j]
          const d = Math.hypot(a.x - b.x, a.y - b.y)
          if (d < LINK) {
            ctx.strokeStyle = rgba(rgb, (1 - d / LINK) * 0.35)
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
          }
        }
        if (mouse) {
          const d = Math.hypot(a.x - mouse.x, a.y - mouse.y)
          if (d < REACH * 1.2) {
            ctx.strokeStyle = rgba(rgb, (1 - d / (REACH * 1.2)) * 0.6)
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke()
          }
        }
      }
      // Soft halo + core instead of shadowBlur (much cheaper per frame).
      ctx.fillStyle = rgba(rgb, 0.16)
      for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 3.2, 0, Math.PI * 2); ctx.fill() }
      ctx.fillStyle = rgba(rgb, 0.95)
      for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill() }
    },
  }
}

function aurora(w, h, rgb) {
  const [hue, sat] = hslOf(rgb)
  const blobs = [0, 40, -50, 120].map((shift, i) => ({
    hue: (hue + shift + 360) % 360, phase: i * 1.7, speed: 0.08 + i * 0.03, size: 0.45 + (i % 2) * 0.15,
    x: w / 2, y: h / 2,
  }))
  const follower = { x: w / 2, y: h / 2 }
  let t = 0
  return {
    resize(nw, nh) { w = nw; h = nh },
    draw(ctx, dt, mouse) {
      t += dt
      ctx.globalCompositeOperation = 'lighter'
      blobs.forEach((b, i) => {
        b.x = w * (0.5 + 0.35 * Math.sin(t * b.speed * 2 + b.phase))
        b.y = h * (0.45 + 0.3 * Math.cos(t * b.speed * 1.6 + b.phase * 1.3))
        blob(ctx, b.x, b.y, Math.max(w, h) * b.size, b.hue, sat, 0.16 + (i === 0 ? 0.06 : 0))
      })
      const target = mouse || { x: w / 2 + Math.sin(t * 0.3) * w * 0.2, y: h * 0.4 }
      follower.x += (target.x - follower.x) * Math.min(1, dt * 2.2)
      follower.y += (target.y - follower.y) * Math.min(1, dt * 2.2)
      blob(ctx, follower.x, follower.y, Math.max(w, h) * 0.32, hue, sat, mouse ? 0.3 : 0.18)
      ctx.globalCompositeOperation = 'source-over'
    },
  }
}

function blob(ctx, x, y, r, hue, sat, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, `hsla(${hue}, ${sat}%, 58%, ${alpha})`)
  g.addColorStop(1, `hsla(${hue}, ${sat}%, 50%, 0)`)
  ctx.fillStyle = g
  ctx.fillRect(x - r, y - r, r * 2, r * 2)
}

function grid(w, h, rgb) {
  let offset = 0
  const vp = { x: w / 2, y: h * 0.42 }
  return {
    resize(nw, nh) { w = nw; h = nh },
    draw(ctx, dt, mouse) {
      offset = (offset + dt * 0.35) % 1
      const tx = mouse ? w / 2 + (mouse.x - w / 2) * 0.12 : w / 2
      const ty = mouse ? h * 0.42 + (mouse.y - h / 2) * 0.05 : h * 0.42
      vp.x += (tx - vp.x) * Math.min(1, dt * 4)
      vp.y += (ty - vp.y) * Math.min(1, dt * 4)
      const horizon = vp.y

      const sky = ctx.createLinearGradient(0, horizon - h * 0.35, 0, horizon)
      sky.addColorStop(0, rgba(rgb, 0))
      sky.addColorStop(1, rgba(rgb, 0.22))
      ctx.fillStyle = sky
      ctx.fillRect(0, horizon - h * 0.35, w, h * 0.35)

      ctx.lineWidth = 1.2
      // Horizontal lines rushing towards the viewer.
      for (let i = 0; i < 22; i++) {
        const z = (i + offset) / 22
        const y = horizon + Math.pow(z, 2.4) * (h - horizon)
        const lit = mouse ? Math.max(0, 1 - Math.abs(y - mouse.y) / 120) : 0
        ctx.strokeStyle = rgba(rgb, 0.08 + z * 0.4 + lit * 0.5)
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
      }
      // Vertical lines converging in the vanishing point.
      for (let i = -24; i <= 24; i++) {
        const xBottom = vp.x + i * (w / 14)
        const lit = mouse ? Math.max(0, 1 - Math.abs(xBottom - mouse.x) / 220) : 0
        ctx.strokeStyle = rgba(rgb, 0.12 + lit * 0.5)
        ctx.beginPath(); ctx.moveTo(vp.x + i * 6, horizon); ctx.lineTo(xBottom, h); ctx.stroke()
      }
      const glow = ctx.createRadialGradient(vp.x, horizon, 0, vp.x, horizon, w * 0.45)
      glow.addColorStop(0, rgba(rgb, 0.35))
      glow.addColorStop(1, rgba(rgb, 0))
      ctx.fillStyle = glow
      ctx.fillRect(0, horizon - w * 0.45, w, w * 0.9)
    },
  }
}

function stars(w, h, rgb) {
  const layers = [0.2, 0.5, 1].map((depth) => Array.from({ length: Math.round((w * h) / (9000 / depth) / 2) }, () => ({
    x: Math.random() * w, y: Math.random() * h, r: 0.4 + depth * 1.1, tw: Math.random() * Math.PI * 2, depth,
  })))
  const par = { x: 0, y: 0 }
  let shooting = null
  let t = 0
  return {
    resize(nw, nh) { w = nw; h = nh },
    draw(ctx, dt, mouse) {
      t += dt
      const tx = mouse ? (mouse.x / w - 0.5) * 40 : 0
      const ty = mouse ? (mouse.y / h - 0.5) * 40 : 0
      par.x += (tx - par.x) * Math.min(1, dt * 3)
      par.y += (ty - par.y) * Math.min(1, dt * 3)
      for (const layer of layers) {
        for (const s of layer) {
          s.y += dt * 6 * s.depth
          if (s.y > h + 2) { s.y = -2; s.x = Math.random() * w }
          const x = (s.x - par.x * s.depth + w) % w
          const y = s.y - par.y * s.depth
          const a = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * 2 + s.tw)) * s.depth
          ctx.fillStyle = s.depth === 1 ? rgba(rgb, a) : `rgba(235,232,245,${a})`
          ctx.beginPath(); ctx.arc(x, y, s.r, 0, Math.PI * 2); ctx.fill()
        }
      }
      if (!shooting && dt > 0 && Math.random() < dt * 0.15) {
        shooting = { x: Math.random() * w * 0.7, y: Math.random() * h * 0.3, life: 1 }
      }
      if (shooting) {
        shooting.life -= dt * 1.4
        shooting.x += dt * 700; shooting.y += dt * 260
        const g = ctx.createLinearGradient(shooting.x, shooting.y, shooting.x - 140, shooting.y - 52)
        g.addColorStop(0, rgba(rgb, Math.max(0, shooting.life)))
        g.addColorStop(1, rgba(rgb, 0))
        ctx.strokeStyle = g
        ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(shooting.x, shooting.y); ctx.lineTo(shooting.x - 140, shooting.y - 52); ctx.stroke()
        if (shooting.life <= 0) shooting = null
      }
    },
  }
}

// ---------------------------------------------------------------- color helpers

function rgbOf(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  const n = m ? parseInt(m[1], 16) : 0xfa1e4e
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgba([r, g, b], a) {
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`
}

function hslOf([r, g, b]) {
  const rn = r / 255; const gn = g / 255; const bn = b / 255
  const max = Math.max(rn, gn, bn); const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let hue
  if (max === rn) hue = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) hue = (bn - rn) / d + 2
  else hue = (rn - gn) / d + 4
  return [hue * 60, Math.max(55, s * 100), l * 100]
}
