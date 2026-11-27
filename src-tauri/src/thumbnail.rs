//! Miniatura de um documento para o gerenciador de arquivos: `mirante --thumbnail <arquivo> <saída.png> [tamanho]`.
//!
//! O Nautilus (e outros) roda o gerador numa caixa isolada, sem tela e sem rede: aqui não há navegador nem
//! janela. O texto vira uma "página" desenhada em SVG (títulos, parágrafos, listas, tabelas, código, caixas
//! de destaque) e os diagramas viram nós e ligações; o resvg transforma isso em PNG. Não é o desenho do app,
//! é um retrato reconhecível do arquivo no tamanho de um ícone.

use std::fmt::Write as _;
use std::path::Path;
use std::sync::OnceLock;

use pulldown_cmark::{CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use regex::Regex;
use resvg::{tiny_skia, usvg};

const W: f32 = 600.0; // página: 600 × 800 unidades, retrato
const H: f32 = 800.0;
const PAD: f32 = 46.0;
const MAX_BYTES: u64 = 256 * 1024;

const INK: &str = "#1c1c1e";
const MUTED: &str = "#6e6e73";
const LINE: &str = "#d1d1d6";
const SOFT: &str = "#f2f2f7";
const ACCENT: &str = "#007AFF";
const PALETTE: [&str; 6] = ["#007AFF", "#AF52DE", "#34C759", "#FF9500", "#FF2D55", "#32ADE6"];

/// Ponto de entrada do modo miniatura; devolve o código de saída do processo.
pub fn run(args: &[String]) -> i32 {
    let (Some(input), Some(output)) = (args.first(), args.get(1)) else {
        eprintln!("uso: mirante --thumbnail <arquivo> <saída.png> [tamanho]");
        return 2;
    };
    let size = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(256u32).clamp(16, 1024);
    let input = from_uri(input);
    match render_file(Path::new(&input), size).and_then(|png| std::fs::write(output, png).map_err(|e| e.to_string())) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("mirante --thumbnail: {e}");
            1
        }
    }
}

/// O Nautilus passa caminho (%i), mas outros gerenciadores mandam a URI (%u).
fn from_uri(s: &str) -> String {
    match s.strip_prefix("file://") {
        Some(rest) => percent_encoding::percent_decode_str(rest).decode_utf8_lossy().into_owned(),
        None => s.to_string(),
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Kind {
    Md,
    Tex,
    Mermaid,
    Dot,
    Typ,
}

pub fn kind_of(path: &Path) -> Kind {
    match path.extension().map(|e| e.to_string_lossy().to_lowercase()).as_deref() {
        Some("tex" | "latex" | "ltx") => Kind::Tex,
        Some("mmd" | "mermaid") => Kind::Mermaid,
        Some("gv" | "dot") => Kind::Dot,
        Some("typ") => Kind::Typ,
        _ => Kind::Md,
    }
}

/// Lê o começo do arquivo (uma miniatura não precisa do resto) e devolve o PNG.
pub fn render_file(path: &Path, size: u32) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut buf = Vec::new();
    std::fs::File::open(path).and_then(|f| f.take(MAX_BYTES).read_to_end(&mut buf)).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&buf);
    image(&text, kind_of(path), Some(path), size)?.encode_png().map_err(|e| e.to_string())
}

/// A miniatura em pixels (RGBA pré-multiplicado): o que o Windows e o Mac pedem. `path` só importa para o
/// Typst, que procura ao lado os arquivos incluídos; sem ele (o Windows passa só os bytes), compila sozinho.
pub fn image(text: &str, kind: Kind, path: Option<&Path>, size: u32) -> Result<tiny_skia::Pixmap, String> {
    if kind == Kind::Typ {
        // a primeira página compilada de verdade; sem ela (erro, pacote que pede rede), o texto em página simples
        let tmp;
        let p = match path {
            Some(p) => p,
            None => {
                tmp = std::env::temp_dir().join("mirante-miniatura.typ");
                &tmp
            }
        };
        let v = crate::typst_doc::render(p, text.to_string());
        if let Some(page) = v["pages"][0].as_str() {
            return to_pixmap(&typst_page_svg(page), size);
        }
    }
    to_pixmap(&page_svg(text, kind), size)
}

/// O tipo pelo conteúdo, quando não há nome de arquivo (o Explorer pode passar só os bytes).
pub fn sniff(text: &str) -> Kind {
    let head: String = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('%') && !l.starts_with("//") && !l.starts_with("%%"))
        .take(3)
        .collect::<Vec<_>>()
        .join("\n");
    let first = head.lines().next().unwrap_or("").to_lowercase();
    if text.contains("\\documentclass") || text.contains("\\begin{document}") {
        Kind::Tex
    } else if re(r"^(strict\s+)?(di)?graph\b").is_match(&first) {
        Kind::Dot
    } else if re(r"^(flowchart|graph\s+(td|tb|lr|rl|bt)|sequencediagram|classdiagram|statediagram|erdiagram|gantt|pie|mindmap|timeline|journey|gitgraph|quadrantchart|xychart|sankey|block|kanban|c4)").is_match(&first) {
        Kind::Mermaid
    } else if re(r"(?m)^#(set|import|let|show)\b").is_match(text) {
        Kind::Typ
    } else {
        Kind::Md
    }
}

/// A página do Typst dentro da moldura da miniatura, com o selo do tipo por cima.
fn typst_page_svg(page: &str) -> String {
    let (vb, body) = match (page.find('>'), page.rfind("</svg>")) {
        (Some(open), Some(close)) if open < close => {
            let head = &page[..open];
            let vb = head.split("viewBox=\"").nth(1).and_then(|r| r.split('"').next()).unwrap_or("0 0 595 842");
            (vb.to_string(), &page[open + 1..close])
        }
        _ => ("0 0 595 842".to_string(), ""),
    };
    let mut svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{W}" height="{H}" viewBox="0 0 {W} {H}"><rect x="1" y="1" width="{}" height="{}" rx="14" fill="#ffffff" stroke="{LINE}" stroke-width="2"/><svg x="2" y="2" width="{}" height="{}" viewBox="{vb}" preserveAspectRatio="xMidYMin meet">{body}</svg>"##,
        W - 2.0,
        H - 2.0,
        W - 4.0,
        H - 4.0
    );
    svg.push_str(&badge_svg(Kind::Typ, &font_families().0));
    svg.push_str("</svg>");
    svg
}

/// Texto do Typst para os blocos da página simples (quando não dá para compilar).
fn typst_blocks(src: &str) -> Vec<Block> {
    let mut out = Vec::new();
    let mut para = String::new();
    let flush = |para: &mut String, out: &mut Vec<Block>| {
        let t = para.trim();
        if !t.is_empty() {
            out.push(Block::Para(re(r"[*_]").replace_all(t, "").into_owned()));
        }
        para.clear();
    };
    for line in src.lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with("//") {
            flush(&mut para, &mut out);
        } else if let Some(c) = re(r"^(=+)\s+(.*)$").captures(t) {
            flush(&mut para, &mut out);
            let level = c[1].len() as u8;
            if level == 1 && out.is_empty() {
                out.push(Block::Title(c[2].to_string()));
            } else {
                out.push(Block::Heading(level.saturating_add(1).min(4), c[2].to_string()));
            }
        } else if let Some(c) = re(r"^([-+])\s+(.*)$").captures(t) {
            flush(&mut para, &mut out);
            let mark = if &c[1] == "+" { Mark::Number(1) } else { Mark::Bullet };
            out.push(Block::Item(0, mark, c[2].to_string()));
        } else if t.starts_with("$ ") && t.ends_with(" $") {
            flush(&mut para, &mut out);
            out.push(Block::Math(t.trim_matches('$').trim().to_string()));
        } else if t.starts_with('#') {
            flush(&mut para, &mut out); // #set, #import, #show…: configuração, não aparece
        } else {
            para.push(' ');
            para.push_str(t);
        }
    }
    flush(&mut para, &mut out);
    out
}

