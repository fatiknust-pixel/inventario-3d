import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import * as THREE from 'three'
import { endereco, linhaDe, type Item } from './dados'

// ---- medidas (metros) — ajuste aqui ----
const BAY_W = 1.2 // largura de cada rack
const GAP = 0.08 // mini espaço entre racks
const DEPTH = 1 // profundidade do rack
const PASSAGEM = 1 // caminho do montador entre os corredores
const LOGISTICO = 3 // corredor logístico (empilhadeira)
const PITCH = DEPTH * 2 + PASSAGEM + LOGISTICO // distância entre pares de corredores
const BOX_W = 0.42 // largura de cada caixinha na prateleira
const SHELF_D = 0.6 // profundidade da prateleira
const SHELF_NIV = 0.52 // altura de cada andar da prateleira
const SHELF_BASE = 0.15
const VAZIO_BAYS = 8 // racks desenhados num corredor ainda sem endereços

// Da esquerda para a direita: 11·10 | 9·8 | 7·6 | 5·4 | 3·2 | 1.
// Cada par = [lado de trás, lado da frente]; o corredor 1 fica sozinho no canto.
const PARES: number[][] = [[10, 11], [8, 9], [6, 7], [4, 5], [2, 3], [1]]
// Corredores girados 180°: as caixas ficam viradas para o lado oposto ao corredor de logística
// e a fila é lida da esquerda para a direita quando vista de frente.
const ESPELHAR = new Set([1])
// Prateleira que fica no meio da fileira de outro corredor (id "posto-corredor")
const ENCAIXE: Record<string, { host: number; posto: number; posicao: number }> = { '4-1': { host: 10, posto: 4, posicao: 3 } }

const nivel = (alt: string) => alt.charCodeAt(0) - 65
const pad = (n: number) => String(n).padStart(2, '0')
export const idPrat = (i: Item) => `${i.posto}-${i.corredor}`
export const nomePrat = (p: { posto: number; corredor: number }) => `Prateleira ${pad(p.posto)} ${pad(p.corredor)}`

export type Bloco = { tipo: 'rack'; posto: number; posicao: number; x: number } | { tipo: 'prat'; id: string; x: number; w: number } | { tipo: 'livre'; item: Item; x: number }
export type Linha = { corredor: number; z: number; frente: 1 | -1; espelhado: boolean; blocos: Bloco[]; vazio: boolean; xFim: number; largura: number; livres: Item[] }
export type Prat = { id: string; posto: number; corredor: number; espelhado: boolean; x: number; z: number; frente: 1 | -1; w: number; h: number; niveis: number; cols: number; porAndar: Record<string, number> }
type Cand = { chave: [number, number]; tipo: 'livre'; item: Item } | { chave: [number, number]; tipo: 'rack'; posto: number; posicao: number } | { chave: [number, number]; tipo: 'prat'; id: string }

