const API_URL = ['127.0.0.1', 'localhost'].includes(window.location.hostname)
    ? 'http://localhost:3000/api'
    : 'https://api.pecabruta.com.br/api';

function apiFetch(url, options = {}) {
    return fetch(url, {
        ...options,
        headers: {
            ...(options.headers || {}),
        }
    });
}

const listaLojistas = document.getElementById('lista-lojistas');
const listaHistorico = document.getElementById('lista-historico');
const statusFinanceiro = document.getElementById('status-financeiro');
const botaoAtualizar = document.getElementById('btn-atualizar');
const contadorPendentes = document.getElementById('contador-pendentes');
const contadorHistorico = document.getElementById('contador-historico');
const formatadorBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
let tokenAdmin = '';
let pedidosFinanceiros = [];

function escaparHTML(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, (caractere) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[caractere]);
}

function obterSessaoAdmin() {
    let usuario = {};
    try {
        const salvo = JSON.parse(sessionStorage.getItem('usuario') || '{}');
        usuario = salvo.user || salvo;
    } catch (erro) {
        console.warn('Sessão administrativa inválida.');
    }
    tokenAdmin = sessionStorage.getItem('token') || '';
    return usuario.isAdmin === true && Boolean(tokenAdmin);
}

function formatarDataHora(data) {
    if (!data) return 'Data não informada';
    const dataValida = new Date(data);
    if (Number.isNaN(dataValida.getTime())) return 'Data não informada';
    return dataValida.toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short'
    });
}

function obterChaveLoja(pedido) {
    const idLoja = String(pedido.lojistaId || pedido.idLoja || pedido.lojaId || '').trim().toLowerCase();
    if (idLoja) return `id:${idLoja}`;
    const nomeLoja = String(pedido.lojaDona || 'Loja sem identificação').trim().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return `nome:${nomeLoja}`;
}

function obterValorBrutoValido(pedido) {
    if (pedido.valorTotal === null || pedido.valorTotal === undefined || pedido.valorTotal === '') return null;
    const valor = Number(pedido.valorTotal);
    return Number.isFinite(valor) && valor >= 0 ? valor : null;
}

function agruparPedidosPorLoja(pedidos) {
    return pedidos.reduce((grupos, pedido) => {
        const chave = obterChaveLoja(pedido);
        let grupo = grupos.get(chave);
        if (!grupo) {
            grupo = {
                chave,
                idLoja: String(pedido.lojistaId || pedido.idLoja || pedido.lojaId || ''),
                nome: String(pedido.lojaDona || 'Loja sem identificação'),
                chavePix: String(pedido.chavePix || ''),
                pedidos: [],
                totalLiquidoCentavos: 0
            };
            grupos.set(chave, grupo);
        }
        if (!grupo.chavePix && pedido.chavePix) grupo.chavePix = String(pedido.chavePix);
        if ((!grupo.nome || grupo.nome === 'Loja sem identificação') && pedido.lojaDona) {
            grupo.nome = String(pedido.lojaDona);
        }

        const valorBruto = obterValorBrutoValido(pedido);
        const valorLiquido = valorBruto === null ? null : Number((valorBruto * 0.90).toFixed(2));
        if (valorLiquido !== null) grupo.totalLiquidoCentavos += Math.round(valorLiquido * 100);
        grupo.pedidos.push({ ...pedido, valorLiquido });
        return grupos;
    }, new Map());
}

function repasseEstaConcluido(pedido) {
    const statusApi = String(pedido.status || '').trim().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const statusRepasse = String(pedido.statusRepasse || '').trim().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return statusApi === 'repasse concluido' || statusRepasse === 'repasse concluido' || statusRepasse === 'concluido';
}