pub fn render(text: &str, kind: Kind, size: u32) -> Result<Vec<u8>, String> {
    to_pixmap(&page_svg(text, kind), size)?.encode_png().map_err(|e| e.to_string())
}

/* ---------------------------------------------------------------- modelo */

#[derive(Debug, Clone, Copy, PartialEq)]
enum Mark {
    Bullet,
    Number(u64),
    Todo(bool),
}

#[derive(Debug)]
enum Block {
    Title(String),
    Heading(u8, String),
    Para(String),
    Item(u8, Mark, String),
    Quote(Option<&'static str>, String, String), // cor da caixa, título, texto
    Code(Vec<String>),
    Math(String),
    Table(Vec<Vec<String>>),
    Diagram(Graph),
    Rule,
}

#[derive(Debug, Default)]
pub struct Graph {
    nodes: Vec<String>,
    edges: Vec<(usize, usize)>,
    tree: bool,       // mapa mental: raiz à esquerda, filhos em colunas
    horizontal: bool, // fluxograma LR / rankdir=LR
}

impl Graph {
    fn node(&mut self, id: &str, label: Option<&str>, ids: &mut Vec<String>) -> usize {
        if let Some(i) = ids.iter().position(|x| x == id) {
            if let Some(l) = label.filter(|l| !l.is_empty()) {
                self.nodes[i] = l.to_string();
            }
            return i;
        }
        ids.push(id.to_string());
        self.nodes.push(label.filter(|l| !l.is_empty()).unwrap_or(id).to_string());
        self.nodes.len() - 1
    }
    fn edge(&mut self, a: usize, b: usize) {
        if a != b && !self.edges.contains(&(a, b)) {
            self.edges.push((a, b));
        }
    }
}

/* ---------------------------------------------------------------- Markdown */

const CALLOUT_COLOR: [(&str, &str); 12] = [
    ("note", "#007AFF"), ("info", "#007AFF"), ("tip", "#34C759"), ("hint", "#34C759"), ("important", "#AF52DE"),
    ("warning", "#FF9500"), ("caution", "#FF3B30"), ("danger", "#FF3B30"), ("example", "#8E8E93"),
    ("question", "#32ADE6"), ("summary", "#30B0C7"), ("abstract", "#30B0C7"),
];

fn callout(text: &str) -> Option<(&'static str, String, String)> {
    let re = re(r"^\s*\[!([A-Za-z]+)\][+-]?[ \t]*([^\n]*)\n?");
    let c = re.captures(text)?;
    let kind = c[1].to_lowercase();
    let color = CALLOUT_COLOR.iter().find(|(k, _)| *k == kind).map(|(_, c)| *c).unwrap_or(ACCENT);
    let mut title = c[2].trim().to_string();
    if title.is_empty() {
        title = callout_title(&kind);
    }
    Some((color, title, text[c.get(0).unwrap().end()..].trim().to_string()))
}

/// Título padrão de uma caixa sem título, no idioma do sistema (o mesmo que o app usa).
fn callout_title(kind: &str) -> String {
    let pt = ["LC_ALL", "LC_MESSAGES", "LANG"].iter().find_map(|v| std::env::var(v).ok().filter(|s| !s.is_empty())).is_some_and(|l| l.starts_with("pt"));
    let (p, e) = match kind {
        "note" | "info" => ("Nota", "Note"),
        "tip" | "hint" => ("Dica", "Tip"),
        "important" => ("Importante", "Important"),
        "warning" => ("Atenção", "Warning"),
        "caution" | "danger" => ("Cuidado", "Caution"),
        "example" => ("Exemplo", "Example"),
        "question" => ("Pergunta", "Question"),
        "summary" | "abstract" => ("Resumo", "Summary"),
        _ => ("", ""),
    };
    if p.is_empty() {
        let mut k = kind.chars();
        return k.next().map(|f| f.to_uppercase().collect::<String>() + k.as_str()).unwrap_or_default();
    }
    (if pt { p } else { e }).to_string()
}

fn markdown(src: &str) -> Vec<Block> {
    let src = re(r"^\u{feff}?---\r?\n[\s\S]*?\r?\n(---|\.\.\.)\r?\n").replace(src, "");
    // as do Obsidian também: [[links]] viram o nome da nota e as notas de rodapé ficam de fora
    let opts = Options::ENABLE_TABLES | Options::ENABLE_TASKLISTS | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_MATH
        | Options::ENABLE_FOOTNOTES | Options::ENABLE_WIKILINKS;
    let src = re(r"%%[\s\S]*?%%").replace_all(&src, "");
    let mut in_note = 0usize;
    let mut out = Vec::new();
    let mut buf = String::new();
    let mut lists: Vec<Option<u64>> = Vec::new();
    let mut item_mark: Option<Mark> = None;
    let mut quote: Option<String> = None;
    let mut code: Option<(String, String)> = None;
    let mut table: Option<Vec<Vec<String>>> = None;
    let mut only_math = true;
    let mut h1_seen = false;

    let flush_para = |buf: &mut String, out: &mut Vec<Block>, lists: &Vec<Option<u64>>, item_mark: &mut Option<Mark>, quote: &mut Option<String>| {
        let t = buf.trim().to_string();
        buf.clear();
        if t.is_empty() {
            return;
        }
        if let Some(q) = quote.as_mut() {
            if !q.is_empty() {
                q.push('\n');
            }
            q.push_str(&t);
        } else if let Some(m) = item_mark.take() {
            out.push(Block::Item(lists.len().saturating_sub(1) as u8, m, t));
        } else if !lists.is_empty() {
            out.push(Block::Para(t));
        } else {
            out.push(Block::Para(t));
        }
    };

    for ev in Parser::new_ext(&src, opts) {
        match &ev {
            Event::Start(Tag::FootnoteDefinition(_)) => in_note += 1,
            Event::End(TagEnd::FootnoteDefinition) => {
                in_note -= 1;
                continue;
            }
            Event::FootnoteReference(_) => continue,
            _ => {}
        }
        if in_note > 0 {
            continue;
        }
        match ev {
            Event::Start(Tag::Heading { .. }) => buf.clear(),
            Event::End(TagEnd::Heading(level)) => {
                let t = buf.trim().to_string();
                buf.clear();
                let l = match level {
                    HeadingLevel::H1 => 1,
                    HeadingLevel::H2 => 2,
                    HeadingLevel::H3 => 3,
                    _ => 4,
                };
                if l == 1 && !h1_seen && out.is_empty() {
                    h1_seen = true;
                    out.push(Block::Title(t));
                } else {
                    out.push(Block::Heading(l, t));
                }
            }
            Event::Start(Tag::Paragraph) => {
                buf.clear();
                only_math = true;
            }
            Event::End(TagEnd::Paragraph) => {
                if only_math && !buf.trim().is_empty() && quote.is_none() && item_mark.is_none() {
                    out.push(Block::Math(buf.trim().to_string()));
                    buf.clear();
                } else {
                    flush_para(&mut buf, &mut out, &lists, &mut item_mark, &mut quote);
                }
            }
            Event::Start(Tag::List(start)) => {
                flush_para(&mut buf, &mut out, &lists, &mut item_mark, &mut quote);
                lists.push(start);
            }
            Event::End(TagEnd::List(_)) => {
                flush_para(&mut buf, &mut out, &lists, &mut item_mark, &mut quote);
                lists.pop();
            }
            Event::Start(Tag::Item) => {
                flush_para(&mut buf, &mut out, &lists, &mut item_mark, &mut quote);
                let n = lists.last_mut().and_then(|s| s.as_mut().map(|n| {
                    *n += 1;
                    *n - 1
                }));
                item_mark = Some(n.map(Mark::Number).unwrap_or(Mark::Bullet));
            }
            Event::End(TagEnd::Item) => flush_para(&mut buf, &mut out, &lists, &mut item_mark, &mut quote),
            Event::TaskListMarker(done) => item_mark = Some(Mark::Todo(done)),
            Event::Start(Tag::BlockQuote(_)) => quote = Some(String::new()),
            Event::End(TagEnd::BlockQuote(_)) => {
                flush_para(&mut buf, &mut out, &lists, &mut item_mark, &mut quote);
                if let Some(q) = quote.take() {
                    match callout(&q) {
                        Some((color, title, text)) => out.push(Block::Quote(Some(color), title, text)),
                        None => out.push(Block::Quote(None, String::new(), q)),
                    }
                }
            }
            Event::Start(Tag::CodeBlock(k)) => {
                let lang = match k {
                    CodeBlockKind::Fenced(l) => l.split_whitespace().next().unwrap_or("").to_lowercase(),
                    CodeBlockKind::Indented => String::new(),
                };
                code = Some((lang, String::new()));
            }
            Event::End(TagEnd::CodeBlock) => {
                if let Some((lang, body)) = code.take() {
                    match lang.as_str() {
                        "mermaid" | "mmd" => out.push(Block::Diagram(mermaid(&body))),
                        "dot" | "graphviz" | "gv" => out.push(Block::Diagram(dot(&body))),
                        "math" => out.push(Block::Math(pretty_math(&body))),
                        _ => out.push(Block::Code(body.lines().map(str::to_string).collect())),
                    }
                }
            }
            Event::Start(Tag::Table(_)) => table = Some(Vec::new()),
            Event::End(TagEnd::Table) => {
                if let Some(t) = table.take() {
                    out.push(Block::Table(t));
                }
            }
            Event::Start(Tag::TableHead | Tag::TableRow) => {
                if let Some(t) = table.as_mut() {
                    t.push(Vec::new());
                }
            }
            Event::Start(Tag::TableCell) => buf.clear(),
            Event::End(TagEnd::TableCell) => {
                if let Some(row) = table.as_mut().and_then(|t| t.last_mut()) {
                    row.push(buf.trim().to_string());
                }
                buf.clear();
            }
            Event::Rule => out.push(Block::Rule),
            Event::Text(t) => {
                if let Some((_, body)) = code.as_mut() {
                    body.push_str(&t);
                } else {
                    if !t.trim().is_empty() {
                        only_math = false;
                    }
                    buf.push_str(&t);
                }
            }
            Event::Code(t) => {
                only_math = false;
                buf.push_str(&t);
            }
            Event::InlineMath(t) => {
                only_math = false;
                buf.push_str(&pretty_math(&t));
            }
            Event::DisplayMath(t) => buf.push_str(&pretty_math(&t)),
            // na caixa de destaque a 1ª linha é o título: a quebra precisa sobreviver
            Event::SoftBreak | Event::HardBreak => buf.push(if quote.is_some() { '\n' } else { ' ' }),
            Event::Html(h) | Event::InlineHtml(h) => {
                // <summary>Ver resposta</summary> é o que se vê de um <details> fechado
                if let Some(c) = re(r"<summary[^>]*>([\s\S]*?)</summary>").captures(&h) {
                    out.push(Block::Para(format!("▸ {}", strip_tags(&c[1]).trim())));
                }
            }
            _ => {}
        }
    }
    out
}

fn strip_tags(s: &str) -> String {
    re(r"<[^>]*>").replace_all(s, "").into_owned()
}

/* ---------------------------------------------------------------- fórmulas */

/// LaTeX de fórmula → texto com símbolos: \frac{a}{b} → a/b, \alpha → α, x^2 → x². Só para a miniatura.
fn pretty_math(tex: &str) -> String {
    const SYM: [(&str, &str); 64] = [
        ("alpha", "α"), ("beta", "β"), ("gamma", "γ"), ("delta", "δ"), ("epsilon", "ε"), ("varepsilon", "ε"), ("zeta", "ζ"),
        ("eta", "η"), ("theta", "θ"), ("lambda", "λ"), ("mu", "μ"), ("nu", "ν"), ("xi", "ξ"), ("pi", "π"), ("rho", "ρ"),
        ("sigma", "σ"), ("tau", "τ"), ("phi", "φ"), ("varphi", "φ"), ("chi", "χ"), ("psi", "ψ"), ("omega", "ω"),
        ("Gamma", "Γ"), ("Delta", "Δ"), ("Theta", "Θ"), ("Lambda", "Λ"), ("Sigma", "Σ"), ("Phi", "Φ"), ("Psi", "Ψ"),
        ("Omega", "Ω"), ("infty", "∞"), ("int", "∫"), ("oint", "∮"), ("sum", "Σ"), ("prod", "∏"), ("partial", "∂"),
        ("nabla", "∇"), ("to", "→"), ("rightarrow", "→"), ("Rightarrow", "⇒"), ("leftarrow", "←"), ("iff", "⇔"),
        ("implies", "⇒"), ("le", "≤"), ("leq", "≤"), ("ge", "≥"), ("geq", "≥"), ("neq", "≠"), ("ne", "≠"),
        ("approx", "≈"), ("equiv", "≡"), ("pm", "±"), ("times", "×"), ("cdot", "·"), ("div", "÷"), ("in", "∈"),
        ("notin", "∉"), ("subset", "⊂"), ("cup", "∪"), ("cap", "∩"), ("forall", "∀"), ("exists", "∃"), ("circ", "∘"),
        ("ldots", "…"),
    ];
    const SUP: [(char, char); 13] = [('0', '⁰'), ('1', '¹'), ('2', '²'), ('3', '³'), ('4', '⁴'), ('5', '⁵'), ('6', '⁶'),
        ('7', '⁷'), ('8', '⁸'), ('9', '⁹'), ('n', 'ⁿ'), ('+', '⁺'), ('-', '⁻')];
    const SUB: [(char, char); 10] = [('0', '₀'), ('1', '₁'), ('2', '₂'), ('3', '₃'), ('4', '₄'), ('5', '₅'), ('6', '₆'),
        ('7', '₇'), ('8', '₈'), ('9', '₉')];
    let mut t = re(r"\\(label|tag)\*?\{[^}]*\}|\\(begin|end)\{[^}]*\}(\{[^}]*\})?|\\(nonumber|notag|left|right|displaystyle|limits)\b").replace_all(tex, "").into_owned();
    t = re(r"\\(ce|pu|text|mathrm|mathbf|mathit|operatorname|textrm|mbox)\*?\{([^{}]*)\}").replace_all(&t, "$2").into_owned();
    t = re(r"\\mathbb\{R\}").replace_all(&t, "ℝ").into_owned();
    t = re(r"\\mathbb\{N\}").replace_all(&t, "ℕ").into_owned();
    t = re(r"\\mathbb\{Z\}").replace_all(&t, "ℤ").into_owned();
    for _ in 0..3 {
        t = re(r"\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}").replace_all(&t, "($1)/($2)").into_owned();
        t = re(r"\\sqrt\{([^{}]*)\}").replace_all(&t, "√($1)").into_owned();
    }
    // (x)/(2) → x/2, mas f(x) continua f(x)
    t = re(r"\(([A-Za-z0-9.]+)\)/").replace_all(&t, "$1/").into_owned();
    t = re(r"/\(([A-Za-z0-9.]+)\)").replace_all(&t, "/$1").into_owned();
    t = re(r"\\([A-Za-z]+)").replace_all(&t, |c: &regex::Captures| {
        let w = &c[1];
        SYM.iter().find(|(k, _)| *k == w).map(|(_, v)| v.to_string()).unwrap_or_else(|| {
            if ["sin", "cos", "tan", "log", "ln", "lim", "exp", "max", "min", "det"].contains(&w) { w.to_string() } else { String::new() }
        })
    }).into_owned();
    // expoente e índice curtos viram caracteres sobrescritos/subscritos
    t = re(r"\^\{?([0-9n+-]{1,3})\}?").replace_all(&t, |c: &regex::Captures| {
        c[1].chars().map(|ch| SUP.iter().find(|(a, _)| *a == ch).map(|(_, b)| *b).unwrap_or(ch)).collect::<String>()
    }).into_owned();
    t = re(r"_\{?([0-9]{1,3})\}?").replace_all(&t, |c: &regex::Captures| {
        c[1].chars().map(|ch| SUB.iter().find(|(a, _)| *a == ch).map(|(_, b)| *b).unwrap_or(ch)).collect::<String>()
    }).into_owned();
    t = re(r"\^\{([^{}]+)\}").replace_all(&t, "^($1)").into_owned();
    t = t.replace("\\\\", "   ").replace(['{', '}', '&'], "").replace("\\,", " ").replace("\\;", " ").replace('\\', "");
    re(r"\s+").replace_all(&t, " ").trim().to_string()
}

/* ---------------------------------------------------------------- LaTeX */

/// Conteúdo do {…} que começa em `s[i]` (ou "" se não houver), e onde ele termina.
fn braced(s: &str, i: usize) -> (String, usize) {
    let b = s.as_bytes();
    let mut j = i;
    while j < b.len() && (b[j] as char).is_whitespace() {
        j += 1;
    }
    if j >= b.len() || b[j] != b'{' {
        return (String::new(), i);
    }
    let (mut depth, start) = (0i32, j + 1);
    while j < b.len() {
        match b[j] {
            b'\\' => j += 1,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return (s[start..j].to_string(), j + 1);
                }
            }
            _ => {}
        }
        j += 1;
    }
    (s[start.min(s.len())..].to_string(), s.len())
}

