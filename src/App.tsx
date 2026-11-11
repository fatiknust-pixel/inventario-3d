import { useEffect, useMemo, useRef, useState } from 'react'
import Cena, { CORES, geometriaItem, idPrat, montarLayout, nomePrat } from './Cena'
import { Item, linhaDe, baixarModelo, fotoDaPeca, fotoEtiquetaSrc, dadosExemplo, dadosReais, dadosDemo, endereco, fotoSrc, lerExcel, placeholder } from './dados'

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
  const campoBusca = useRef<HTMLInputElement>(null)
  const [buscando, setBuscando] = useState(false) // a lista de resultados só aparece com o cursor na busca

  useEffect(() => setVerEtiqueta(false), [sel])

  const lay = useMemo(() => montarLayout(itens), [itens])

  const achados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return null
    return new Set(itens.filter(i => `${i.codigo} ${i.cor ?? ''} ${i.nome} ${endereco(i)}`.toLowerCase().includes(q)))
  }, [busca, itens])

  const naPrateleira = (i: Item) => i.tipo === 'prateleira'
  function clicarItem(i: Item) {
    if (naPrateleira(i) && foco !== idPrat(i)) { chegada.current = null; setFoco(idPrat(i)); setSel(null) }
    else { if (!naPrateleira(i)) setFoco(null); setSel(i) }
  }
  function escolher(i: Item) { setFoco(naPrateleira(i) ? idPrat(i) : null); setSel(i) }
  function fundo() { if (sel) setSel(null); else setFoco(null) }
  function irPara(c: number | null) { setSel(null); setFoco(null); setPreset({ c, n: Date.now() }) }
  function irPrateleira(id: string) { chegada.current = null; setSel(null); setFoco(id) }

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

  // Dentro de uma prateleira as setas andam de caixa em caixa; só saem nas pontas (ou em "Sair da prateleira").
  const chegada = useRef<-1 | 1 | null>(null) // de que lado eu entrei na prateleira (◀ ou ▶)
  const xDe = (i: Item) => geometriaItem(i, lay).pos.x
  // caixas de um andar da prateleira, da esquerda para a direita vista de frente
  function fileiraDaPrat(id: string, altura: string): Item[] {
    const f = lay.prat.get(id)?.frente ?? 1
    return itens.filter(i => i.tipo === 'prateleira' && idPrat(i) === id && i.altura === altura).sort((a, b) => (xDe(a) - xDe(b)) * f)
  }
  const alturasDa = (id: string) => [...new Set(itens.filter(i => i.tipo === 'prateleira' && idPrat(i) === id).map(i => i.altura))].sort()
  type Alvo = { item?: Item; parada?: Parada }
  function alvoSetas(d: -1 | 1): Alvo | undefined {
    if (sel?.tipo === 'prateleira') {
      const fila = fileiraDaPrat(idPrat(sel), sel.altura)
      const vizinha = fila[fila.indexOf(sel) + d]
      if (vizinha) return { item: vizinha }
    } else if (!sel && foco != null && (chegada.current == null || chegada.current === d)) {
      // acabei de entrar: a seta no sentido em que vim escolhe a caixa da ponta por onde entrei
      const baixo = alturasDa(foco)[0]
      const fila = baixo ? fileiraDaPrat(foco, baixo) : []
      const it = d === 1 ? fila[0] : fila[fila.length - 1]
      if (it) return { item: it }
    }
    const p = alvoParada(d) // fora da prateleira, ou na ponta dela: vai para a caixa do lado
    return p ? { parada: p } : undefined
  }
  function andar(d: -1 | 1) {
    const a = alvoSetas(d)
    if (a?.item) escolher(a.item)
    else if (a?.parada?.prat) { chegada.current = d; setSel(null); setFoco(a.parada.prat) } // entra na prateleira
    else if (a?.parada?.item) { chegada.current = null; escolher(a.parada.item) }
  }
  // ▲ ▼: andar de cima/baixo, escolhendo a caixa mais próxima na horizontal
  function alvoVertical(dir: 'cima' | 'baixo'): Item | undefined {
    if (sel?.tipo !== 'prateleira') return
    const id = idPrat(sel)
    const alts = alturasDa(id)
    const alt = alts[alts.indexOf(sel.altura) + (dir === 'cima' ? 1 : -1)]
    const fila = alt ? fileiraDaPrat(id, alt) : []
    if (!fila.length) return
    const x = xDe(sel)
    return fila.reduce((m, c) => (Math.abs(xDe(c) - x) < Math.abs(xDe(m) - x) ? c : m))
  }
  function subir(dir: 'cima' | 'baixo') { const v = alvoVertical(dir); if (v) escolher(v) }

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
    <div className={`app${sel || foco != null ? ' comPainel' : ''}`}>
      <div className="topo">
      <header>
        <b>Inventário 3D</b>
        <input
          ref={campoBusca}
          className="busca"
          type="search"
          enterKeyHint="search"
          onFocus={() => setBuscando(true)}
          onBlur={() => setBuscando(false)}
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
            <button className="btn" onClick={() => { setItens(dadosDemo()); irPara(1) }}>Demonstração completa</button>
            <button className="btn" onClick={() => { setItens(dadosExemplo()); setSel(null); setFoco(null) }}>Dados de exemplo</button>
          </div>
        </details>
        <input ref={arquivo} type="file" accept=".xlsx,.xls,.csv" hidden onChange={e => { importar(e.target.files?.[0]); e.target.value = '' }} />
      </header>
      <nav className="atalhos">
        <button className="chip" onClick={() => irPara(null)}>Visão geral</button>
        {[...lay.linhas.keys()].sort((a, b) => a - b).map(c => <button key={c} className="chip" onClick={() => irPara(c)}><span className="lg">Corredor </span>{pad(c)}</button>)}
        {[...lay.prat.values()].map(p => <button key={p.id} className={`chip${foco === p.id ? ' on' : ''}`} onClick={() => irPrateleira(p.id)}><span className="lg">Prateleira </span><span className="sm">Prat. </span>{pad(p.posto)} {pad(p.corredor)}</button>)}
      </nav>
      </div>
      {erro && <div className="erro">{erro}</div>}
      <Cena itens={itens} selecionado={sel} foco={foco} achados={achados} preset={preset} onSel={clicarItem} onFoco={id => { setFoco(id); setSel(null) }} onFundo={fundo} />
      {achados && !sel && buscando && (
        <ul className="lista" onPointerDown={e => e.preventDefault()}>
          {[...achados].slice(0, 8).map((i, k) => (
            <li key={k} onClick={() => { escolher(i); campoBusca.current?.blur() }}>
              <span><b>{endereco(i)}</b> · {i.nome || '(vazio)'}</span>
              <small>{i.codigo}</small>
            </li>
          ))}
          {achados.size === 0 && <li className="mais">Nada encontrado</li>}
          {achados.size > 8 && <li className="mais">+{achados.size - 8} resultados…</li>}
        </ul>
      )}
      {foco != null && !sel && (
        <aside className="painel simples">
          <div className="end">{pf ? nomePrat(pf) : 'Prateleira'}</div>
          <div className="sub">{caixasFoco.length} caixas cadastradas · andares A (baixo) a {String.fromCharCode(64 + (pf?.niveis ?? 3))} (alto)</div>
          <h2>Toque na caixa que você quer ver</h2>
          <div className="acoes">
            <button className="btn nav" title="Entrar pela esquerda / sair para a esquerda" disabled={!alvoSetas(-1)} onClick={() => andar(-1)}>◀</button>
            <button className="btn nav" title="Entrar pela direita / sair para a direita" disabled={!alvoSetas(1)} onClick={() => andar(1)}>▶</button>
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
          {sel.simulado && <div className="sub">⚠ Caixa simulada (demonstração)</div>}
          <div className="sub">{sel.semEndereco ? `caixa no chão, sem endereço · perto do corredor ${pad(linhaDe(sel))}` : `posto ${sel.posto} · corredor ${sel.corredor} · posição ${sel.posicao} · altura ${sel.altura}`}{sel.local && sel.local !== sel.corredor && ` · fica fisicamente no corredor ${pad(sel.local)}`}</div>
          <h2>{sel.nome || '(vazio)'}</h2>
          <div className="cod">{sel.codigo}{sel.cor && <span className="cor"> · cor {sel.cor}</span>}</div>
          {sel.lofo && <div className="dado">Lofo: {sel.lofo}</div>}
          {sel.embalagem && <div className="dado">Emb.: {sel.embalagem}</div>}
          {sel.qtd && <div className="dado">Quant./Embal.: {sel.qtd}</div>}
          {sel.status && <div className={`situacao st-${sel.status}`}>{sel.status === 'ok' ? 'Certo' : sel.status === 'duvida' ? 'Dúvida' : 'Erro'}</div>}
          {sel.obs && <div className={`obs${sel.status ? ` st-${sel.status}` : ''}`}><b>Observação:</b> {sel.obs}</div>}
          <div className="acoes">
            <button className="btn nav" title="Caixa à esquerda" disabled={!alvoSetas(-1)} onClick={() => andar(-1)}>◀</button>
            <button className="btn nav" title="Andar de cima (na prateleira)" disabled={!alvoVertical('cima')} onClick={() => subir('cima')}>▲</button>
            <button className="btn nav" title="Andar de baixo (na prateleira)" disabled={!alvoVertical('baixo')} onClick={() => subir('baixo')}>▼</button>
            <button className="btn nav" title="Caixa à direita" disabled={!alvoSetas(1)} onClick={() => andar(1)}>▶</button>
            <button className="btn" onClick={copiar}>{copiado ? 'Copiado ✓' : 'Copiar endereço'}</button>
            {sel.tipo === 'prateleira' && <button className="btn" onClick={() => { setFoco(null); setSel(null) }}>← Sair da prateleira</button>}
          </div>
        </aside>
      )}
      {ampliar && sel && (
        <div className="lightbox" onClick={() => setAmpliar(false)}>
          <img src={verEtiqueta && fotoEtiquetaSrc(sel) ? fotoEtiquetaSrc(sel) : fotoSrc(sel)} alt={sel.nome} />
        </div>
      )}
      <div className="legenda" aria-label="Legenda das cores">
        <span><i style={{ background: CORES.ok }} />Certo</span>
        <span><i style={{ background: CORES.duvida }} />Dúvida</span>
        <span><i style={{ background: CORES.erro }} />Erro</span>
        <span><i style={{ background: CORES.normal }} />Não conferido</span>
      </div>
      <footer>
        <span className="uso">Setas do teclado: ir ao endereço vizinho · Esc: voltar · clique numa caixa para ver a peça</span>
        <span className="creditos">Criado por Fábio Sarri e Eviton Capistrano</span>
      </footer>
    </div>
  )
}
