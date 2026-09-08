import { useEffect, useMemo, useState } from "react"
import lotusImg from "@/imports/Group1707479257-1/2f892343d52e1ba37774061e3e2ae0e018bc0926.png"
import haloImg from "@/imports/Group1707479257/ee66e84d1c8035dcc13f60f18e9d83de8fd9aa35.png"
import bgImg from "@/imports/image.png"

const STAGES = [
  "正在唤醒石窟造像",
  "构建三维场景",
  "加载高精度纹理",
  "点亮千年佛光",
  "即将步入展厅",
]

type Mote = {
  id: number
  left: number
  size: number
  duration: number
  delay: number
  drift: number
  blur: number
  opacity: number
  min: number
  twinkle: number
  sparkle: boolean
}

function makeMotes(count: number): Mote[] {
  return Array.from({ length: count }, (_, id) => {
    // ~30% are tiny sharp sparkles, the rest are soft out-of-focus bokeh orbs.
    const sparkle = Math.random() < 0.3
    const size = sparkle ? 1.5 + Math.random() * 2.5 : 10 + Math.random() * 46
    // Larger = further out of focus (more blur, lower opacity) → depth.
    const depth = sparkle ? 0 : size / 56
    return {
      id,
      left: Math.random() * 100,
      size,
      duration: 16 + Math.random() * 20,
      delay: -Math.random() * 34,
      drift: (Math.random() - 0.5) * 90,
      blur: sparkle ? 0.4 : 2 + depth * 14,
      opacity: sparkle ? 0.95 : 0.5 - depth * 0.32,
      min: sparkle ? 0.15 : 0.12,
      twinkle: 3 + Math.random() * 5,
      sparkle,
    }
  })
}