export function montarLayout(itens: Item[]) {
  const comEnd = itens.filter(i => !i.semEndereco)
  const grupos = new Map<string, Item[]>()
  for (const i of comEnd)
    if (i.tipo === 'prateleira') {
      const k = idPrat(i)
      grupos.set(k, [...(grupos.get(k) ?? []), i])
    }
  const dim = (its: Item[]) => {
    const cols = Math.max(...its.map(i => i.posicao))
    const niveis = Math.max(3, ...its.map(i => nivel(i.altura) + 1))
    // quantas caixas cabem em cada andar (a fileira do chão costuma ter poucas caixas grandes)
    const porAndar: Record<string, number> = {}
    for (const i of its) porAndar[i.altura] = Math.max(porAndar[i.altura] ?? 0, i.posicao)
    return { cols, niveis, porAndar, w: cols * BOX_W + 0.12, h: SHELF_BASE + niveis * SHELF_NIV + 0.06 }
  }

  // corredores que não estão no mapa fixo entram depois, de dois em dois
  const conhecidos = new Set(PARES.flat())
  const extras = [...new Set(itens.map(linhaDe))].filter(c => !conhecidos.has(c)).sort((a, b) => a - b)
  const pares = [...PARES]
  for (let k = 0; k < extras.length; k += 2) pares.push(extras.slice(k, k + 2))

  const linhas = new Map<number, Linha>()
  const prat = new Map<string, Prat>()
  const rackX = new Map<string, number>()
  const livreX = new Map<Item, number>() // caixas no chão, sem endereço
  const passagens: number[] = []

  pares.forEach((g, p) => {
    if (g.length === 2) passagens.push(-p * PITCH)
    g.forEach((c, lado) => {
      const z = -p * PITCH + (g.length === 1 ? 0 : lado ? 1 : -1) * (PASSAGEM / 2 + DEPTH / 2)
      const espelhado = ESPELHAR.has(c)
      const frente: 1 | -1 = espelhado ? -1 : g.length === 1 || lado === 0 ? 1 : -1
      const cands: Cand[] = []

      const racks = comEnd.filter(i => linhaDe(i) === c && i.tipo !== 'prateleira')
      const vistos = new Set<string>()
      for (const r of racks) {
        const k = `${r.posto}|${r.posicao}`
        if (vistos.has(k)) continue
        vistos.add(k)
        cands.push({ chave: [r.ordem ?? r.posto, r.ordem ?? r.posicao], tipo: 'rack', posto: r.posto, posicao: r.posicao })
      }
      for (const [id, its] of grupos) {
        const enc = ENCAIXE[id]
        const ord = its.find(i => i.ordem != null)?.ordem
        if (enc) {
          if (enc.host === c) cands.push({ chave: [enc.posto, enc.posicao + 0.5], tipo: 'prat', id })
        } else if (linhaDe(its[0]) === c) cands.push({ chave: ord != null ? [ord, ord] : [its[0].posto, Math.min(...its.map(i => i.posicao))], tipo: 'prat', id })
      }
      const livres = itens.filter(i => i.semEndereco && linhaDe(i) === c)
      for (const it of livres) cands.push({ chave: [it.ordem ?? 99, it.ordem ?? 99], tipo: 'livre', item: it })
      cands.sort((a, b) => a.chave[0] - b.chave[0] || a.chave[1] - b.chave[1])
      const vazio = cands.length === 0
      if (vazio) for (let pos = 1; pos <= VAZIO_BAYS; pos++) cands.push({ chave: [0, pos], tipo: 'rack', posto: 0, posicao: pos })

      let x = 0
      const blocos: Bloco[] = []
      for (const b of cands) {
        if (b.tipo === 'livre') {
          livreX.set(b.item, x + 0.65)
          blocos.push({ tipo: 'livre', item: b.item, x: x + 0.65 })
          x += 1.3 + GAP
        } else if (b.tipo === 'rack') {
          blocos.push({ tipo: 'rack', posto: b.posto, posicao: b.posicao, x: x + BAY_W / 2 })
          rackX.set(`${c}|${b.posto}|${b.posicao}`, x + BAY_W / 2)
          x += BAY_W + GAP
        } else {
          const d = dim(grupos.get(b.id)!)
          const [po, co] = b.id.split('-').map(Number)
          prat.set(b.id, { id: b.id, posto: po, corredor: co, espelhado, x: x + d.w / 2, z, frente, ...d })
          blocos.push({ tipo: 'prat', id: b.id, x: x + d.w / 2, w: d.w })
          x += d.w + GAP
        }
      }
      const xFim = x - GAP
      const largura = xFim
      if (espelhado) {
        // gira a fila de ponta a ponta: o que era o primeiro da esquerda passa a ficar à direita de quem olha de frente
        for (const bl of blocos) bl.x = largura - bl.x
        for (const k of [...rackX.keys()]) if (k.startsWith(`${c}|`)) rackX.set(k, largura - rackX.get(k)!)
        for (const it of livres) livreX.set(it, largura - livreX.get(it)!)
        for (const pr of prat.values()) if (pr.z === z) pr.x = largura - pr.x
      }
      linhas.set(c, { corredor: c, z, frente, espelhado, blocos, vazio, xFim, largura, livres: [] })
    })
  })

  let xMax = 1
  for (const l of linhas.values()) xMax = Math.max(xMax, l.largura)
  return { linhas, prat, rackX, livreX, passagens, xMax, pares: pares.length }
}
export type LayoutInfo = ReturnType<typeof montarLayout>