function renderizarListaPorLoja(pedidos, recipiente, historico = false) {
    if (!pedidos.length) {
        recipiente.innerHTML = historico
            ? '<div class="estado-vazio"><i class="fas fa-clock-rotate-left" aria-hidden="true"></i><h2>Nenhum repasse concluído</h2><p>Os pagamentos confirmados pelo administrador serão mantidos aqui.</p></div>'
            : '<div class="estado-vazio"><i class="fas fa-inbox" aria-hidden="true"></i><h2>Nenhum repasse aguardando</h2><p>Pedidos confirmados pelo cliente aparecerão aqui até a baixa do pagamento.</p></div>';
        return;
    }

    const grupos = [...agruparPedidosPorLoja(pedidos).values()]
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    recipiente.innerHTML = grupos.map((grupo, indice) => {
        const idPainel = `${historico ? 'historico' : 'pendente'}-painel-lojista-${indice}`;
        const pix = escaparHTML(grupo.chavePix || 'Não cadastrada');
        const linhas = grupo.pedidos
            .sort((a, b) => new Date((historico && b.dataRepasse) || b.dataCompra || 0) - new Date((historico && a.dataRepasse) || a.dataCompra || 0))
            .map((pedido) => {
                const idPedido = escaparHTML(String(pedido._id || '').slice(-8).toUpperCase());
                const nomeCliente = escaparHTML(pedido.nomeCliente || 'Cliente não identificado');
                const nomeProduto = escaparHTML(pedido.nomeProduto || 'Produto sem nome');
                const valorLiquidoTexto = pedido.valorLiquido === null
                    ? 'Valor líquido indisponível'
                    : formatadorBRL.format(pedido.valorLiquido);
                const tituloBotaoRepasse = 'Registrar que a transferência manual foi concluída';
                const seloStatus = historico
                    ? '<span class="status-recebimento status-concluido"><i class="fas fa-circle-check" aria-hidden="true"></i> Repasse Concluído</span>'
                    : '<span class="status-recebimento alerta-recebimento"><i class="fas fa-bell" aria-hidden="true"></i> Recebimento confirmado · Aguardando Repasse</span>';
                const detalheRepasse = historico
                    ? `<span class="status-repasse status-historico"><i class="fas fa-check-double" aria-hidden="true"></i> Transferência registrada em ${escaparHTML(formatarDataHora(pedido.dataRepasse))}</span>`
                    : `<span class="prazo-repasse">Recebimento confirmado em ${escaparHTML(formatarDataHora(pedido.dataRecebimentoCliente))}</span>
                       <button type="button" class="btn-confirmar-repasse" data-order-id="${escaparHTML(pedido._id || '')}"
                           title="${escaparHTML(tituloBotaoRepasse)}">
                           <i class="fas fa-check" aria-hidden="true"></i> Confirmar Pagamento
                       </button>`;
                return `
                    <article class="linha-venda">
                        <div class="venda-detalhes">
                            <span class="cliente"><i class="fas fa-user" aria-hidden="true"></i> ${nomeCliente}</span>
                            <span class="produto">${nomeProduto}${Number(pedido.quantidade) > 1 ? ` · ${Number(pedido.quantidade)} unidades` : ''}</span>
                            ${seloStatus}
                            <time datetime="${escaparHTML(pedido.dataCompra || '')}">${escaparHTML(formatarDataHora(pedido.dataCompra))}</time>
                        </div>
                        <div class="venda-repasse">
                            <strong class="valor-liquido">${escaparHTML(valorLiquidoTexto)}</strong>
                            ${historico ? detalheRepasse : `<span class="status-repasse"><i class="fas fa-circle-info" aria-hidden="true"></i> Repasse manual · confirmar fora da plataforma</span>${detalheRepasse}`}
                            <small>Pedido #${idPedido}</small>
                        </div>
                    </article>`;
            }).join('');
        const vendasSemValor = grupo.pedidos.length - grupo.pedidos.filter((pedido) => pedido.valorLiquido !== null).length;
        const avisoValor = vendasSemValor
            ? `<p class="aviso-valor">${vendasSemValor} pedido(s) sem valor válido precisam de conferência.</p>`
            : '';

        return `
            <article class="card-lojista">
                <button class="cabecalho-lojista" type="button" aria-expanded="true" aria-controls="${idPainel}">
                    <span class="identidade-lojista">
                        <span class="icone-lojista"><i class="fas fa-store" aria-hidden="true"></i></span>
                        <span class="dados-lojista">
                            <strong>${escaparHTML(grupo.nome)}</strong>
                            <small class="chave-pix">Pix: ${pix}</small>
                            <small>${grupo.pedidos.length} pedido(s) ${historico ? 'no histórico' : 'aguardando repasse'}</small>
                        </span>
                    </span>
                    <span class="total-lojista"><small>${historico ? 'Total líquido repassado' : 'Total líquido a transferir'}</small><strong>${formatadorBRL.format(grupo.totalLiquidoCentavos / 100)}</strong></span>
                    <i class="fas fa-chevron-up seta-acordeao" aria-hidden="true"></i>
                </button>
                <div class="conteudo-lojista" id="${idPainel}">
                    ${avisoValor}
                    <div class="lista-vendas">${linhas}</div>
                </div>
            </article>`;
    }).join('');
}

function renderizarPedidos(pedidos) {
    pedidosFinanceiros = pedidos;
    const pendentes = pedidos.filter((pedido) => !repasseEstaConcluido(pedido));
    const concluidos = pedidos.filter(repasseEstaConcluido);
    const gruposPendentes = [...agruparPedidosPorLoja(pendentes).values()];
    const pedidosComValor = pendentes.filter((pedido) => obterValorBrutoValido(pedido) !== null);
    const totalLiquidoCentavos = gruposPendentes.reduce((total, grupo) => total + grupo.totalLiquidoCentavos, 0);

    document.getElementById('total-pedidos').textContent = pendentes.length.toLocaleString('pt-BR');
    document.getElementById('total-lojistas').textContent = gruposPendentes.length.toLocaleString('pt-BR');
    document.getElementById('total-liquido').textContent = formatadorBRL.format(totalLiquidoCentavos / 100);
    contadorPendentes.textContent = `${pendentes.length.toLocaleString('pt-BR')} ${pendentes.length === 1 ? 'pedido' : 'pedidos'}`;
    contadorHistorico.textContent = `${concluidos.length.toLocaleString('pt-BR')} ${concluidos.length === 1 ? 'pedido' : 'pedidos'}`;

    renderizarListaPorLoja(pendentes, listaLojistas);
    renderizarListaPorLoja(concluidos, listaHistorico, true);
    statusFinanceiro.textContent = pedidosComValor.length === pendentes.length
        ? `${pendentes.length} aguardando repasse · ${concluidos.length} concluído(s) no histórico.`
        : `${pedidosComValor.length} de ${pendentes.length} pedidos pendentes têm valor válido · ${concluidos.length} concluído(s) no histórico.`;
}

