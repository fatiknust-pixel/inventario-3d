import { useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import * as THREE from 'three'
import { endereco, type Item } from './dados'

// ---- medidas (metros) — ajuste aqui ----
const BAY_W = 1.2 // largura de cada rack
const GAP = 0.08 // mini espaço entre racks
const DEPTH = 1 // profundidade do rack
const RACK_H = 0.95 // rack: um andar só, bandeja grande perto do chão
const PASSAGEM = 1 // caminho do montador entre os corredores
const LOGISTICO = 3 // corredor logístico (empilhadeira)
const PITCH = DEPTH * 2 + PASSAGEM + LOGISTICO // distância entre pares de corredores
const BOX_W = 0.42 // largura de cada caixinha na prateleira
const SHELF_D = 0.6 // profundidade da prateleira
const SHELF_NIV = 0.52 // altura de cada andar da prateleira
const SHELF_BASE = 0.15

// Corredores que ficam de frente um para o outro
const PARES: number[][] = [[10, 11]]
// Prateleira (corredor 01) fica na linha do corredor 10, depois da posição 03 do posto 04
const ENCAIXE: Record<number, { host: number; posto: number; posicao: number }> = { 1: { host: 10, posto: 4, posicao: 3 } }

const nivel = (alt: string) => alt.charCodeAt(0) - 65

type Salto = { depois: number; largura: number }
type Layout = { z: number; frente: 1 | -1; posPorPosto: number; postos: number[]; saltos: Salto[] }
export type Prat = { corredor: number; x: number; z: number; frente: 1 | -1; w: number; h: number; niveis: number; postos: number[]; posPorPosto: number }

const colX = (l: Layout, posto: number, posicao: number) => {
  const col = l.postos.indexOf(posto) * l.posPorPosto + (posicao - 1)
  return col * (BAY_W + GAP) + l.saltos.filter(s => col > s.depois).reduce((a, s) => a + s.largura, 0)
}

export function montarLayout(itens: Item[]) {
  const corrs = [...new Set(itens.map(i => i.corredor))].sort((a, b) => a - b)
  const ehPrat = (c: number) => itens.filter(i => i.corredor === c).every(i => i.tipo === 'prateleira')
  const racks = corrs.filter(c => !ehPrat(c))
  const prats = corrs.filter(ehPrat)
  const grupos: number[][] = PARES.filter(g => g.every(c => racks.includes(c))).map(g => [...g])
  const resto = racks.filter(c => !grupos.flat().includes(c))
  for (let k = 0; k < resto.length; k += 2) grupos.push(resto.slice(k, k + 2))
  const soltas = prats.filter(c => !(ENCAIXE[c] && racks.includes(ENCAIXE[c].host)))

  const map = new Map<number, Layout>()
  grupos.forEach((g, par) =>
    g.forEach((c, lado) => {
      const doC = itens.filter(i => i.corredor === c)
      map.set(c, {
        frente: g.length === 1 || lado === 0 ? 1 : -1,
        z: par * PITCH + (g.length === 1 ? 0 : lado ? 1 : -1) * (PASSAGEM / 2 + DEPTH / 2),
        posPorPosto: Math.max(...doC.map(i => i.posicao)),
        postos: [...new Set(doC.map(i => i.posto))].sort((a, b) => a - b),
        saltos: [],
      })
    }),
  )

  const dim = (c: number) => {
    const doC = itens.filter(i => i.corredor === c)
    const postos = [...new Set(doC.map(i => i.posto))].sort((a, b) => a - b)
    const posPorPosto = Math.max(...doC.map(i => i.posicao))
    const niveis = Math.max(3, ...doC.map(i => nivel(i.altura) + 1))
    return { postos, posPorPosto, niveis, w: postos.length * posPorPosto * BOX_W + 0.12, h: SHELF_BASE + niveis * SHELF_NIV + 0.06 }
  }

  const prat = new Map<number, Prat>()
  for (const c of prats.filter(c => !soltas.includes(c))) {
    const enc = ENCAIXE[c]
    const host = map.get(enc.host)!
    const d = dim(c)
    const col = host.postos.indexOf(enc.posto) * host.posPorPosto + enc.posicao - 1
    const x0 = colX(host, enc.posto, enc.posicao)
    host.saltos.push({ depois: col, largura: d.w + GAP })
    prat.set(c, { corredor: c, x: x0 + BAY_W / 2 + GAP + d.w / 2, z: host.z, frente: host.frente, ...d })
  }
  soltas.forEach((c, k) => {
    const d = dim(c)
    prat.set(c, { corredor: c, x: d.w / 2, z: (grupos.length + k) * PITCH, frente: 1, ...d })
  })

  let xMax = 1
  for (const l of map.values()) {
    const ult = l.postos[l.postos.length - 1]
    xMax = Math.max(xMax, colX(l, ult, l.posPorPosto) + BAY_W / 2)
  }
  for (const p of prat.values()) xMax = Math.max(xMax, p.x + p.w / 2)
  return { map, prat, xMax, pares: grupos.length + soltas.length }
}
export type LayoutInfo = ReturnType<typeof montarLayout>

// posição 3D e tamanho da caixa de cada item
export function geometriaItem(i: Item, lay: LayoutInfo) {
  const p = lay.prat.get(i.corredor)
  if (i.tipo === 'prateleira' && p) {
    const col = p.postos.indexOf(i.posto) * p.posPorPosto + i.posicao - 1
    const esp = (p.h - SHELF_BASE - 0.06) / p.niveis
    const bh = esp * 0.78
    return {
      pos: new THREE.Vector3(p.x - p.w / 2 + 0.06 + (col + 0.5) * BOX_W, SHELF_BASE + nivel(i.altura) * esp + bh / 2 + 0.03, p.z),
      size: [BOX_W * 0.92, bh, SHELF_D * 0.82] as [number, number, number],
    }
  }
  const l = lay.map.get(i.corredor)!
  return { pos: new THREE.Vector3(colX(l, i.posto, i.posicao), 0.7, l.z), size: [BAY_W * 0.9, 0.4, DEPTH * 0.85] as [number, number, number] }
}

// Rack: um andar só (bandeja grande), etiqueta na viga da frente
function Rack({ x, z, frente }: { x: number; z: number; frente: 1 | -1 }) {
  const w = BAY_W, d = DEPTH
  return (
    <group position={[x, 0, z]}>
      {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([a, b], k) => (
        <mesh key={k} position={[(a * (w - 0.12)) / 2, 0.22, (b * (d - 0.12)) / 2]}>
          <boxGeometry args={[0.08, 0.44, 0.08]} />
          <meshStandardMaterial color="#1c1f24" />
        </mesh>
      ))}
      {[-1, 1].map(b => (
        <mesh key={`f${b}`} position={[0, 0.46, (b * (d - 0.12)) / 2]}>
          <boxGeometry args={[w, 0.07, 0.08]} />
          <meshStandardMaterial color="#24282e" />
        </mesh>
      ))}
      {[-1, 1].map(a => (
        <mesh key={`s${a}`} position={[(a * (w - 0.12)) / 2, 0.46, 0]}>
          <boxGeometry args={[0.08, 0.07, d]} />
          <meshStandardMaterial color="#24282e" />
        </mesh>
      ))}
      <mesh position={[0, 0.52, 0]}>
        <boxGeometry args={[w - 0.04, 0.05, d - 0.04]} />
        <meshStandardMaterial color="#3f7d4a" />
      </mesh>
      <mesh position={[0, 0.46, frente * ((d - 0.12) / 2 + 0.045)]}>
        <boxGeometry args={[0.5, 0.14, 0.01]} />
        <meshStandardMaterial color="#f2f2f2" />
      </mesh>
    </group>
  )
}