// posição 3D e tamanho da caixa de cada item
export function geometriaItem(i: Item, lay: LayoutInfo) {
  if (i.semEndereco) {
    const l = lay.linhas.get(linhaDe(i))
    return { pos: new THREE.Vector3(lay.livreX.get(i) ?? 0, 0.28, l?.z ?? 0), size: [1.0, 0.56, 0.8] as [number, number, number] }
  }
  const p = i.tipo === 'prateleira' ? lay.prat.get(idPrat(i)) : undefined
  if (p) {
    const esp = (p.h - SHELF_BASE - 0.06) / p.niveis
    // cada andar reparte a largura entre as suas caixas; poucas caixas = caixas grandes e mais altas
    const n = Math.max(1, p.porAndar[i.altura] ?? p.cols)
    const util = p.w - 0.12
    const cw = util / n
    const off = (i.posicao - 0.5) * cw
    const bh = esp * (n <= 3 ? 0.88 : n === 4 ? 0.74 : 0.68)
    return {
      pos: new THREE.Vector3(p.x - util / 2 + off, SHELF_BASE + nivel(i.altura) * esp + bh / 2 + 0.03, p.z),
      size: [cw * 0.94, bh, SHELF_D * (n <= 3 ? 0.9 : 0.82)] as [number, number, number],
    }
  }
  const l = lay.linhas.get(linhaDe(i))
  const x = lay.rackX.get(`${linhaDe(i)}|${i.posto}|${i.posicao}`) ?? 0
  return { pos: new THREE.Vector3(x, 0.7, l?.z ?? 0), size: [BAY_W * 0.9, 0.4, DEPTH * 0.85] as [number, number, number] }
}

// +1 se, olhando de frente, a ordem dos endereços cresce para a direita; -1 se cresce para a esquerda
export function sentidoItem(i: Item, lay: LayoutInfo): 1 | -1 {
  const p = i.tipo === 'prateleira' ? lay.prat.get(idPrat(i)) : undefined
  const l = lay.linhas.get(linhaDe(i))
  const f = p?.frente ?? l?.frente ?? 1
  // prateleira: a posição 01 está sempre no mesmo lado do mundo, então a ordem cresce para onde a frente indica
  if (p) return f
  return (l?.espelhado ? -f : f) as 1 | -1
}

// lado do corredor para onde a câmera olha (onde fica a passagem)
export function frenteItem(i: Item, lay: LayoutInfo): 1 | -1 {
  const p = i.tipo === 'prateleira' ? lay.prat.get(idPrat(i)) : undefined
  return p?.frente ?? lay.linhas.get(linhaDe(i))?.frente ?? 1
}

// Rack: um andar só (bandeja grande), etiqueta na viga da frente
function Rack({ x, z, frente, ghost }: { x: number; z: number; frente: 1 | -1; ghost?: boolean }) {
  const w = BAY_W, d = DEPTH
  const mat = (c: string) => <meshStandardMaterial color={ghost ? '#5b6573' : c} transparent={!!ghost} opacity={ghost ? 0.3 : 1} depthWrite={!ghost} />
  return (
    <group position={[x, 0, z]}>
      {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([a, b], k) => (
        <mesh key={k} position={[(a * (w - 0.12)) / 2, 0.22, (b * (d - 0.12)) / 2]}>
          <boxGeometry args={[0.08, 0.44, 0.08]} />
          {mat('#1c1f24')}
        </mesh>
      ))}
      {[-1, 1].map(b => (
        <mesh key={`f${b}`} position={[0, 0.46, (b * (d - 0.12)) / 2]}>
          <boxGeometry args={[w, 0.07, 0.08]} />
          {mat('#24282e')}
        </mesh>
      ))}
      {[-1, 1].map(a => (
        <mesh key={`s${a}`} position={[(a * (w - 0.12)) / 2, 0.46, 0]}>
          <boxGeometry args={[0.08, 0.07, d]} />
          {mat('#24282e')}
        </mesh>
      ))}
      <mesh position={[0, 0.52, 0]}>
        <boxGeometry args={[w - 0.04, 0.05, d - 0.04]} />
        {mat('#3f7d4a')}
      </mesh>
      {!ghost && (
        <mesh position={[0, 0.46, frente * ((d - 0.12) / 2 + 0.045)]}>
          <boxGeometry args={[0.5, 0.14, 0.01]} />
          <meshStandardMaterial color="#f2f2f2" />
        </mesh>
      )}
    </group>
  )
}