async function carregarRepasses() {
    if (!obterSessaoAdmin()) {
        statusFinanceiro.textContent = 'Acesso restrito: entre com uma conta administrativa.';
        listaLojistas.innerHTML = '<div class="estado-vazio"><i class="fas fa-lock" aria-hidden="true"></i><h2>Acesso administrativo necessário</h2><a href="admin-pb-secret.html">Ir para o login administrativo</a></div>';
        listaHistorico.innerHTML = '';
        botaoAtualizar.disabled = true;
        return;
    }

    botaoAtualizar.disabled = true;
    statusFinanceiro.textContent = 'Carregando repasses pendentes e histórico…';
    listaLojistas.innerHTML = '<div class="estado-carregando"><span class="spinner"></span> Consultando pedidos com recebimento confirmado…</div>';
    listaHistorico.innerHTML = '<div class="estado-carregando"><span class="spinner"></span> Consultando histórico de repasses…</div>';
    try {
        const resposta = await apiFetch(`${API_URL}/admin/financeiro/pedidos`, {
            headers: { Authorization: `Bearer ${tokenAdmin}` }
        });
        const dados = await resposta.json().catch(() => ({}));
        if (!resposta.ok) throw new Error(dados.error || `Falha ao carregar repasses (HTTP ${resposta.status}).`);
        renderizarPedidos(Array.isArray(dados) ? dados : []);
    } catch (erro) {
        console.error('Erro ao carregar o painel financeiro:', erro);
        statusFinanceiro.textContent = erro.message || 'Não foi possível carregar os pedidos aprovados.';
        listaLojistas.innerHTML = '<div class="estado-vazio erro"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i><h2>Falha ao carregar os repasses</h2><p>Confira a conexão com o servidor e tente novamente.</p></div>';
        listaHistorico.innerHTML = '<div class="estado-vazio erro"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i><h2>Falha ao carregar o histórico</h2><p>Atualize os dados ou confira a conexão com o servidor.</p></div>';
    } finally {
        botaoAtualizar.disabled = false;
    }
}

async function confirmarRepasse(botao) {
    const idPedido = botao.dataset.orderId;
    botao.disabled = true;
    botao.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Registrando…';
    try {
        const resposta = await apiFetch(`${API_URL}/admin/pedidos/${encodeURIComponent(idPedido)}/repasse`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${tokenAdmin}` }
        });
        const dados = await resposta.json().catch(() => ({}));
        if (!resposta.ok) throw new Error(dados.error || 'Não foi possível registrar o repasse.');

        const pedidoBaixado = pedidosFinanceiros.find((pedido) => String(pedido._id) === String(idPedido));
        if (pedidoBaixado) {
            pedidoBaixado.status = dados.status || 'Repasse Concluído';
            pedidoBaixado.statusRepasse = dados.statusRepasse || 'Repasse Concluído';
            pedidoBaixado.dataRepasse = dados.dataRepasse || new Date().toISOString();
        }
        renderizarPedidos(pedidosFinanceiros);
        statusFinanceiro.textContent = 'Repasse confirmado: o pedido foi movido para o histórico e os totais pendentes foram atualizados.';
    } catch (erro) {
        botao.disabled = false;
        botao.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i> Confirmar Pagamento';
        statusFinanceiro.textContent = erro.message || 'Falha ao registrar o repasse.';
    }
}

async function tratarCliqueListaFinanceira(evento) {
    const botaoRepasse = evento.target.closest('.btn-confirmar-repasse');
    if (botaoRepasse) {
        if (!botaoRepasse.disabled) await confirmarRepasse(botaoRepasse);
        return;
    }

    const botao = evento.target.closest('.cabecalho-lojista');
    if (!botao) return;
    const painel = document.getElementById(botao.getAttribute('aria-controls'));
    const expandido = botao.getAttribute('aria-expanded') === 'true';
    botao.setAttribute('aria-expanded', String(!expandido));
    painel.hidden = expandido;
}

listaLojistas.addEventListener('click', tratarCliqueListaFinanceira);
listaHistorico.addEventListener('click', tratarCliqueListaFinanceira);

botaoAtualizar.addEventListener('click', carregarRepasses);
document.addEventListener('DOMContentLoaded', carregarRepasses);