// Prateleira: 3 andares, caixas lado a lado. Clicar nela dá zoom.
function Prateleira({ p, focada, onFoco }: { p: Prat; focada: boolean; onFoco: (c: number) => void }) {
  const esp = (p.h - SHELF_BASE - 0.06) / p.niveis
  return (
    <group
      position={[p.x, 0, p.z]}
      onClick={e => { e.stopPropagation(); onFoco(p.corredor) }}
      onPointerOver={e => { e.stopPropagation(); document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { document.body.style.cursor = 'auto' }}
    >
      {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([a, b], k) => (
        <mesh key={k} position={[(a * (p.w - 0.05)) / 2, p.h / 2, (b * (SHELF_D - 0.05)) / 2]}>
          <boxGeometry args={[0.05, p.h, 0.05]} />
          <meshStandardMaterial color={focada ? '#5a93e0' : '#3d6fb5'} />
        </mesh>
      ))}
      {Array.from({ length: p.niveis + 1 }, (_, n) => (
        <mesh key={n} position={[0, SHELF_BASE + n * esp - 0.015, 0]}>
          <boxGeometry args={[p.w, 0.03, SHELF_D]} />
          <meshStandardMaterial color="#6b7480" />
        </mesh>
      ))}
    </group>
  )
}

type Estado = 'normal' | 'achado' | 'selecionado' | 'apagado'
const CORES: Record<Estado, string> = { normal: '#c9a26b', achado: '#4cd964', selecionado: '#ff8a00', apagado: '#4a4f57' }