// Prateleira: vários andares, caixas lado a lado. Clicar nela dá zoom.
function Prateleira({ p, focada, onFoco }: { p: Prat; focada: boolean; onFoco: (id: string) => void }) {
  const esp = (p.h - SHELF_BASE - 0.06) / p.niveis
  return (
    <group
      position={[p.x, 0, p.z]}
      onClick={e => { e.stopPropagation(); if (!focada) onFoco(p.id) }}
      onPointerOver={e => { e.stopPropagation(); document.body.style.cursor = focada ? 'auto' : 'pointer' }}
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

type Estado = 'normal' | 'ok' | 'duvida' | 'erro' | 'achado' | 'selecionado' | 'apagado'
// verde = certo, amarelo = dúvida, vermelho = erro; marrom = ainda não conferido; azul = resultado da busca
export const CORES: Record<Estado, string> = { normal: '#c9a26b', ok: '#3fae5a', duvida: '#e6c229', erro: '#d64545', achado: '#35b6ff', selecionado: '#ffffff', apagado: '#4a4f57' }

function Caixa({ item, lay, estado, onSel, onHover }: { item: Item; lay: LayoutInfo; estado: Estado; onSel: (i: Item) => void; onHover: (i: Item | null) => void }) {
  const { pos, size } = geometriaItem(item, lay)
  const sel = estado === 'selecionado'
  // a selecionada mantém a cor da situação; o destaque é um contorno branco grosso e um brilho leve
  const cor = sel ? CORES[item.status ?? 'normal'] : CORES[estado]
  return (
    <group position={pos}>
      <mesh
        onClick={e => { e.stopPropagation(); onSel(item) }}
        onPointerOver={e => { e.stopPropagation(); document.body.style.cursor = 'pointer'; onHover(item) }}
        onPointerOut={() => { document.body.style.cursor = 'auto'; onHover(null) }}
      >
        <boxGeometry args={size} />
        <meshStandardMaterial color={cor} emissive={sel ? cor : estado === 'achado' ? '#0b4d73' : '#000'} emissiveIntensity={sel ? 0.35 : 1} />
      </mesh>
      {sel && (() => {
        // moldura branca na frente da caixa (do lado onde a câmera olha), sempre visível
        const t = 0.05, z = frenteItem(item, lay) * (size[2] / 2 + 0.012)
        const barras: [number, number, number, number][] = [
          [0, size[1] / 2, size[0] + t, t], [0, -size[1] / 2, size[0] + t, t], // em cima e embaixo
          [-size[0] / 2, 0, t, size[1] + t], [size[0] / 2, 0, t, size[1] + t], // lados
        ]
        return barras.map(([x, y, w, h], k) => (
          <mesh key={k} position={[x, y, z]} raycast={() => null}>
            <boxGeometry args={[w, h, 0.02]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        ))
      })()}
    </group>
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
  return <OrbitControls ref={ctrl} makeDefault maxPolarAngle={Math.PI / 2.05} minDistance={0.8} maxDistance={90} />
}

type Props = {
  itens: Item[]
  selecionado: Item | null
  foco: string | null // id da prateleira em zoom ("posto-corredor")
  achados: Set<Item> | null
  onSel: (i: Item) => void
  onFoco: (id: string) => void
  onFundo: () => void
  preset: { c: number | null; n: number } | null // atalho de câmera
}

export default function Cena({ itens, selecionado, foco, achados, onSel, onFoco, onFundo, preset }: Props) {
  const lay = useMemo(() => montarLayout(itens), [itens])
  const profund = lay.pares * PITCH
  const centro = useMemo(() => new THREE.Vector3(lay.xMax / 2, 1, -((lay.pares - 1) * PITCH) / 2), [lay])
  const vista = useRef<Vista>({ alvo: new THREE.Vector3(), off: null, n: 0 })
  const chave = useRef('')
  const presetVisto = useRef(-1)
  // tela em pé (celular) precisa de mais distância para caber tudo
  const asp = window.innerWidth / window.innerHeight
  const afasta = (k: number) => Math.max(1, k / asp)
  const [hover, setHover] = useState<Item | null>(null)
  // tela deitada: corredores na vertical e pares da esquerda para a direita; em pé: pares de cima para baixo
  const [paisagem, setPaisagem] = useState(() => window.innerWidth >= window.innerHeight)
  useEffect(() => {
    const f = () => setPaisagem(window.innerWidth >= window.innerHeight)
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])
  const ang = paisagem ? -Math.PI / 2 : Math.PI
  const R = (v: THREE.Vector3) => v.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ang)

  const k = `${foco ?? ''}|${selecionado ? itens.indexOf(selecionado) : ''}|${preset?.n ?? ''}|${paisagem ? 1 : 0}`
  if (k !== chave.current) {
    chave.current = k
    const v = vista.current
    const p = foco != null ? lay.prat.get(foco) : undefined
    const novoPreset = preset && preset.n !== presetVisto.current ? preset : null
    if (preset) presetVisto.current = preset.n
    if (p) {
      // em tela em pé o painel cobre a parte de baixo: abaixa o alvo para a prateleira aparecer mais acima
      v.alvo.copy(R(new THREE.Vector3(p.x, p.h / 2 + 0.25 - (paisagem ? 0 : 0.75), p.z)))
      const d = Math.max(3.2, p.h * 1.7) * afasta(0.7)
      v.off = R(new THREE.Vector3(0, 0.7 * afasta(0.7), p.frente * d))
    } else if (selecionado) {
      const g = geometriaItem(selecionado, lay)
      v.alvo.copy(R(g.pos))
      const fa = afasta(0.9)
      v.off = R(new THREE.Vector3(0, 1.3 * fa, frenteItem(selecionado, lay) * 3 * fa))
    } else if (novoPreset && novoPreset.c != null && lay.linhas.get(novoPreset.c)) {
      const l = lay.linhas.get(novoPreset.c)!
      v.alvo.copy(R(new THREE.Vector3(l.largura / 2, 0.5, l.z)))
      v.off = R(new THREE.Vector3(0, 7.5 * afasta(0.95), l.frente * 8.5 * afasta(0.95)))
    } else {
      v.alvo.copy(R(centro))
      // distância para caber o mapa inteiro (eixo longo = pares, eixo curto = comprimento dos corredores)
      const t = 0.828
      const longo = lay.pares * PITCH, curto = lay.xMax + 6
      const dist = 1.15 * Math.max(longo / (t * (paisagem ? asp : 1)), curto / (t * (paisagem ? 1 : asp)))
      v.off = new THREE.Vector3(0, dist * 0.85, dist * 0.5)
    }
    v.n = 90
  }

  const comprimento = lay.xMax + 2
  const frames: JSX.Element[] = []
  for (const [c, l] of lay.linhas) {
    for (const b of l.blocos) {
      if (b.tipo === 'rack') frames.push(<Rack key={`${c}-${b.posto}-${b.posicao}`} x={b.x} z={l.z} frente={l.frente} ghost={l.vazio} />)
      else if (b.tipo === 'prat') {
        const p = lay.prat.get(b.id)!
        frames.push(<Prateleira key={`p${b.id}`} p={p} focada={foco === b.id} onFoco={onFoco} />)
        if (foco == null || (foco === b.id && paisagem))
          frames.push(
            <Html key={`pl${b.id}`} position={[p.x, p.h + 0.25, p.z]} center>
              <div className="rotulo">{nomePrat(p)}</div>
            </Html>,
          )
      }
    }
    if (foco == null && !selecionado)
      frames.push(
        <Html key={`l${c}`} position={[-1.2, 1.6, l.z]} center>
          <div className={`rotulo${l.vazio ? ' vazio' : ''}`}>Corredor {c}</div>
        </Html>,
      )
  }

  return (
    <Canvas dpr={[1, 1.75]} camera={{ position: [0, 26, 16], fov: 45 }} onPointerMissed={onFundo}>
      <color attach="background" args={['#10151c']} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[10, 18, 8]} intensity={1.1} />
      <group rotation={[0, ang, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[comprimento / 2 - 1, 0, -((lay.pares - 1) * PITCH) / 2]}>
        <planeGeometry args={[comprimento + 4, lay.pares * PITCH + 4]} />
        <meshStandardMaterial color="#2b323b" />
      </mesh>
      {Array.from({ length: lay.pares + 1 }, (_, k) => (
        <mesh key={`log${k}`} rotation={[-Math.PI / 2, 0, 0]} position={[comprimento / 2 - 1, 0.01, PITCH / 2 - k * PITCH]}>
          <planeGeometry args={[comprimento, LOGISTICO]} />
          <meshStandardMaterial color="#6e5a1e" />
        </mesh>
      ))}
      {lay.passagens.map((z, k) => (
        <mesh key={`pas${k}`} rotation={[-Math.PI / 2, 0, 0]} position={[comprimento / 2 - 1, 0.01, z]}>
          <planeGeometry args={[comprimento, PASSAGEM]} />
          <meshStandardMaterial color="#35503a" />
        </mesh>
      ))}
      {frames}
      {itens.map((it, i) => {
        const estado: Estado = it === selecionado ? 'selecionado' : achados ? (achados.has(it) ? 'achado' : 'apagado') : it.status ?? 'normal'
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
      </group>
      <Camera vista={vista} />
    </Canvas>
  )
}