/// Texto de LaTeX sem os comandos: \textbf{x} → x, \cite{..} some, ~ vira espaço.
fn tex_text(s: &str) -> String {
    let s = re(r"\\(begin|end)\{[^}]*\}").replace_all(s, " ");
    let s = re(r"\$([^$]+)\$").replace_all(&s, |c: &regex::Captures| pretty_math(&c[1]));
    let mut t = re(r"\\(label|cite[a-z]*|ref|eqref|footnote|vspace|hspace|index)\*?(\[[^\]]*\])?\{[^{}]*\}").replace_all(&s, "").into_owned();
    for _ in 0..4 {
        t = re(r"\\[a-zA-Z@]+\*?(\[[^\]]*\])?\{([^{}]*)\}").replace_all(&t, "$2").into_owned();
    }
    t = re(r"\\[a-zA-Z@]+\*?").replace_all(&t, "").into_owned();
    t = re(r"\\(.)").replace_all(&t, "$1").into_owned();
    t = t.replace(['{', '}', '$'], "").replace('~', " ").replace("---", "—").replace("--", "–");
    re(r"\s+").replace_all(&t, " ").trim().to_string()
}

fn latex(src: &str) -> Vec<Block> {
    let src = re(r"(?m)(^|[^\\])%.*$").replace_all(src, "$1");
    let title = src.find("\\title").map(|i| braced(&src, i + 6).0).filter(|t| !t.is_empty());
    let body = match (src.find("\\begin{document}"), src.find("\\end{document}")) {
        (Some(a), Some(b)) if b > a => &src[a + 16..b],
        (Some(a), _) => &src[a + 16..],
        _ => &src[..],
    };
    let mut out = Vec::new();
    let token = re(r"\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(\[[^\]]*\])?|\\begin\{([a-zA-Z*]+)\}|\\maketitle|\\\[|\$\$");
    let mut text_from = 0;
    let mut i = 0;
    let push_text = |s: &str, out: &mut Vec<Block>| {
        for p in re(r"\n\s*\n").split(s) {
            let t = tex_text(p);
            if t.chars().count() > 1 {
                out.push(Block::Para(t));
            }
        }
    };
    while let Some(m) = token.find_at(body, i) {
        push_text(&body[text_from..m.start()], &mut out);
        let tok = m.as_str();
        let mut end = m.end();
        if tok == "\\maketitle" {
            if let Some(t) = &title {
                out.push(Block::Title(tex_text(t)));
            }
        } else if tok == "\\[" || tok == "$$" {
            let close = if tok == "$$" { "$$" } else { "\\]" };
            let e = body[end..].find(close).map(|k| end + k).unwrap_or(body.len());
            out.push(Block::Math(pretty_math(&body[end..e])));
            end = (e + close.len()).min(body.len());
        } else if tok.starts_with("\\begin") {
            let env = token.captures(tok).and_then(|c| c.get(3)).map(|g| g.as_str().to_string()).unwrap_or_default();
            let close = format!("\\end{{{env}}}");
            let e = body[end..].find(&close).map(|k| end + k).unwrap_or(body.len());
            let inner = &body[end..e];
            end = (e + close.len()).min(body.len());
            let base = env.trim_end_matches('*');
            match base {
                "itemize" | "enumerate" | "description" => {
                    for (n, it) in inner.split("\\item").skip(1).enumerate() {
                        let mut mark = if base == "enumerate" { Mark::Number(n as u64 + 1) } else { Mark::Bullet };
                        let mut it = it.trim_start();
                        // \item[$\boxtimes$] e \item[$\square$]: tarefa; outro rótulo some
                        if it.starts_with('[') {
                            if let Some(k) = it.find(']') {
                                let label = &it[..k];
                                if label.contains("boxtimes") || label.contains("checkmark") {
                                    mark = Mark::Todo(true);
                                } else if label.contains("square") {
                                    mark = Mark::Todo(false);
                                }
                                it = &it[k + 1..];
                            }
                        }
                        out.push(Block::Item(0, mark, tex_text(it)));
                    }
                }
                "equation" | "align" | "gather" | "multline" | "displaymath" | "eqnarray" | "flalign" => {
                    out.push(Block::Math(pretty_math(inner)))
                }
                "tabular" | "tabularx" | "longtable" => {
                    let inner = re(r"^\s*(\{[^}]*\})?\s*\{(?:[^{}]|\{[^{}]*\})*\}").replace(inner, "");
                    let rows: Vec<Vec<String>> = re(r"\\\\(\[[^\]]*\])?")
                        .split(&inner)
                        .map(|r| re(r"\\(hline|toprule|midrule|bottomrule)").replace_all(r, ""))
                        .filter(|r| !r.trim().is_empty())
                        .map(|r| r.split('&').map(tex_text).collect())
                        .collect();
                    if !rows.is_empty() {
                        out.push(Block::Table(rows));
                    }
                }
                "verbatim" | "Verbatim" | "lstlisting" | "minted" => {
                    let code = re(r"^(\[[^\]]*\])?(\{[^}]*\})?\n?").replace(inner, "");
                    out.push(Block::Code(code.lines().map(str::to_string).collect()));
                }
                "abstract" => out.push(Block::Quote(Some("#30B0C7"), String::new(), tex_text(inner))),
                "figure" | "table" | "center" | "quote" | "theorem" | "definition" | "proof" | "minipage" => {
                    // só o que está dentro interessa; volta para o laço a partir do miolo
                    end = m.end();
                    i = end;
                    text_from = end;
                    continue;
                }
                _ => push_text(inner, &mut out),
            }
        } else {
            let level = match token.captures(tok).and_then(|c| c.get(1)).map(|g| g.as_str()) {
                Some("part" | "chapter") => 2,
                Some("section") => 2,
                Some("subsection") => 3,
                _ => 4,
            };
            let (t, e) = braced(body, end);
            end = e;
            out.push(Block::Heading(level, tex_text(&t)));
        }
        i = end;
        text_from = end;
    }
    push_text(&body[text_from.min(body.len())..], &mut out);
    // \end{…} das caixas que só foram atravessadas sobram como texto vazio: já filtrado em tex_text
    out
}

