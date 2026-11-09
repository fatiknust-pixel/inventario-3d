import { useEffect, useMemo, useRef, useState } from 'react'
import Cena, { idPrat, montarLayout, nomePrat } from './Cena'
import { Item, linhaDe, baixarModelo, fotoDaPeca, fotoEtiquetaSrc, dadosExemplo, dadosReais, endereco, fotoSrc, lerExcel, placeholder } from './dados'

export default function App() {
  const [itens, setItens] = useState<Item[]>(() => dadosReais())
  const [sel, setSel] = useState<Item | null>(null)
  const [foco, setFoco] = useState<string | null>(null) // prateleira em zoom (id "posto-corredor")
  const [preset, setPreset] = useState<{ c: number | null; n: number } | null>(null)
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState('')
  const [ampliar, setAmpliar] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const [verEtiqueta, setVerEtiqueta] = useState(false)
  const arquivo = useRef<HTMLInputElement>(null)

  useEffect(() => setVerEtiqueta(false), [sel])

  const lay = useMemo(() => montarLayout(itens), [itens])

  const achados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return null
    return new Set(itens.filter(i => `${i.codigo} ${i.cor ?? ''} ${i.nome} ${endereco(i)}`.toLowerCase().includes(q)))
  }, [busca, itens])

  const naPrateleira = (i: Item) => i.tipo === 'prateleira'
  function clicarItem(i: Item) {
    if (naPrateleira(i) && foco !== idPrat(i)) { setFoco(idPrat(i)); setSel(null) }
    else { if (!naPrateleira(i)) setFoco(null); setSel(i) }
  }
  function escolher(i: Item) { setFoco(naPrateleira(i) ? idPrat(i) : null); setSel(i) }
  function fundo() { if (sel) setSel(null); else setFoco(null) }
  function irPara(c: number | null) { setSel(null); setFoco(null); setPreset({ c, n: Date.now() }) }
  function irPrateleira(id: string) { setSel(null); setFoco(id) }

  // ---- navegação pelas setas ----
  // A fila de um corredor é uma sequência de paradas, da esquerda para a direita vista de frente:
  // racks, a prateleira (uma parada só) e as caixas no chão. ◀ ▶ andam de uma parada para a vizinha.
  type Parada = { id: string; x: number; prat?: string; item?: Item }
  const paradasDa = (c: number): Parada[] => {
    const l = lay.linhas.get(c)
    if (!l) return []
    const ps: Parada[] = []
    for (const b of l.blocos) {
      if (b.tipo === 'prat') ps.push({ id: `P${b.id}`, x: b.x, prat: b.id })
      else if (b.tipo === 'livre') ps.push({ id: `L${itens.indexOf(b.item)}`, x: b.x, item: b.item })
      else {
        const it = itens.find(i => !i.semEndereco && i.tipo !== 'prateleira' && linhaDe(i) === c && i.posto === b.posto && i.posicao === b.posicao)
        if (it) ps.push({ id: `R${b.posto}|${b.posicao}`, x: b.x, item: it })
      }
    }
    return ps.sort((a, b) => (a.x - b.x) * l.frente)
  }
  // onde estou agora: o corredor, a lista de paradas e a posição nela (a prateleira conta como uma parada)
  function paradaAtual(): { ps: Parada[]; k: number } | null {
    let c: number | undefined, id: string | undefined
    if (sel) {
      if (sel.tipo === 'prateleira') { id = `P${idPrat(sel)}`; c = [...lay.linhas.values()].find(l => l.blocos.some(b => b.tipo === 'prat' && b.id === idPrat(sel)))?.corredor }
      else if (sel.semEndereco) { id = `L${itens.indexOf(sel)}`; c = linhaDe(sel) }
      else { id = `R${sel.posto}|${sel.posicao}`; c = linhaDe(sel) }
    } else if (foco != null) {
      id = `P${foco}`
      c = [...lay.linhas.values()].find(l => l.blocos.some(b => b.tipo === 'prat' && b.id === foco))?.corredor
    }
    if (c == null || id == null) return null
    const ps = paradasDa(c)
    const k = ps.findIndex(p => p.id === id)
    return k < 0 ? null : { ps, k }
  }
  const alvoParada = (d: -1 | 1) => { const a = paradaAtual(); return a ? a.ps[a.k + d] : undefined }
  function andar(d: -1 | 1) {
    const p = alvoParada(d)
    if (!p) return
    if (p.prat) { setSel(null); setFoco(p.prat) } // chegou na prateleira: dá o zoom e espera o toque numa caixa
    else if (p.item) escolher(p.item)
  }
  // ▲ ▼: andar de cima/baixo, só dentro de uma prateleira
  function vizinho(d: 'cima' | 'baixo'): Item | undefined {
    if (!sel || sel.tipo !== 'prateleira') return
    const alt = String.fromCharCode(sel.altura.charCodeAt(0) + (d === 'cima' ? 1 : -1))
    return itens.find(i => i.tipo === 'prateleira' && idPrat(i) === idPrat(sel) && i.posicao === sel.posicao && i.altura === alt)
  }
  function subir(d: 'cima' | 'baixo') { const v = vizinho(d); if (v) escolher(v) }

  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'Escape') { fundo(); return }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) || (!sel && foco == null)) return
      e.preventDefault()
      if (e.key === 'ArrowLeft') andar(-1)
      else if (e.key === 'ArrowRight') andar(1)
      else subir(e.key === 'ArrowUp' ? 'cima' : 'baixo')
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  })

  async function importar(f?: File) {
    if (!f) return
    try {
      const novos = await lerExcel(f)
      if (!novos.length) throw new Error('Nenhuma linha válida (precisa de posto, corredor, posição e altura).')
      setItens(novos); setSel(null); setFoco(null); setBusca(''); setErro('')
    } catch (e) { setErro((e as Error).message) }
  }
  async function copiar() {
    if (!sel) return
    try { await navigator.clipboard.writeText(endereco(sel)); setCopiado(true); setTimeout(() => setCopiado(false), 1500) } catch { /* sem permissão */ }
  }

  const pf = foco != null ? lay.prat.get(foco) : undefined
  const caixasFoco = foco != null ? itens.filter(i => i.tipo === 'prateleira' && idPrat(i) === foco) : []
  const pad = (n: number) => String(n).padStart(2, '0')

  return (
    <div className="app">
      <header>
        <b>Inventário 3D</b>
        <input
          placeholder="Buscar peça, código ou endereço…"
          value={busca}
          onChange={e => setBusca(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && achados?.size) { escolher([...achados][0]); e.currentTarget.blur() }
            if (e.key === 'Escape') setBusca('')
          }}
        />
        <details className="menu">
          <summary className="btn">Dados ▾</summary>
          <div className="menu-itens" onClick={e => ((e.currentTarget.parentElement) as HTMLDetailsElement).removeAttribute('open')}>
            <button className="btn" onClick={() => arquivo.current?.click()}>Importar Excel</button>
            <button className="btn modelo" onClick={baixarModelo}>Baixar modelo</button>
            <button className="btn" onClick={() => { setItens(dadosReais()); setSel(null); setFoco(null) }}>Dados reais</button>
            <button className="btn" onClick={() => { setItens(dadosExemplo()); setSel(null); setFoco(null) }}>Dados de exemplo</button>
          </div>
        </details>
        <input ref={arquivo} type="file" accept=".xlsx,.xls,.csv" hidden onChange={e => { importar(e.target.files?.[0]); e.target.value = '' }} />
      </header>
      <nav className="atalhos">
        <button className="chip" onClick={() => irPara(null)}>Visão geral</button>
        {[...lay.linhas.keys()].sort((a, b) => a - b).map(c => <button key={c} className="chip" onClick={() => irPara(c)}>Corredor {pad(c)}</button>)}
        {[...lay.prat.values()].map(p => <button key={p.id} className={`chip${foco === p.id ? ' on' : ''}`} onClick={() => irPrateleira(p.id)}>{nomePrat(p)}</button>)}
      </nav>
      {erro && <div className="erro">{erro}</div>}
      <Cena itens={itens} selecionado={sel} foco={foco} achados={achados} preset={preset} onSel={clicarItem} onFoco={id => { setFoco(id); setSel(null) }} onFundo={fundo} />
      {achados && !sel && (
        <ul className="lista">
          {[...achados].slice(0, 8).map((i, k) => (
            <li key={k} onClick={() => escolher(i)}><b>{endereco(i)}</b> {i.codigo} — {i.nome}</li>
          ))}
          {achados.size === 0 && <li>Nada encontrado</li>}
          {achados.size > 8 && <li>+{achados.size - 8} resultados…</li>}
        </ul>
      )}
      {foco != null && !sel && (
        <aside className="painel">
          <div className="end">{pf ? nomePrat(pf) : 'Prateleira'}</div>
          <div className="sub">{caixasFoco.length} caixas cadastradas · andares A (baixo) a {String.fromCharCode(64 + (pf?.niveis ?? 3))} (alto)</div>
          <h2>Toque na caixa que você quer ver</h2>
          <div className="acoes">
            <button className="btn nav" title="Parada à esquerda" disabled={!alvoParada(-1)} onClick={() => andar(-1)}>◀</button>
            <button className="btn nav" title="Parada à direita" disabled={!alvoParada(1)} onClick={() => andar(1)}>▶</button>
            <button className="btn" onClick={() => setFoco(null)}>← Sair da prateleira</button>
          </div>
        </aside>
      )}
      {sel && (
        <aside className="painel">
          <button className="x" onClick={() => setSel(null)} aria-label="Fechar">×</button>
          <img className="foto" src={verEtiqueta && fotoEtiquetaSrc(sel) ? fotoEtiquetaSrc(sel) : fotoSrc(sel)} onClick={() => setAmpliar(true)} onError={e => ((e.target as HTMLImageElement).src = placeholder(sel.codigo))} alt={sel.nome} title="Clique para ampliar" />
          {fotoDaPeca(sel) && fotoEtiquetaSrc(sel) && (
            <button className="miniatura" onClick={() => setVerEtiqueta(v => !v)}>{verEtiqueta ? '← Ver a peça' : 'Ver foto da etiqueta'}</button>
          )}
          <div className="end">{endereco(sel)}</div>
          <div className="sub">{sel.semEndereco ? `caixa no chão, sem endereço · perto do corredor ${pad(linhaDe(sel))}` : `posto ${sel.posto} · corredor ${sel.corredor} · posição ${sel.posicao} · altura ${sel.altura}`}{sel.local && sel.local !== sel.corredor && ` · fica fisicamente no corredor ${pad(sel.local)}`}</div>
          <h2>{sel.nome || '(vazio)'}</h2>
          <div className="cod">{sel.codigo}{sel.cor && <span className="cor"> · cor {sel.cor}</span>}</div>
          {sel.lofo && <div>Lofo: {sel.lofo}</div>}
          {sel.embalagem && <div>Emb.: {sel.embalagem}</div>}
          {sel.qtd && <div>Quant./Embal.: {sel.qtd}</div>}
          {sel.obs && <div className="obs"><b>Observação:</b> {sel.obs}</div>}
          <div className="acoes">
            <button className="btn nav" title="Parada à esquerda" disabled={!alvoParada(-1)} onClick={() => andar(-1)}>◀</button>
            <button className="btn nav" title="Andar de cima (na prateleira)" disabled={!vizinho('cima')} onClick={() => subir('cima')}>▲</button>
            <button className="btn nav" title="Andar de baixo (na prateleira)" disabled={!vizinho('baixo')} onClick={() => subir('baixo')}>▼</button>
            <button className="btn nav" title="Parada à direita" disabled={!alvoParada(1)} onClick={() => andar(1)}>▶</button>
            <button className="btn" onClick={copiar}>{copiado ? 'Copiado ✓' : 'Copiar endereço'}</button>
          </div>
        </aside>
      )}
      {ampliar && sel && (
        <div className="lightbox" onClick={() => setAmpliar(false)}>
          <img src={verEtiqueta && fotoEtiquetaSrc(sel) ? fotoEtiquetaSrc(sel) : fotoSrc(sel)} alt={sel.nome} />
        </div>
      )}
      <footer>
        <span className="uso">Setas do teclado: ir ao endereço vizinho · Esc: voltar · clique numa caixa para ver a peça · vermelho: peça com observação</span>
        <span className="creditos">Criado por Fábio Sarri e Eviton Capistrano</span>
      </footer>
    </div>
  )
}