export default function App() {
  const [progress, setProgress] = useState(0)
  const motes = useMemo(() => makeMotes(44), [])

  useEffect(() => {
    let raf = 0
    let start = 0
    const TARGET = 60 // fill to 60%, then repeat
    const DURATION = 3400 // ms per cycle
    const HOLD = 0.12 // fraction of cycle spent holding at 60% before restarting

    const loop = (t: number) => {
      if (!start) start = t
      let e = (t - start) / DURATION
      if (e >= 1) {
        start = t
        e = 0
      }
      // ease-out fill, then a brief hold at the top of the cycle
      const fillPhase = Math.min(1, e / (1 - HOLD))
      const eased = 1 - Math.pow(1 - fillPhase, 2.2)
      setProgress(eased * TARGET)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const pct = Math.round(progress)
  const stage = STAGES[Math.min(STAGES.length - 1, Math.floor((progress / 60) * STAGES.length))]

  return (
    <div className="relative size-full overflow-hidden bg-[#060402] font-[300] text-[#f6e3c0]" style={{ fontFamily: "'Noto Serif SC', serif" }}>
      {/* Background: cave shrine, darkened for immersion */}
      <div className="absolute inset-0">
        <img src={bgImg} alt="石窟造像" className="size-full object-cover" />
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 50% 42%, rgba(6,4,2,0.15) 0%, rgba(6,4,2,0.55) 45%, rgba(4,2,1,0.9) 100%)",
          }}
        />
        <div
          className="absolute inset-0 mix-blend-soft-light opacity-60"
          style={{ background: "radial-gradient(70% 55% at 50% 40%, rgba(255,196,110,0.45), transparent 70%)" }}
        />
      </div>

      {/* Floating light motes — soft depth-of-field bokeh + fine sparkles */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {motes.map((p) => (
          <span
            key={p.id}
            className="absolute bottom-[-8vh]"
            style={{
              left: `${p.left}%`,
              ["--p-drift" as string]: `${p.drift}px`,
              animation: `mote-rise ${p.duration}s cubic-bezier(0.4,0,0.5,1) ${p.delay}s infinite`,
            }}
          >
            <span
              className="block rounded-full"
              style={{
                width: p.size,
                height: p.size,
                background: p.sparkle
                  ? "radial-gradient(circle, #fff6da 0%, rgba(255,214,140,0.9) 40%, rgba(255,180,80,0) 75%)"
                  : "radial-gradient(circle at 40% 35%, rgba(255,240,205,0.55), rgba(255,196,110,0.28) 42%, rgba(255,160,60,0) 72%)",
                filter: `blur(${p.blur}px)`,
                boxShadow: p.sparkle ? "0 0 6px 1px rgba(255,220,150,0.9)" : "none",
                ["--p-opacity" as string]: p.opacity,
                ["--p-min" as string]: p.min,
                animation: `twinkle ${p.twinkle}s ease-in-out ${p.delay}s infinite`,
              }}
            />
          </span>
        ))}
      </div>

      {/* Center composition — lotus centerpiece, title, then progress */}
      <div className="relative z-10 flex size-full flex-col items-center justify-center px-6">
        {/* Lotus + halo glow only */}
        <div
          className="relative flex items-center justify-center"
          style={{ width: "min(70vw, 380px)", height: "min(70vw, 380px)" }}
        >
          {/* Soft radial aura */}
          <div
            className="absolute inset-[-8%]"
            style={{
              background:
                "radial-gradient(circle, rgba(255,205,125,0.4) 0%, rgba(255,180,90,0.1) 42%, transparent 68%)",
              animation: "lotus-glow 6s ease-in-out infinite",
            }}
          />

          {/* Halo image behind the lotus */}
          <img
            src={haloImg}
            alt=""
            aria-hidden
            className="absolute w-[64%] opacity-80"
            style={{ animation: "lotus-glow 7s ease-in-out infinite" }}
          />

          {/* The lotus */}
          <img
            src={lotusImg}
            alt="金色莲花"
            className="relative w-[86%] drop-shadow-[0_0_46px_rgba(255,190,90,0.5)]"
            style={{ animation: "lotus-float 6.5s ease-in-out infinite" }}
          />
        </div>

        {/* Title */}
        <div className="-mt-2 text-center" style={{ animation: "text-fade-in 1.2s ease-out both" }}>
          <p
            className="text-[0.72rem] uppercase text-[#e7b877]/80"
            style={{ fontFamily: "'Cormorant Garamond', serif", letterSpacing: "0.5em" }}
          >
            Immersive Heritage Gallery
          </p>
          <h1 className="mt-3 text-3xl font-[500] tracking-[0.35em] text-[#fbe6c2] sm:text-4xl">
            云冈石窟 · 数字展
          </h1>
        </div>

        {/* Progress */}
        <div className="mt-10 w-[min(86vw,420px)]" style={{ animation: "text-fade-in 1.2s ease-out 0.2s both" }}>
          <div className="mb-2.5 flex items-baseline justify-between text-[#e7c896]">
            <span className="text-sm tracking-[0.25em]">{stage}</span>
            <span
              className="text-base font-[500] tabular-nums text-[#fbe6c2]"
              style={{ fontFamily: "'Cormorant Garamond', serif" }}
            >
              {pct}%
            </span>
          </div>

          <div className="relative h-[4px] w-full rounded-full bg-[#e7c896]/12 shadow-[inset_0_0_0_1px_rgba(231,200,150,0.15)]">
            {/* ambient bloom under the filled track */}
            <div
              className="absolute -inset-y-3 left-0 rounded-full"
              style={{
                width: `${progress}%`,
                background: "linear-gradient(90deg, transparent, rgba(255,196,110,0.35))",
                filter: "blur(9px)",
              }}
            />
            <div
              className="relative h-full overflow-hidden rounded-full"
              style={{
                width: `${progress}%`,
                background: "linear-gradient(90deg, rgba(255,196,110,0.5), #ffcf7d 60%, #fff2cf)",
                boxShadow:
                  "0 0 12px rgba(255,207,125,0.9), 0 0 26px rgba(255,180,90,0.55), inset 0 0 6px rgba(255,255,255,0.6)",
              }}
            >
              {/* traveling shimmer */}
              <span
                className="absolute inset-y-0 w-1/3"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, rgba(255,255,255,0.85), transparent)",
                  animation: "bar-shimmer 1.8s ease-in-out infinite",
                }}
              />
            </div>
            {/* leading glow node */}
            <span
              className="absolute top-1/2 size-2 -translate-y-1/2 rounded-full bg-[#fff4d6]"
              style={{ left: `calc(${progress}% - 4px)`, boxShadow: "0 0 12px 3px rgba(255,207,125,0.9)" }}
            />
          </div>

          <p className="mt-4 text-center text-xs tracking-[0.3em] text-[#e7c896]/55">
            正在渲染沉浸式三维场景，请稍候
          </p>
        </div>
      </div>

      {/* Corner ornamental hairlines */}
      <div className="pointer-events-none absolute inset-5 border border-[#e7c896]/10" />
    </div>
  )
}
