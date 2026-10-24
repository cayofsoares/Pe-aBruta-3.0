const API_URL = 'https://pe-abruta-3-0.onrender.com/api';

function apiFetch(url, options = {}) {
    return fetch(url, {
        ...options,
        headers: {
            ...(options.headers || {}),
        }
    });
}

const listaSolicitacoes = document.getElementById('lista-solicitacoes');
const estadoSolicitacoes = document.getElementById('estado-solicitacoes');
const campoBusca = document.getElementById('busca-solicitacoes');
const filtroCategoria = document.getElementById('filtroCategoria');
let tokenLoja = null;
let solicitacoesAbertas = [];
const midiasPorSolicitacao = new Map();

function escaparHTML(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, (caractere) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[caractere]);
}

function escaparAtributo(valor) {
    return escaparHTML(valor).replace(/`/g, '&#96;');
}

function normalizarTexto(valor) {
    return String(valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function lerSessaoLoja() {
    let sessao = {};
    try {
        sessao = JSON.parse(sessionStorage.getItem('usuario') || '{}');
    } catch (erro) {
        console.warn('Sessão do lojista inválida.');
    }
    const usuario = sessao.user || sessao;
    tokenLoja = sessionStorage.getItem('token') || sessao.token || sessao.user?.token || null;
    return { usuario, tipo: String(usuario.tipo || '').toLowerCase() };
}

function formatarData(data) {
    if (!data) return 'Data não informada';
    const dataValida = new Date(data);
    return Number.isNaN(dataValida.getTime()) ? 'Data não informada' : dataValida.toLocaleString('pt-BR');
}

function prepararMidias(arquivos) {
    const lista = Array.isArray(arquivos) ? arquivos : (arquivos ? [arquivos] : []);
    return lista.map((arquivo) => {
        if (!arquivo || typeof arquivo !== 'object') return null;
        const tipo = String(arquivo.tipo || '').toLowerCase();
        let src = String(arquivo.base64 || '').trim();
        if (!src || !/^(image|video|audio)\//.test(tipo)) return null;
        if (!src.startsWith('data:')) src = `data:${tipo};base64,${src}`;
        return { tipo, src, nome: String(arquivo.nome || 'Arquivo anexado') };
    }).filter(Boolean);
}

function renderizarMidiaAtiva(midia) {
    const src = escaparAtributo(midia.src);
    const nome = escaparHTML(midia.nome);

    if (midia.tipo.startsWith('image/')) {
        return `<img src="${src}" alt="${nome}" loading="lazy" decoding="async">`;
    }
    if (midia.tipo.startsWith('video/')) {
        return `<video controls preload="metadata" playsinline aria-label="${nome}"><source src="${src}" type="${escaparAtributo(midia.tipo)}">Seu navegador não suporta vídeo.</video>`;
    }
    return `<audio controls preload="metadata" aria-label="${nome}"><source src="${src}" type="${escaparAtributo(midia.tipo)}">Seu navegador não suporta áudio.</audio>`;
}

function formatarMidia(arquivos, idSolicitacao) {
    const midias = prepararMidias(arquivos);
    if (midias.length === 0) {
        return '<p class="solic-endereco">O cliente não anexou imagem ou vídeo.</p>';
    }

    const id = String(idSolicitacao || '');
    midiasPorSolicitacao.set(id, midias);
    return `
        <div class="solic-carousel" data-solicitacao-id="${escaparAtributo(id)}" data-indice-midia="0">
            <div class="solic-carousel-palco">${renderizarMidiaAtiva(midias[0])}</div>
            ${midias.length > 1 ? `
                <button type="button" class="solic-carousel-btn anterior" data-midia-nav="anterior" aria-label="Anexo anterior">‹</button>
                <button type="button" class="solic-carousel-btn proximo" data-midia-nav="proximo" aria-label="Próximo anexo">›</button>
                <span class="solic-carousel-contador" aria-live="polite">1 / ${midias.length}</span>
            ` : ''}
        </div>`;
}

function tratarFalhasDeMidia(raiz = listaSolicitacoes) {
    raiz.querySelectorAll('.solic-carousel-palco img, .solic-carousel-palco video, .solic-carousel-palco audio').forEach((elemento) => {
        elemento.addEventListener('error', () => {
            const quadro = elemento.closest('.solic-carousel-palco');
            if (!quadro || quadro.dataset.erro === 'true') return;
            quadro.dataset.erro = 'true';
            quadro.replaceChildren(Object.assign(document.createElement('span'), {
                className: 'solic-carousel-falha',
                textContent: 'Não foi possível carregar este anexo.'
            }));
        }, { once: true });
    });
}

function configurarBotoesLerMais() {
    listaSolicitacoes.querySelectorAll('.peca-desc').forEach((descricao) => {
        const botao = descricao.nextElementSibling;
        if (!botao) return;
        const alturaLimitada = descricao.clientHeight;
        descricao.classList.add('expandida');
        const alturaCompleta = descricao.scrollHeight;
        descricao.classList.remove('expandida');
        botao.hidden = alturaCompleta <= alturaLimitada + 2;
    });
}

function navegarMidia(botao) {
    const carrossel = botao.closest('.solic-carousel');
    const id = carrossel?.dataset.solicitacaoId;
    const midias = midiasPorSolicitacao.get(id) || [];
    if (!carrossel || midias.length < 2) return;

    const atual = Number(carrossel.dataset.indiceMidia) || 0;
    const passo = botao.dataset.midiaNav === 'proximo' ? 1 : -1;
    const proximo = (atual + passo + midias.length) % midias.length;
    const palco = carrossel.querySelector('.solic-carousel-palco');
    carrossel.dataset.indiceMidia = String(proximo);
    palco.dataset.erro = 'false';
    palco.innerHTML = renderizarMidiaAtiva(midias[proximo]);
    carrossel.querySelector('.solic-carousel-contador').textContent = `${proximo + 1} / ${midias.length}`;
    tratarFalhasDeMidia(carrossel);
}

function renderizarSolicitacao(solicitacao) {
    const cliente = solicitacao.cliente || {};
    const categoria = solicitacao.categoria || {};
    const idCliente = String(cliente._id || solicitacao.idCliente || '');
    const nomeCliente = cliente.nome || solicitacao.solicitante || 'Cliente';
    const endereco = [
        solicitacao.rua,
        solicitacao.referencia,
        solicitacao.cep ? `CEP ${solicitacao.cep}` : '',
        solicitacao.cidade
    ].filter(Boolean).join(' · ');

    return `
        <article class="solic-card" data-solicitacao-id="${escaparAtributo(solicitacao._id)}">
            <div class="solic-header">
                <div class="cliente-nome"><i class="fas fa-user-circle" aria-hidden="true"></i> ${escaparHTML(nomeCliente)}</div>
                <time class="data-solic" datetime="${escaparAtributo(solicitacao.data || '')}">${escaparHTML(formatarData(solicitacao.data))}</time>
            </div>
            <span class="categoria-badge">${escaparHTML(categoria.nome || 'Categoria não informada')}</span>
            <h2 class="solic-peca">${escaparHTML(solicitacao.peca || 'Peça solicitada')}</h2>
            <div class="solic-midias">${formatarMidia(solicitacao.arquivos, solicitacao._id)}</div>
            <div class="solic-descricao-wrap">
                <p class="peca-desc">${escaparHTML(solicitacao.descricao || 'Sem detalhes adicionais.')}</p>
                <button type="button" class="btn-ler-mais" data-acao="ler-mais" aria-expanded="false" hidden>Ler mais</button>
            </div>
            <p class="solic-endereco"><i class="fas fa-location-dot" aria-hidden="true"></i> ${escaparHTML(endereco || 'Local de entrega não informado')}</p>
            <div class="solic-acoes">
                <button type="button" class="btn-mensagem" data-acao="mensagem"
                    data-id-cliente="${escaparAtributo(idCliente)}"
                    data-nome-cliente="${escaparAtributo(nomeCliente)}"
                    data-id-solicitacao="${escaparAtributo(solicitacao._id)}">
                    <i class="fas fa-comment-dots" aria-hidden="true"></i> Mandar Mensagem
                </button>
                <button type="button" class="btn-assumir" data-acao="assumir" data-id-solicitacao="${escaparAtributo(solicitacao._id)}">
                    <i class="fas fa-handshake" aria-hidden="true"></i> Esse pedido já é meu
                </button>
            </div>
        </article>`;
}

function renderizarLista() {
    const termo = normalizarTexto(campoBusca.value.trim());
    const categoriaSelecionada = normalizarTexto(filtroCategoria.value);
    const filtradas = solicitacoesAbertas.filter((solicitacao) => {
        const cliente = solicitacao.cliente?.nome || solicitacao.solicitante || '';
        const categoria = solicitacao.categoria?.nome || '';
        const campos = [solicitacao.peca, solicitacao.descricao, cliente, categoria, solicitacao.cidade, solicitacao.cep];
        const correspondeTexto = !termo || campos.some((valor) => normalizarTexto(valor).includes(termo));
        const correspondeCategoria = !categoriaSelecionada || normalizarTexto(categoria) === categoriaSelecionada;
        return correspondeTexto && correspondeCategoria;
    });

    midiasPorSolicitacao.clear();
    listaSolicitacoes.innerHTML = filtradas.map(renderizarSolicitacao).join('');
    tratarFalhasDeMidia();
    configurarBotoesLerMais();
    if (filtradas.length) {
        estadoSolicitacoes.textContent = `${filtradas.length} solicitação(ões) disponível(is).`;
    } else if (termo || categoriaSelecionada) {
        estadoSolicitacoes.textContent = 'Nenhuma solicitação corresponde à pesquisa.';
    } else {
        estadoSolicitacoes.textContent = 'Não há solicitações abertas no momento.';
    }
}

async function carregarCategorias() {
    try {
        const resposta = await apiFetch(`${API_URL}/categorias`);
        const dados = await resposta.json().catch(() => ({}));
        if (!resposta.ok) throw new Error(dados.error || `Falha ao carregar categorias (HTTP ${resposta.status}).`);

        const categorias = Array.isArray(dados.categorias) ? dados.categorias : [];
        const opcoes = categorias
            .filter((categoria) => categoria && categoria.nome)
            .map((categoria) => {
                const opcao = document.createElement('option');
                opcao.value = categoria.nome;
                opcao.textContent = categoria.nome;
                return opcao;
            });
        filtroCategoria.replaceChildren(new Option('Todos...', ''), ...opcoes);
    } catch (erro) {
        console.error('Erro ao carregar categorias:', erro);
    }
}

async function carregarSolicitacoesAbertas() {
    const sessao = lerSessaoLoja();
    if (!tokenLoja || sessao.tipo !== 'loja') {
        estadoSolicitacoes.textContent = 'Entre com uma conta de loja para acessar as solicitações.';
        listaSolicitacoes.replaceChildren();
        return;
    }

    try {
        const resposta = await apiFetch(`${API_URL}/solicitacoes/abertas`, {
            headers: { Authorization: `Bearer ${tokenLoja}` }
        });
        const dados = await resposta.json().catch(() => ({}));
        if (!resposta.ok) throw new Error(dados.error || `Falha ao carregar solicitações (HTTP ${resposta.status}).`);
        solicitacoesAbertas = Array.isArray(dados.solicitacoes) ? dados.solicitacoes : [];
        renderizarLista();
    } catch (erro) {
        console.error('Erro ao carregar solicitações do MongoDB:', erro);
        listaSolicitacoes.replaceChildren();
        estadoSolicitacoes.textContent = erro.message || 'Erro ao carregar solicitações.';
    }
}

campoBusca.addEventListener('input', renderizarLista);
filtroCategoria.addEventListener('change', renderizarLista);

listaSolicitacoes.addEventListener('click', async (evento) => {
    const botaoMidia = evento.target.closest('button[data-midia-nav]');
    if (botaoMidia) {
        navegarMidia(botaoMidia);
        return;
    }

    const botao = evento.target.closest('button[data-acao]');
    if (!botao) return;

    if (botao.dataset.acao === 'ler-mais') {
        const descricao = botao.previousElementSibling;
        const expandida = descricao.classList.toggle('expandida');
        botao.textContent = expandida ? 'Ler menos' : 'Ler mais';
        botao.setAttribute('aria-expanded', String(expandida));
        return;
    }

    if (botao.dataset.acao === 'mensagem') {
        const pecaSolicitada = botao.closest('.solic-card')?.querySelector('.solic-peca')?.textContent.trim() || 'a peça solicitada';
        const idSolicitacao = String(botao.dataset.idSolicitacao || '').trim();
        const mensagemInicial = `Olá! Vi sua solicitação sobre o item "${pecaSolicitada}" no mural. Sou lojista e consigo te atender. Podemos negociar?`;
        const parametros = new URLSearchParams({
            loja: botao.dataset.nomeCliente || '',
            chatCom: botao.dataset.idCliente || '',
            refSolicitacao: idSolicitacao
        });

        if (idSolicitacao && tokenLoja) {
            apiFetch(`${API_URL}/solicitacoes/${encodeURIComponent(idSolicitacao)}/contatar`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${tokenLoja}` },
                keepalive: true
            }).then(async resposta => {
                if (!resposta.ok) {
                    const erroApi = await resposta.json().catch(() => ({}));
                    console.warn('Não foi possível iniciar o aviso ao cliente:', erroApi.error || resposta.status);
                }
            }).catch(erro => {
                console.warn('Falha de conexão ao iniciar o aviso ao cliente:', erro.message);
            });
        }

        window.location.href = `mensagens.html?${parametros.toString()}&msg=${encodeURIComponent(mensagemInicial)}`;
        return;
    }

    if (botao.dataset.acao !== 'assumir') return;
    const card = botao.closest('[data-solicitacao-id]');
    const idSolicitacao = botao.dataset.idSolicitacao;
    botao.disabled = true;
    botao.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Assumindo…';

    try {
        const resposta = await apiFetch(`${API_URL}/solicitacoes/${encodeURIComponent(idSolicitacao)}/assumir`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${tokenLoja}` }
        });
        const dados = await resposta.json().catch(() => ({}));
        if (!resposta.ok) throw new Error(dados.error || 'Não foi possível assumir esta solicitação.');

        solicitacoesAbertas = solicitacoesAbertas.filter((item) => String(item._id) !== String(idSolicitacao));
        card.remove();
        renderizarLista();
    } catch (erro) {
        console.error('Erro ao assumir solicitação:', erro);
        botao.disabled = false;
        botao.innerHTML = '<i class="fas fa-handshake" aria-hidden="true"></i> Esse pedido já é meu';
        estadoSolicitacoes.textContent = erro.message || 'Falha ao assumir solicitação.';
    }
});

window.addEventListener('DOMContentLoaded', async () => {
    await carregarCategorias();
    await carregarSolicitacoesAbertas();
});