function Caixa({ item, lay, estado, onSel, onHover }: { item: Item; lay: LayoutInfo; estado: Estado; onSel: (i: Item) => void; onHover: (i: Item | null) => void }) {
  const { pos, size } = geometriaItem(item, lay)
  return (
    <mesh
      position={pos}
      onClick={e => { e.stopPropagation(); onSel(item) }}
      onPointerOver={e => { e.stopPropagation(); document.body.style.cursor = 'pointer'; onHover(item) }}
      onPointerOut={() => { document.body.style.cursor = 'auto'; onHover(null) }}
    >
      <boxGeometry args={size} />
      <meshStandardMaterial color={CORES[estado]} emissive={estado === 'selecionado' ? '#ff8a00' : estado === 'achado' ? '#1f6b2b' : '#000'} />
    </mesh>
  )
}

type Vista = { alvo: THREE.Vector3; off: THREE.Vector3 | null; n: number }

function Camera({ vista }: { vista: React.MutableRefObject<Vista> }) {
  const ctrl = useRef<any>(null)
  useFrame(({ camera }) => {
    const v = vista.current
    if (!ctrl.current || v.n <= 0) return
    v.n--
    const antes = ctrl.current.target.clone()
    ctrl.current.target.lerp(v.alvo, 0.1)
    if (v.off) camera.position.lerp(v.alvo.clone().add(v.off), 0.1)
    else camera.position.add(ctrl.current.target.clone().sub(antes))
    ctrl.current.update()
  })
  return <OrbitControls ref={ctrl} makeDefault maxPolarAngle={Math.PI / 2.05} minDistance={0.8} maxDistance={60} />
}

const VISTA_GERAL = new THREE.Vector3(0, 13, 12)

type Props = {
  itens: Item[]
  selecionado: Item | null
  foco: number | null // corredor da prateleira em zoom
  achados: Set<Item> | null
  onSel: (i: Item) => void
  onFoco: (c: number) => void
  onFundo: () => void
  preset: { c: number | null; n: number } | null // atalho de câmera
}

