const API_URL = 'https://pe-abruta-3-0.onrender.com/api';
const carteiraBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
let tokenLoja = '';
let carteiraEmAtualizacao = false;

function escaparHTMLCarteira(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

function valorCentavosParaBRL(valor) {
    if (valor === null || valor === undefined || !/^\d+$/.test(String(valor))) return 'Valor indisponível';
    return carteiraBRL.format(Number(valor) / 100);
}

function formatarDataVenda(valor) {
    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) return 'Data não disponível';
    return new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short'
    }).format(data);
}

function obterSessaoLoja() {
    let sessao = {};
    try {
        sessao = JSON.parse(sessionStorage.getItem('usuario') || '{}');
    } catch (erro) {
        sessao = {};
    }
    const usuario = sessao.user || sessao;
    const token = sessionStorage.getItem('token') || sessao.token || usuario.token || '';
    return { usuario, token };
}

function mostrarErroDeAcesso(mensagem) {
    document.getElementById('conteudoCarteira').hidden = true;
    const aviso = document.getElementById('wallet-access-error');
    aviso.hidden = false;
    aviso.querySelector('p').textContent = mensagem;
}

function desenharVendas(vendas) {
    const lista = document.getElementById('wallet-sales');
    if (!vendas.length) {
        lista.innerHTML = '<div class="wallet-status">Nenhuma venda pendente da sua loja hoje.</div>';
        return;
    }

    lista.innerHTML = vendas.map((venda) => {
        const aguardandoRecebimento = venda.recebidoPeloCliente !== true;
        const situacao = aguardandoRecebimento
            ? `${escaparHTMLCarteira(venda.statusEntrega)} · aguardando confirmação do cliente`
            : 'Recebimento confirmado · aguardando atualização do repasse';
        const quantidade = Number(venda.quantidade || 1);
        return `
            <article class="wallet-sale">
                <div>
                    <div class="wallet-sale-name">${escaparHTMLCarteira(venda.produto)}</div>
                    <div class="wallet-sale-meta">
                        <span>${quantidade} ${quantidade === 1 ? 'unidade' : 'unidades'}</span>
                        <span>${escaparHTMLCarteira(formatarDataVenda(venda.dataCompra))}</span>
                        <span>${situacao}</span>
                    </div>
                </div>
                <div class="wallet-sale-value">
                    <strong>${escaparHTMLCarteira(valorCentavosParaBRL(venda.valorLiquidoEstimadoCentavos))}</strong>
                    <small>líquido estimado</small>
                </div>
            </article>`;
    }).join('');
}

async function carregarCarteiraLoja() {
    if (carteiraEmAtualizacao) return;
    carteiraEmAtualizacao = true;
    const status = document.getElementById('wallet-status');
    const botao = document.getElementById('wallet-refresh');
    botao.disabled = true;
    status.textContent = 'Atualizando vendas…';

    try {
        const resposta = await fetch(`${API_URL}/loja/carteira/hoje`, {
            cache: 'no-store',
            headers: { Authorization: `Bearer ${tokenLoja}` }
        });
        const dados = await resposta.json().catch(() => ({}));
        if (!resposta.ok) {
            if (resposta.status === 401 || resposta.status === 403) {
                throw new Error('Sua sessão de lojista expirou. Entre novamente para consultar a carteira.');
            }
            throw new Error(dados.error || 'Não foi possível carregar suas vendas.');
        }

        const vendas = Array.isArray(dados.vendas) ? dados.vendas : [];
        document.getElementById('wallet-count').textContent = vendas.length.toLocaleString('pt-BR');
        document.getElementById('wallet-gross').textContent = valorCentavosParaBRL(dados.totalBrutoCentavos);
        document.getElementById('wallet-eligible').textContent = valorCentavosParaBRL(dados.totalElegivelCentavos);
        desenharVendas(vendas);
        status.textContent = `Vendas pendentes de ${escaparHTMLCarteira(dados.data || 'hoje')}.`;
        document.getElementById('wallet-updated').textContent = `Atualizado às ${new Intl.DateTimeFormat('pt-BR', {
            timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).format(new Date())}`;
    } catch (erro) {
        status.textContent = erro.message || 'Falha ao atualizar a carteira.';
        document.getElementById('wallet-sales').innerHTML = '';
    } finally {
        botao.disabled = false;
        carteiraEmAtualizacao = false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const { usuario, token } = obterSessaoLoja();
    if (!token) {
        mostrarErroDeAcesso('Faça login com a conta da sua loja para consultar as vendas.');
        return;
    }
    if (String(usuario.tipo || '').toLowerCase() !== 'loja') {
        mostrarErroDeAcesso('Esta página está disponível somente para contas de lojista.');
        return;
    }

    tokenLoja = token;
    document.getElementById('conteudoCarteira').hidden = false;
    document.getElementById('wallet-refresh').addEventListener('click', carregarCarteiraLoja);
    carregarCarteiraLoja();
    window.setInterval(carregarCarteiraLoja, 30000);
    window.addEventListener('focus', carregarCarteiraLoja);
});