/* ---------------------------------------------------------------- diagramas */

fn re(p: &'static str) -> &'static Regex {
    // cada padrão é compilado uma vez por processo
    static CACHE: OnceLock<std::sync::Mutex<Vec<(&'static str, &'static Regex)>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    let mut c = cache.lock().unwrap();
    if let Some((_, r)) = c.iter().find(|(k, _)| *k == p) {
        return r;
    }
    let r: &'static Regex = Box::leak(Box::new(Regex::new(p).expect("regex")));
    c.push((p, r));
    r
}

fn clean_label(s: &str) -> String {
    let s = s.trim().trim_matches('"').replace("<br/>", " ").replace("<br>", " ");
    let s = re(r"\$\$?([^$]*)\$\$?").replace_all(&s, "$1");
    strip_tags(&s).trim().to_string()
}

/// Mermaid: mapa mental pela indentação; fluxograma, sequência e estados pelas setas.
pub fn mermaid(src: &str) -> Graph {
    let lines: Vec<&str> = src
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.trim_start().starts_with("%%"))
        .collect();
    let head = lines.first().map(|l| l.trim().to_lowercase()).unwrap_or_default();
    let mut g = Graph::default();
    let mut ids = Vec::new();
    if head.starts_with("mindmap") {
        g.tree = true;
        let mut stack: Vec<(usize, usize)> = Vec::new(); // (indentação, nó)
        for l in &lines[1..] {
            let ind = l.len() - l.trim_start().len();
            let t = l.trim();
            if t.starts_with("::") {
                continue;
            }
            let label = re(r"^[\w-]*\s*(\(\(|\)\)|\{\{|\[|\(|\))\s*(.*?)\s*(\)\)|\(\(|\}\}|\]|\)|\()$")
                .captures(t)
                .map(|c| c[2].to_string())
                .unwrap_or_else(|| t.to_string());
            let n = g.nodes.len();
            g.nodes.push(clean_label(&label));
            while stack.last().is_some_and(|&(i, _)| i >= ind) {
                stack.pop();
            }
            if let Some(&(_, p)) = stack.last() {
                g.edge(p, n);
            }
            stack.push((ind, n));
        }
        return g;
    }
    g.horizontal = re(r"^(flowchart|graph)\s+(lr|rl)\b").is_match(&head);
    if head.starts_with("sequencediagram") {
        g.horizontal = true;
        for l in &lines[1..] {
            if let Some(c) = re(r"^\s*(?:participant|actor)\s+(\S+)(?:\s+as\s+(.+))?").captures(l) {
                g.node(&c[1], c.get(2).map(|m| m.as_str()), &mut ids);
            } else if let Some(c) = re(r"^\s*([^\s:>-]+)\s*-[->x)]+\+?-?\s*([^\s:]+)\s*:").captures(l) {
                let a = g.node(&c[1], None, &mut ids);
                let b = g.node(&c[2], None, &mut ids);
                g.edge(a, b);
            }
        }
        return g;
    }
    let arrow = re(r"\s*(?:<?-{2,}>?|<?={2,}>?|-\.+->?|--[ox]|<?-->|--\s*\|[^|]*\|\s*>?)\s*(?:\|[^|]*\|)?\s*");
    let node = re(r##"^([\w.\-]+)\s*(?:(\(\(|\[\[|\[\(|\(\[|\[/|\[\\|\{\{|\[|\(|\{|>)\s*"?(.*?)"?\s*(\)\)|\]\]|\)\]|\]\)|/\]|\\\]|\}\}|\]|\)|\})\s*)?(?::::\w+)?$"##);
    for l in lines.iter().skip(1) {
        let t = l.trim();
        if re(r"^(subgraph|end|style|classDef|class|linkStyle|click|direction|state\s|note|%%)").is_match(t) {
            continue;
        }
        let t = re(r"^state\s+").replace(t, "");
        let parts: Vec<&str> = arrow.split(&t).collect();
        let mut prev: Option<Vec<usize>> = None;
        for p in parts {
            let here: Vec<usize> = p
                .split('&')
                .filter_map(|x| {
                    let x = x.trim().trim_end_matches(';');
                    node.captures(x).map(|c| (c[1].to_string(), c.get(3).map(|m| clean_label(m.as_str()))))
                })
                .filter(|(id, _)| id != "[*]")
                .map(|(id, label)| g.node(&id, label.as_deref(), &mut ids))
                .collect();
            if let Some(prev) = &prev {
                for &a in prev {
                    for &b in &here {
                        g.edge(a, b);
                    }
                }
            }
            if !here.is_empty() {
                prev = Some(here);
            }
        }
    }
    g
}

/// Graphviz: os nós com label e as ligações a -> b -> c (ou a -- b).
pub fn dot(src: &str) -> Graph {
    let mut g = Graph::default();
    let mut ids = Vec::new();
    let src = re(r"(?s)/\*.*?\*/|//[^\n]*|#[^\n]*").replace_all(src, "");
    g.horizontal = re(r##"rankdir\s*=\s*"?(LR|RL)"##).is_match(&src);
    let id = r##"(?:"[^"]*"|[\w.]+)"##;
    let chain = Regex::new(&format!(r"{id}(?:\s*(?:->|--)\s*{id})+")).unwrap();
    let one = Regex::new(id).unwrap();
    let unq = |s: &str| s.trim_matches('"').to_string();
    for c in re(r##"(?:^|[;{\n])\s*("[^"]*"|[\w.]+)\s*\[([^\]]*)\]"##).captures_iter(&src) {
        let name = unq(&c[1]);
        if ["graph", "node", "edge"].contains(&name.as_str()) {
            continue;
        }
        let label = re(r##"label\s*=\s*"([^"]*)""##).captures(&c[2]).map(|l| l[1].replace("\\n", " "));
        g.node(&name, label.as_deref(), &mut ids);
    }
    for m in chain.find_iter(&src) {
        let names: Vec<String> = one.find_iter(m.as_str()).map(|x| unq(x.as_str())).collect();
        let idx: Vec<usize> = names.iter().map(|n| g.node(n, None, &mut ids)).collect();
        for w in idx.windows(2) {
            g.edge(w[0], w[1]);
        }
    }
    g
}

/* ---------------------------------------------------------------- SVG */

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Quebra o texto em linhas pela largura (estimada: a fonte não está medida, e numa miniatura tanto faz).
fn wrap(text: &str, size: f32, width: f32, mono: bool, bold: bool, max_lines: usize) -> Vec<String> {
    // largura média de um caractere na DejaVu Sans (a fonte preferida), com folga
    let per = ((width / (size * if mono { 0.62 } else if bold { 0.66 } else { 0.57 })) as usize).max(4);
    let mut lines = Vec::new();
    let mut cur = String::new();
    for word in text.split_whitespace() {
        if !cur.is_empty() && cur.chars().count() + 1 + word.chars().count() > per {
            lines.push(std::mem::take(&mut cur));
            if lines.len() == max_lines {
                break;
            }
        }
        if !cur.is_empty() {
            cur.push(' ');
        }
        cur.push_str(word);
    }
    if lines.len() < max_lines && !cur.is_empty() {
        lines.push(cur);
    }
    for l in &mut lines {
        if l.chars().count() > per {
            *l = l.chars().take(per.saturating_sub(1)).collect::<String>() + "…";
        }
    }
    lines
}

fn short(s: &str, n: usize) -> String {
    if s.chars().count() <= n { s.to_string() } else { s.chars().take(n.saturating_sub(1)).collect::<String>() + "…" }
}

struct Page {
    svg: String,
    y: f32,
    sans: String,
    mono: String,
}

impl Page {
    fn text(&mut self, x: f32, y: f32, size: f32, weight: u16, color: &str, t: &str, mono: bool) {
        let fam = if mono { &self.mono } else { &self.sans };
        let _ = write!(
            self.svg,
            r##"<text x="{x:.1}" y="{y:.1}" font-family="{fam}" font-size="{size}" font-weight="{weight}" fill="{color}">{}</text>"##,
            esc(t)
        );
    }
    fn lines(&mut self, x: f32, size: f32, weight: u16, color: &str, t: &str, max: usize) {
        for l in wrap(t, size, W - PAD - x, false, weight >= 600, max) {
            self.y += size * 1.35;
            if self.y > H {
                return;
            }
            self.text(x, self.y, size, weight, color, &l, false);
        }
    }
    fn full(&self) -> bool {
        self.y > H - 40.0
    }
}

fn badge(kind: Kind) -> (&'static str, &'static str) {
    match kind {
        Kind::Md => ("MD", ACCENT),
        Kind::Tex => ("TEX", "#008080"),
        Kind::Mermaid => ("MMD", "#AF52DE"),
        Kind::Dot => ("GV", "#34C759"),
        Kind::Typ => ("TYP", "#239DAD"),
    }
}

fn page_svg(text: &str, kind: Kind) -> String {
    let (sans, mono) = font_families();
    let mut p = Page { svg: String::new(), y: PAD - 6.0, sans, mono };
    let _ = write!(
        p.svg,
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}"><rect x="1" y="1" width="{}" height="{}" rx="14" fill="#ffffff" stroke="{LINE}" stroke-width="2"/>"##,
        W - 2.0,
        H - 2.0
    );
    match kind {
        Kind::Mermaid | Kind::Dot => {
            let g = if kind == Kind::Dot { dot(text) } else { mermaid(text) };
            draw_graph(&mut p, &g, PAD, PAD, W - 2.0 * PAD, H - 2.0 * PAD - 40.0);
        }
        Kind::Md | Kind::Tex | Kind::Typ => {
            let blocks = match kind {
                Kind::Tex => latex(text),
                Kind::Typ => typst_blocks(text),
                _ => markdown(text),
            };
            draw_blocks(&mut p, &blocks);
        }
    }
    let sans = p.sans.clone();
    p.svg.push_str(&badge_svg(kind, &sans));
    p.svg.push_str("</svg>");
    p.svg
}

/// Selo com o tipo, grande no canto de baixo: é o que se lê quando o ícone está pequeno (lista, 32 px).
fn badge_svg(kind: Kind, sans: &str) -> String {
    let (label, color) = badge(kind);
    let (bh, fs, margin) = (165.0f32, 112.0f32, 26.0f32);
    // largura das maiúsculas em negrito da DejaVu Sans, em em
    let em: f32 = label.chars().map(|c| match c { 'M' => 0.99, 'D' | 'G' => 0.84, 'V' | 'X' | 'Y' => 0.77, 'T' => 0.69, _ => 0.72 }).sum();
    let bw = 70.0 + em * fs;
    let (bx, by) = (W - margin - bw, H - margin - bh);
    format!(
        r##"<rect x="{bx:.1}" y="{by:.1}" width="{bw:.1}" height="{bh}" rx="30" fill="{color}" stroke="#ffffff" stroke-width="10"/><text x="{:.1}" y="{:.1}" font-family="{sans}" font-size="{fs}" font-weight="700" fill="#ffffff" text-anchor="middle">{label}</text>"##,
        bx + bw / 2.0,
        by + bh / 2.0 + fs * 0.36
    )
}

fn draw_blocks(p: &mut Page, blocks: &[Block]) {
    let x0 = PAD;
    for b in blocks {
        if p.full() {
            break;
        }
        match b {
            Block::Title(t) => {
                p.y += 8.0;
                p.lines(x0, 40.0, 800, INK, t, 2);
                p.y += 14.0;
            }
            Block::Heading(l, t) => {
                let size = match l { 1 => 34.0, 2 => 29.0, 3 => 24.0, _ => 21.0 };
                p.y += 16.0;
                p.lines(x0, size, 700, INK, t, 2);
                if *l <= 2 {
                    p.y += 10.0;
                    let _ = write!(p.svg, r##"<rect x="{x0}" y="{:.1}" width="{:.1}" height="2" fill="{LINE}"/>"##, p.y, W - 2.0 * PAD);
                }
                p.y += 6.0;
            }
            Block::Para(t) => {
                p.lines(x0, 19.0, 400, INK, t, 4);
                p.y += 12.0;
            }
            Block::Item(depth, mark, t) => {
                let x = x0 + 28.0 + *depth as f32 * 28.0;
                let top = p.y;
                p.lines(x, 19.0, 400, INK, t, 2);
                let cy = top + 19.0 * 1.35 - 6.0;
                match mark {
                    Mark::Bullet => {
                        let _ = write!(p.svg, r##"<circle cx="{:.1}" cy="{cy:.1}" r="4" fill="{INK}"/>"##, x - 16.0);
                    }
                    Mark::Number(n) => {
                        let sans_n = format!("{n}.");
                        p.text(x - 26.0, top + 19.0 * 1.35, 19.0, 400, MUTED, &sans_n, false);
                    }
                    Mark::Todo(done) => {
                        let fill = if *done { ACCENT } else { "none" };
                        let _ = write!(
                            p.svg,
                            r##"<rect x="{:.1}" y="{:.1}" width="15" height="15" rx="4" fill="{fill}" stroke="{}" stroke-width="2"/>"##,
                            x - 24.0,
                            cy - 8.0,
                            if *done { ACCENT } else { MUTED }
                        );
                    }
                }
                p.y += 6.0;
            }
            Block::Quote(color, title, t) => {
                let top = p.y + 8.0;
                p.y += 8.0;
                let c = color.unwrap_or(LINE);
                if !title.is_empty() {
                    p.lines(x0 + 22.0, 19.0, 700, c, title, 1);
                }
                p.lines(x0 + 22.0, 18.0, 400, if color.is_some() { INK } else { MUTED }, t, 3);
                p.y += 12.0;
                let h = p.y - top;
                let bg = if color.is_some() { format!(r##"<rect x="{x0}" y="{top:.1}" width="{:.1}" height="{h:.1}" rx="8" fill="{c}" fill-opacity="0.09"/>"##, W - 2.0 * PAD) } else { String::new() };
                // o fundo vai para trás do texto que acabou de ser escrito
                let bar = format!(r##"{bg}<rect x="{x0}" y="{top:.1}" width="5" height="{h:.1}" rx="2.5" fill="{c}"/>"##);
                insert_before_last_texts(&mut p.svg, &bar, top);
                p.y += 12.0;
            }
            Block::Code(lines) => {
                let top = p.y + 6.0;
                let shown: Vec<&String> = lines.iter().take(6).collect();
                let h = 22.0 + shown.len() as f32 * 21.0;
                let _ = write!(p.svg, r##"<rect x="{x0}" y="{top:.1}" width="{:.1}" height="{h:.1}" rx="10" fill="{SOFT}"/>"##, W - 2.0 * PAD);
                for (k, l) in shown.iter().enumerate() {
                    let t = short(&l.replace('\t', "    "), 44);
                    p.text(x0 + 16.0, top + 28.0 + k as f32 * 21.0, 16.0, 400, "#3a3a3c", &t, true);
                }
                p.y = top + h + 14.0;
            }
            Block::Math(t) => {
                let t = short(&re(r"\s+").replace_all(t, " "), 40);
                p.y += 34.0;
                let mid = W / 2.0;
                let fam = "serif";
                let _ = write!(
                    p.svg,
                    r##"<text x="{mid}" y="{:.1}" font-family="{fam}" font-style="italic" font-size="22" fill="{INK}" text-anchor="middle">{}</text>"##,
                    p.y,
                    esc(&t)
                );
                p.y += 18.0;
            }
            Block::Table(rows) => {
                let cols = rows.iter().map(Vec::len).max().unwrap_or(1).max(1);
                let cw = (W - 2.0 * PAD) / cols as f32;
                let top = p.y + 8.0;
                let shown = rows.len().min(6);
                let rh = 30.0;
                let _ = write!(p.svg, r##"<rect x="{x0}" y="{top:.1}" width="{:.1}" height="{rh}" rx="6" fill="{SOFT}"/>"##, W - 2.0 * PAD);
                for (r, row) in rows.iter().take(shown).enumerate() {
                    let y = top + r as f32 * rh;
                    if r > 0 {
                        let _ = write!(p.svg, r##"<rect x="{x0}" y="{y:.1}" width="{:.1}" height="1.5" fill="{LINE}"/>"##, W - 2.0 * PAD);
                    }
                    for (c, cell) in row.iter().enumerate().take(cols) {
                        let n = ((cw - 16.0) / (17.0 * if r == 0 { 0.66 } else { 0.57 })) as usize;
                        p.text(x0 + 8.0 + c as f32 * cw, y + 21.0, 17.0, if r == 0 { 700 } else { 400 }, INK, &short(cell, n.max(3)), false);
                    }
                }
                p.y = top + shown as f32 * rh + 16.0;
            }
            Block::Diagram(g) => {
                let top = p.y + 8.0;
                let h = 210.0f32.min(H - top - 60.0).max(80.0);
                let _ = write!(p.svg, r##"<rect x="{x0}" y="{top:.1}" width="{:.1}" height="{h:.1}" rx="12" fill="{SOFT}"/>"##, W - 2.0 * PAD);
                draw_graph(p, g, x0 + 12.0, top + 12.0, W - 2.0 * PAD - 24.0, h - 24.0);
                p.y = top + h + 16.0;
            }
            Block::Rule => {
                p.y += 14.0;
                let _ = write!(p.svg, r##"<rect x="{x0}" y="{:.1}" width="{:.1}" height="2" fill="{LINE}"/>"##, p.y, W - 2.0 * PAD);
                p.y += 12.0;
            }
        }
    }
}

/// As caixas de destaque são desenhadas depois do texto delas (só então se sabe a altura): o fundo é
/// inserido antes do primeiro <text> que começa abaixo do topo da caixa.
fn insert_before_last_texts(svg: &mut String, shape: &str, top: f32) {
    let mut at = svg.len();
    let mut search = svg.len();
    while let Some(i) = svg[..search].rfind("<text ") {
        let y = svg[i..].split("y=\"").nth(1).and_then(|s| s.split('"').next()).and_then(|s| s.parse::<f32>().ok());
        if y.is_some_and(|y| y > top) {
            at = i;
            search = i;
        } else {
            break;
        }
    }
    svg.insert_str(at, shape);
}

/// Nós e ligações numa caixa: mapa mental em árvore, o resto em camadas pela distância da origem.
fn draw_graph(p: &mut Page, g: &Graph, bx: f32, by: f32, bw: f32, bh: f32) {
    let n = g.nodes.len().min(24);
    if n == 0 {
        // tipo sem nós legíveis (gantt, pizza…): três caixas ligadas, só para dizer "diagrama"
        let fake = Graph { nodes: vec![String::new(); 3], edges: vec![(0, 1), (1, 2)], tree: false, horizontal: true };
        return draw_graph(p, &fake, bx, by, bw, bh);
    }
    let mut incoming = vec![0usize; n];
    let mut children: Vec<Vec<usize>> = vec![Vec::new(); n];
    for &(a, b) in &g.edges {
        if a < n && b < n {
            incoming[b] += 1;
            children[a].push(b);
        }
    }
    // camada = distância (em ligações) a partir das origens
    let mut layer = vec![usize::MAX; n];
    let mut queue: Vec<usize> = (0..n).filter(|&i| incoming[i] == 0).collect();
    if queue.is_empty() {
        queue.push(0);
    }
    for &q in &queue {
        layer[q] = 0;
    }
    let mut k = 0;
    while k < queue.len() {
        let a = queue[k];
        for &b in &children[a] {
            if layer[b] == usize::MAX {
                layer[b] = layer[a] + 1;
                queue.push(b);
            }
        }
        k += 1;
        if k == queue.len() {
            if let Some(rest) = (0..n).find(|&i| layer[i] == usize::MAX) {
                layer[rest] = 0;
                queue.push(rest);
            }
        }
    }
    let layers = layer.iter().max().copied().unwrap_or(0) + 1;
    let mut rows: Vec<Vec<usize>> = vec![Vec::new(); layers];
    for i in 0..n {
        rows[layer[i]].push(i);
    }
    let across = rows.iter().map(Vec::len).max().unwrap_or(1);
    let horizontal = g.tree || g.horizontal;
    // tamanho natural, depois tudo escala para caber na caixa
    let (nw, nh, gap_l, gap_a) = (170.0f32, 56.0f32, 70.0f32, 26.0f32);
    let (along, cross) = if horizontal { (nw, nh) } else { (nh, nw) };
    let total_l = layers as f32 * along + (layers - 1) as f32 * gap_l;
    let total_a = across as f32 * cross + (across.saturating_sub(1)) as f32 * gap_a;
    let (tw, th) = if horizontal { (total_l, total_a) } else { (total_a, total_l) };
    let s = (bw / tw).min(bh / th).min(1.6);
    let ox = bx + (bw - tw * s) / 2.0;
    let oy = by + (bh - th * s) / 2.0;
    let mut pos = vec![(0.0f32, 0.0f32); n];
    for (l, row) in rows.iter().enumerate() {
        let span = row.len() as f32 * cross + (row.len().saturating_sub(1)) as f32 * gap_a;
        let start = (total_a - span) / 2.0;
        for (j, &i) in row.iter().enumerate() {
            let a = l as f32 * (along + gap_l);
            let c = start + j as f32 * (cross + gap_a);
            pos[i] = if horizontal { (a, c) } else { (c, a) };
        }
    }
    let _ = write!(p.svg, r##"<g transform="translate({ox:.1} {oy:.1}) scale({s:.3})">"##);
    for &(a, b) in &g.edges {
        if a >= n || b >= n {
            continue;
        }
        let (ax, ay) = (pos[a].0 + nw / 2.0, pos[a].1 + nh / 2.0);
        let (bx2, by2) = (pos[b].0 + nw / 2.0, pos[b].1 + nh / 2.0);
        let d = if horizontal {
            let (sx, ex) = (ax + nw / 2.0, bx2 - nw / 2.0);
            let m = (sx + ex) / 2.0;
            format!("M{sx:.1} {ay:.1} C{m:.1} {ay:.1} {m:.1} {by2:.1} {ex:.1} {by2:.1}")
        } else {
            let (sy, ey) = (ay + nh / 2.0, by2 - nh / 2.0);
            let m = (sy + ey) / 2.0;
            format!("M{ax:.1} {sy:.1} C{ax:.1} {m:.1} {bx2:.1} {m:.1} {bx2:.1} {ey:.1}")
        };
        let _ = write!(p.svg, r##"<path d="{d}" fill="none" stroke="#8e8e93" stroke-width="3"/>"##);
    }
    for i in 0..n {
        // no mapa mental cada ramo da raiz tem uma cor; no resto, a cor vem da camada
        let color = if g.tree { PALETTE[branch_of(g, i) % PALETTE.len()] } else { PALETTE[layer[i] % PALETTE.len()] };
        let (x, y) = pos[i];
        let _ = write!(
            p.svg,
            r##"<rect x="{x:.1}" y="{y:.1}" width="{nw}" height="{nh}" rx="14" fill="{color}" fill-opacity="0.14" stroke="{color}" stroke-width="3"/>"##
        );
        let label = short(&g.nodes[i], 15);
        if !label.is_empty() {
            let sans = p.sans.clone();
            let _ = write!(
                p.svg,
                r##"<text x="{:.1}" y="{:.1}" font-family="{sans}" font-size="21" font-weight="600" fill="{INK}" text-anchor="middle">{}</text>"##,
                x + nw / 2.0,
                y + nh / 2.0 + 7.0,
                esc(&label)
            );
        }
    }
    p.svg.push_str("</g>");
}

/// Filho da raiz de quem o nó descende (para a cor do ramo no mapa mental).
fn branch_of(g: &Graph, mut i: usize) -> usize {
    for _ in 0..64 {
        match g.edges.iter().find(|&&(_, b)| b == i) {
            Some(&(0, _)) | None => return i,
            Some(&(a, _)) => i = a,
        }
    }
    i
}

/* ---------------------------------------------------------------- PNG */

fn fontdb() -> &'static std::sync::Arc<usvg::fontdb::Database> {
    static DB: OnceLock<std::sync::Arc<usvg::fontdb::Database>> = OnceLock::new();
    DB.get_or_init(|| {
        let mut db = usvg::fontdb::Database::new();
        db.load_system_fonts();
        let (sans, mono) = pick_families(&db);
        db.set_sans_serif_family(sans);
        db.set_monospace_family(mono);
        let serif = ["DejaVu Serif", "Noto Serif", "Liberation Serif", "Times New Roman", "Cambria", "Georgia"]
            .into_iter()
            .find(|f| has_family(&db, f));
        if let Some(s) = serif {
            db.set_serif_family(s);
        }
        std::sync::Arc::new(db)
    })
}

fn has_family(db: &usvg::fontdb::Database, name: &str) -> bool {
    db.faces().any(|f| f.families.iter().any(|(n, _)| n == name))
}

/// Família com um arquivo de negrito: as fontes variáveis (como a Ubuntu atual) entram com um peso só,
/// e o título sairia fino.
fn has_bold(db: &usvg::fontdb::Database, name: &str) -> bool {
    db.faces().any(|f| f.weight.0 >= 600 && f.families.iter().any(|(n, _)| n == name))
}

fn pick_families(db: &usvg::fontdb::Database) -> (String, String) {
    // DejaVu antes: cobre setas, grego e símbolos de fórmula; sem eles o resvg troca a linha inteira de fonte
    const SANS: [&str; 9] = ["DejaVu Sans", "Noto Sans", "Inter", "Ubuntu", "Cantarell", "Liberation Sans", "Segoe UI", "Arial", "Helvetica"];
    let sans = SANS
        .into_iter()
        .find(|f| has_bold(db, f))
        .or_else(|| SANS.into_iter().find(|f| has_family(db, f)))
        .unwrap_or("sans-serif");
    let mono = ["Ubuntu Mono", "DejaVu Sans Mono", "Noto Sans Mono", "Liberation Mono", "Cascadia Mono", "Consolas", "Courier New"]
        .into_iter()
        .find(|f| has_family(db, f))
        .unwrap_or("monospace");
    (sans.to_string(), mono.to_string())
}

fn font_families() -> (String, String) {
    pick_families(fontdb())
}

fn to_pixmap(svg: &str, size: u32) -> Result<tiny_skia::Pixmap, String> {
    let opt = usvg::Options { fontdb: fontdb().clone(), ..Default::default() };
    let tree = usvg::Tree::from_str(svg, &opt).map_err(|e| e.to_string())?;
    // o lado maior é `size`, como pede a especificação de miniaturas do freedesktop
    let h = size;
    let w = ((size as f32) * W / H).round().max(1.0) as u32;
    let mut pixmap = tiny_skia::Pixmap::new(w, h).ok_or("tamanho inválido")?;
    resvg::render(&tree, tiny_skia::Transform::from_scale(w as f32 / W, h as f32 / H), &mut pixmap.as_mut());
    Ok(pixmap)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mermaid_fluxograma_e_mapa() {
        let g = mermaid("flowchart LR\n  A[Início] --> B{Decisão?}\n  B -->|sim| C[Fim]\n  B --> D(Outro) & C");
        assert_eq!(g.nodes, ["Início", "Decisão?", "Fim", "Outro"]);
        assert!(g.horizontal && g.edges.contains(&(0, 1)) && g.edges.contains(&(1, 3)) && g.edges.contains(&(1, 2)));
        let m = mermaid("mindmap\n  root((Tema))\n    Ramo um\n      Folha\n    Ramo dois");
        assert!(m.tree);
        assert_eq!(m.nodes, ["Tema", "Ramo um", "Folha", "Ramo dois"]);
        assert_eq!(m.edges, [(0, 1), (1, 2), (0, 3)]);
    }

    #[test]
    fn tipo_pelo_conteudo() {
        assert_eq!(sniff("# Título\n\ntexto"), Kind::Md);
        assert_eq!(sniff("%% comentário\nflowchart LR\n A-->B"), Kind::Mermaid);
        assert_eq!(sniff("mindmap\n  root((x))"), Kind::Mermaid);
        assert_eq!(sniff("digraph G { a -> b }"), Kind::Dot);
        assert_eq!(sniff("\\documentclass{article}\n\\begin{document}x\\end{document}"), Kind::Tex);
        assert_eq!(sniff("#set page(paper: \"a4\")\n= Oi"), Kind::Typ);
    }

    #[test]
    fn graphviz() {
        let g = dot("digraph { rankdir=LR; a [label=\"Entrada\"]; a -> b -> c; b -> \"d e\" }");
        assert_eq!(g.nodes, ["Entrada", "b", "c", "d e"]);
        assert!(g.horizontal && g.edges.len() == 3);
    }

    #[test]
    fn markdown_e_latex_viram_blocos() {
        let b = markdown("# Título\n\nTexto.\n\n- [x] feito\n\n> [!TIP] Dica\n> conteúdo\n\n$$\nx^2\n$$\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
        assert!(matches!(b[0], Block::Title(_)));
        assert!(b.iter().any(|x| matches!(x, Block::Item(_, Mark::Todo(true), _))));
        assert!(b.iter().any(|x| matches!(x, Block::Quote(Some(_), t, _) if t == "Dica")));
        assert!(b.iter().any(|x| matches!(x, Block::Math(_))));
        assert!(b.iter().any(|x| matches!(x, Block::Table(r) if r.len() == 2)));
        assert_eq!(pretty_math("\\frac{1}{x} + \\alpha^2 + f(x) + e^{i\\pi}"), "1/x + α² + f(x) + e^(iπ)");
        let t = latex("\\title{Artigo}\\begin{document}\\maketitle\n\\section{Intro}\nTexto \\textbf{forte}.\n\\begin{itemize}\\item um\\item dois\\end{itemize}\n\\end{document}");
        assert!(matches!(&t[0], Block::Title(s) if s == "Artigo"));
        assert!(matches!(&t[1], Block::Heading(2, s) if s == "Intro"));
        assert!(t.iter().any(|x| matches!(x, Block::Para(s) if s == "Texto forte.")));
        assert_eq!(t.iter().filter(|x| matches!(x, Block::Item(..))).count(), 2);
    }

    #[test]
    fn gera_png_de_cada_tipo() {
        for (k, src) in [
            (Kind::Md, "# Oi\n\nTexto & <tags>\n"),
            (Kind::Tex, "\\section{A} texto"),
            (Kind::Mermaid, "pie\n \"a\": 1"),
            (Kind::Dot, "digraph { a -> b }"),
            (Kind::Typ, "= Oi\n\n- item\n\n$ x^2 $"),
        ] {
            let png = render(src, k, 128).unwrap();
            assert_eq!(&png[1..4], b"PNG");
        }
    }
}