export default function Cena({ itens, selecionado, foco, achados, onSel, onFoco, onFundo, preset }: Props) {
  const lay = useMemo(() => montarLayout(itens), [itens])
  const centro = useMemo(() => new THREE.Vector3(lay.xMax / 2, 1, ((lay.pares - 1) * PITCH) / 2), [lay])
  const vista = useRef<Vista>({ alvo: new THREE.Vector3(), off: null, n: 0 })
  const chave = useRef('')
  const presetVisto = useRef(-1)
  // tela em pé (celular) precisa de mais distância para caber o corredor
  const asp = window.innerWidth / window.innerHeight
  const afasta = (k: number) => Math.max(1, k / asp)
  const [hover, setHover] = useState<Item | null>(null)

  const k = `${foco ?? ''}|${selecionado ? itens.indexOf(selecionado) : ''}|${preset?.n ?? ''}`
  if (k !== chave.current) {
    chave.current = k
    const v = vista.current
    const p = foco != null ? lay.prat.get(foco) : undefined
    const novoPreset = preset && preset.n !== presetVisto.current ? preset : null
    if (preset) presetVisto.current = preset.n
    if (p) {
      v.alvo.set(p.x, p.h / 2, p.z)
      v.off = new THREE.Vector3(0, 0.7 * afasta(0.7), p.frente * 3.2 * afasta(0.7))
    } else if (selecionado) {
      const g = geometriaItem(selecionado, lay)
      v.alvo.copy(g.pos)
      const fa = afasta(0.9)
      v.off = new THREE.Vector3(0, 1.3 * fa, (lay.map.get(selecionado.corredor)?.frente ?? 1) * 3 * fa)
    } else if (novoPreset && novoPreset.c != null && lay.map.get(novoPreset.c)) {
      const l = lay.map.get(novoPreset.c)!
      v.alvo.set(lay.xMax / 2, 0.5, l.z)
      v.off = new THREE.Vector3(0, 7.5 * afasta(0.95), l.frente * 8.5 * afasta(0.95))
    } else {
      v.alvo.copy(centro)
      v.off = VISTA_GERAL.clone().multiplyScalar(afasta(0.6))
    }
    v.n = 90
  }

  const comprimento = lay.xMax + 2
  const frames: JSX.Element[] = []
  for (const [c, l] of lay.map) {
    for (const posto of l.postos)
      for (let pos = 1; pos <= l.posPorPosto; pos++)
        frames.push(<Rack key={`${c}-${posto}-${pos}`} x={colX(l, posto, pos)} z={l.z} frente={l.frente} />)
    frames.push(
      <Html key={`l${c}`} position={[-1.2, 1.6, l.z]} center>
        <div className="rotulo">Corredor {c}</div>
      </Html>,
    )
  }
  for (const p of lay.prat.values()) {
    frames.push(<Prateleira key={`p${p.corredor}`} p={p} focada={foco === p.corredor} onFoco={onFoco} />)
    frames.push(
      <Html key={`pl${p.corredor}`} position={[p.x, p.h + 0.25, p.z]} center>
        <div className="rotulo">Prateleira {String(p.corredor).padStart(2, '0')}</div>
      </Html>,
    )
  }

  return (
    <Canvas dpr={[1, 1.75]} camera={{ position: [0, 24, 15], fov: 45 }} onPointerMissed={onFundo}>
      <color attach="background" args={['#10151c']} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[10, 18, 8]} intensity={1.1} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[comprimento / 2 - 1, 0, ((lay.pares - 1) * PITCH) / 2]}>
        <planeGeometry args={[comprimento + 4, lay.pares * PITCH + 4]} />
        <meshStandardMaterial color="#2b323b" />
      </mesh>
      {Array.from({ length: lay.pares + 1 }, (_, k) => (
        <mesh key={`log${k}`} rotation={[-Math.PI / 2, 0, 0]} position={[comprimento / 2 - 1, 0.01, k * PITCH - PITCH / 2]}>
          <planeGeometry args={[comprimento, LOGISTICO]} />
          <meshStandardMaterial color="#6e5a1e" />
        </mesh>
      ))}
      {Array.from({ length: lay.pares }, (_, k) => (
        <mesh key={`pas${k}`} rotation={[-Math.PI / 2, 0, 0]} position={[comprimento / 2 - 1, 0.01, k * PITCH]}>
          <planeGeometry args={[comprimento, PASSAGEM]} />
          <meshStandardMaterial color="#35503a" />
        </mesh>
      ))}
      {frames}
      {itens.map((it, i) => {
        const estado: Estado = it === selecionado ? 'selecionado' : achados ? (achados.has(it) ? 'achado' : 'apagado') : 'normal'
        return <Caixa key={i} item={it} lay={lay} estado={estado} onSel={onSel} onHover={setHover} />
      })}
      {hover && hover !== selecionado && (() => {
        const g = geometriaItem(hover, lay)
        return (
          <Html position={[g.pos.x, g.pos.y + g.size[1] / 2 + 0.12, g.pos.z]} center style={{ pointerEvents: 'none' }}>
            <div className="dica"><b>{endereco(hover)}</b><span>{hover.nome || '(vazio)'}</span></div>
          </Html>
        )
      })()}
      <Camera vista={vista} />
    </Canvas>
  )
}
