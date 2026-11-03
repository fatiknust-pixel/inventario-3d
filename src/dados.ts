import * as XLSX from 'xlsx'
import reais from './dados-reais.json'
import fotosPeca from './fotos-peca.json'

export type Item = {
  posto: number
  corredor: number
  posicao: number
  altura: string // A (baixa), B, C (alta)
  codigo: string
  nome: string
  lofo?: string
  embalagem?: string
  qtd?: string
  foto?: string // nome do arquivo em public/fotos, ou URL
  fotoEtiqueta?: string
  tipo?: 'rack' | 'prateleira'
}

const p2 = (n: number) => String(n).padStart(2, '0')
export const endereco = (i: Item) => `${p2(i.posto)} ${p2(i.corredor)} ${p2(i.posicao)} ${i.altura}`

export function placeholder(texto: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220"><rect width="100%" height="100%" fill="#2a3340"/><text x="50%" y="46%" fill="#8fa3b8" font-family="sans-serif" font-size="16" text-anchor="middle">sem foto</text><text x="50%" y="60%" fill="#cfe0f0" font-family="sans-serif" font-size="15" text-anchor="middle">${texto}</text></svg>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}

// foto da peça: vale para todos os endereços com o mesmo código
export const fotoDaPeca = (i: Item) => i.foto || (fotosPeca as Record<string, string>)[i.codigo]
const urlFoto = (f: string) => (/^(https?:|data:)/.test(f) ? f : `${import.meta.env.BASE_URL}fotos/${f}`)
export const fotoEtiquetaSrc = (i: Item) => (i.fotoEtiqueta ? urlFoto(i.fotoEtiqueta) : undefined)

export function fotoSrc(i: Item) {
  const f = fotoDaPeca(i) || i.fotoEtiqueta
  if (!f) return placeholder(i.codigo)
  if (/^(https?:|data:)/.test(f)) return f
  return `${import.meta.env.BASE_URL}fotos/${f}`
}

export const dadosReais = (): Item[] => reais as Item[]

// ---------- dados de exemplo (corredores 10 e 11) ----------
const NOMES = ['LU ESTRIBO DIR', 'LU ESTRIBO ESQ', 'SUPORTE FIXACAO', 'CHAPA REFORCO', 'TRAVESSA INFERIOR', 'GUIA LATERAL', 'BRACADEIRA 40MM', 'PARAFUSO M10', 'COXIM MOTOR', 'TAMPA FRONTAL', 'SUPORTE BATERIA', 'ARRUELA LISA', 'CANTONEIRA', 'FIXADOR TRASEIRO']

export function dadosExemplo(): Item[] {
  const itens: Item[] = []
  let n = 0
  for (const corredor of [10, 11]) {
    for (let posto = 1; posto <= 4; posto++) {
      for (let posicao = 1; posicao <= 6; posicao++) {
        for (const altura of ['A', 'B', 'C']) {
          n++
          if (n % 7 === 0) continue // alguns endereços vazios
          itens.push({
            posto, corredor, posicao, altura,
            codigo: `A95866${String(10000 + n * 37)}`,
            nome: NOMES[n % NOMES.length],
            embalagem: `T5 ${7000 + n}`,
            qtd: `${2 + (n % 5) * 2} pç(s)`,
            tipo: 'rack',
          })
        }
      }
    }
  }
  // prateleira de exemplo (corredor 01): 3 andares x 4 caixas
  for (const altura of ['A', 'B', 'C'])
    for (let posicao = 1; posicao <= 4; posicao++) {
      n++
      itens.push({ posto: 4, corredor: 1, posicao, altura, codigo: `N9101${String(n * 13).padStart(5, '0')}`, nome: NOMES[n % NOMES.length], embalagem: `B4059${n}`, qtd: `${50 * posicao} pç(s)`, tipo: 'prateleira' })
    }
  // exemplo real da etiqueta
  const real = { posto: 4, corredor: 11, posicao: 3, altura: 'A', codigo: 'A9586605101', nome: 'LU ESTRIBO DIR', embalagem: 'T5 7942', qtd: '6 pç(s)', tipo: 'rack' as const }
  const i = itens.findIndex(x => x.posto === 4 && x.corredor === 11 && x.posicao === 3 && x.altura === 'A')
  if (i >= 0) itens[i] = real
  else itens.push(real)
  return itens
}

// ---------- Excel ----------
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')

const COLUNAS: Record<string, keyof Item | 'coordenador'> = {
  posto: 'posto', corredor: 'corredor', posicao: 'posicao', altura: 'altura',
  item: 'codigo', codigo: 'codigo', peca: 'codigo',
  descricao: 'nome', nome: 'nome', nomedapeca: 'nome',
  lofo: 'lofo',
  embalagem: 'embalagem', emb: 'embalagem',
  qtd: 'qtd', quantidade: 'qtd', qtdembal: 'qtd',
  foto: 'foto', fotopeca: 'foto', fotodapeca: 'foto',
  fotoetiqueta: 'fotoEtiqueta', etiqueta: 'fotoEtiqueta',
  tipo: 'tipo',
  coordenador: 'coordenador', cordinator: 'coordenador', endereco: 'coordenador',
}

export async function lerExcel(file: File): Promise<Item[]> {
  const wb = XLSX.read(await file.arrayBuffer())
  const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' })
  const itens: Item[] = []
  for (const l of linhas) {
    const r: Record<string, string> = {}
    for (const [k, v] of Object.entries(l)) {
      const campo = COLUNAS[norm(k)]
      if (campo) r[campo] = String(v).trim()
    }
    // "04 11 03 A" ou "04-11-03-A"
    if (r.coordenador) {
      const m = r.coordenador.match(/(\d+)\D+(\d+)\D+(\d+)\D*([A-Za-z])/)
      if (m) Object.assign(r, { posto: m[1], corredor: m[2], posicao: m[3], altura: m[4] })
    }
    const posto = parseInt(r.posto), corredor = parseInt(r.corredor), posicao = parseInt(r.posicao)
    if (!r.altura || [posto, corredor, posicao].some(isNaN)) continue
    itens.push({
      posto, corredor, posicao, altura: r.altura.toUpperCase(),
      codigo: r.codigo ?? '', nome: r.nome ?? '', lofo: r.lofo, embalagem: r.embalagem, qtd: r.qtd,
      foto: r.foto || undefined, fotoEtiqueta: r.fotoEtiqueta || undefined,
      tipo: r.tipo?.toLowerCase().startsWith('prat') ? 'prateleira' : 'rack',
    })
  }
  return itens
}

export function baixarModelo() {
  const linhas = [
    { posto: 4, corredor: 11, posicao: 3, altura: 'A', item: 'A9586605101', descricao: 'LU ESTRIBO DIR', embalagem: 'T5 7942', qtd: '6 pç(s)', foto: 'A9586605101.jpg', tipo: 'rack' },
    { posto: 4, corredor: 11, posicao: 3, altura: 'B', item: '', descricao: '', embalagem: '', qtd: '', foto: '', tipo: 'rack' },
  ]
  const ws = XLSX.utils.json_to_sheet(linhas)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Enderecos')
  XLSX.writeFile(wb, 'modelo-enderecos.xlsx')
}
