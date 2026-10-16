const API_URL = 'https://pe-abruta-3-0.onrender.com/api';

function apiFetch(url, options = {}) {
    return fetch(url, {
        ...options,
        headers: {
            ...(options.headers || {}),
        }
    });
}

function apiHeaders(extra = {}) {
    return {
        ...extra
    };
}

const statusEntregaPermitidos = ['Aguardando Envio', 'Preparando', 'Enviado', 'Entregue'];
const listaPedidosElement = document.getElementById('lista-pedidos');
let tokenSessao = null;
let idDoUsuarioLogado = '';
let usuarioLogado = {};

function escaparHTML(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, (caractere) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[caractere]);
}

function lerSessao() {
    let salvo = {};
    try {
        salvo = JSON.parse(sessionStorage.getItem('usuario') || '{}');
    } catch (erro) {
        console.warn('Dados da sessão inválidos.');
    }
    usuarioLogado = salvo.user || salvo;
    tokenSessao = sessionStorage.getItem('token') || salvo.token || salvo.user?.token || null;
    idDoUsuarioLogado = String(usuarioLogado.id || usuarioLogado._id || '').trim();
}

function formatarData(data) {
    if (!data) return 'Data não informada';
    const dataValida = new Date(data);
    return Number.isNaN(dataValida.getTime()) ? 'Data não informada' : dataValida.toLocaleDateString('pt-BR');
}

function formatarValor(valor) {
    const numero = Number(valor);
    return (Number.isFinite(numero) ? numero : 0).toLocaleString('pt-BR', {
        style: 'currency', currency: 'BRL'
    });
}

function obterQuantidadePedido(pedido) {
    const quantidade = Number(pedido.quantidade);
    return Number.isSafeInteger(quantidade) && quantidade > 0 ? quantidade : 1;
}

function obterValorTotalPedido(pedido, quantidade) {
    // O backend já salva valorTotal como o subtotal agrupado (preço unitário × quantidade).
    if (pedido.valorTotal !== null && pedido.valorTotal !== undefined && pedido.valorTotal !== '') {
        const valorTotal = Number(pedido.valorTotal);
        if (Number.isFinite(valorTotal)) return valorTotal;
    }

    // Compatibilidade com respostas antigas que tragam apenas o preço unitário.
    const precoUnitario = Number(pedido.precoUnitario ?? pedido.valorUnitario ?? pedido.preco);
    return Number.isFinite(precoUnitario) ? precoUnitario * quantidade : 0;
}

function formatarEndereco(endereco = {}) {
    return [
        endereco.rua,
        endereco.numero ? `nº ${endereco.numero}` : '',
        endereco.bairro,
        endereco.cep ? `CEP ${endereco.cep}` : '',
        endereco.cidade
    ].filter(Boolean).join(', ');
}

function renderizarPedido(pedido) {
    const ehCompra = String(pedido.idCliente || '') === idDoUsuarioLogado;
    const quantidade = obterQuantidadePedido(pedido);
    const valorTotalPedido = obterValorTotalPedido(pedido, quantidade);
    const endereco = formatarEndereco(pedido.enderecoEntrega || {});
    const statusAtual = pedido.statusEntrega || 'Aguardando Envio';
    const opcoesStatus = [...statusEntregaPermitidos];
    if (!opcoesStatus.includes(statusAtual)) opcoesStatus.unshift(statusAtual);
    const imagem = pedido.imagemProduto || 'https://via.placeholder.com/80';
    const nomeProduto = escaparHTML(pedido.nomeProduto || 'Peça sem nome');
    const idPedido = escaparHTML(String(pedido._id || '').slice(0, 8).toUpperCase());
    const nomeLoja = escaparHTML(pedido.lojaDona || 'Loja');
    const nomeCliente = escaparHTML(pedido.nomeCliente || pedido.idCliente || 'Cliente não identificado');
    const statusEscapado = escaparHTML(statusAtual);
    const statusRepasseConcluido = ['concluido', 'repasse concluído'].includes(String(pedido.statusRepasse || '').toLowerCase());
    const badgeQuantidade = quantidade > 1
        ? `<span class="badge-quantidade">Quantidade: ${quantidade}</span>`
        : '';

    const identificacao = ehCompra
        ? '<span style="display:inline-block;background:#123d62;color:#9bd5ff;padding:6px 10px;border-radius:999px;font-size:11px;font-weight:800;">🛒 SUA COMPRA</span>'
        : '<span style="display:inline-block;background:#542616;color:#ffb08b;padding:6px 10px;border-radius:999px;font-size:11px;font-weight:800;">💰 SUA VENDA</span>';

    const enderecoVenda = !ehCompra ? `
        <section style="margin:14px 0;padding:13px;background:#191512;border:1px solid #50301f;border-left:3px solid #ff6a2a;border-radius:6px;">
            <strong style="display:block;color:#ffab7e;margin-bottom:6px;">Endereço de entrega do comprador</strong>
            <span style="color:#ddd;">${endereco ? escaparHTML(endereco) : 'Endereço não informado neste pedido.'}</span>
        </section>` : '';

    const controlesVenda = !ehCompra ? `
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <label for="status-${idPedido}" style="color:#aaa;font-size:12px;">Atualizar entrega:</label>
            <select id="status-${idPedido}" class="status-entrega-select" data-order-id="${escaparHTML(pedido._id)}"
                data-current-status="${statusEscapado}" style="background:#171717;color:#fff;border:1px solid #444;border-radius:5px;padding:8px;">
                ${opcoesStatus.map((status) => `<option value="${escaparHTML(status)}" ${status === statusAtual ? 'selected' : ''}>${escaparHTML(status)}</option>`).join('')}
            </select>
            <span class="status-feedback" aria-live="polite" style="font-size:12px;"></span>
            ${pedido.recebidoPeloCliente ? '<span style="color:#65e09a;font-size:12px;"><i class="fas fa-check-circle"></i> Cliente confirmou o recebimento</span>' : ''}
            <span style="color:${statusRepasseConcluido ? '#65e09a' : '#c7a77a'};font-size:12px;">
                <i class="fas ${statusRepasseConcluido ? 'fa-circle-check' : 'fa-clock'}" aria-hidden="true"></i>
                ${statusRepasseConcluido ? `Repasse concluído${pedido.dataRepasse ? ` em ${escaparHTML(formatarData(pedido.dataRepasse))}` : ''}` : 'Repasse pendente'}
            </span>
        </div>` : '';

    const botoesCompra = ehCompra ? `
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <button type="button" class="btn-contatar-lojista"
                data-order-id="${escaparHTML(pedido._id)}"
                data-store-name="${escaparHTML(pedido.lojaDona || '')}"
                data-product-name="${escaparHTML(pedido.nomeProduto || '')}"
                style="background:transparent;border:1px solid #ff4d00;color:#ff6a2a;padding:8px 12px;border-radius:5px;cursor:pointer;">
                <i class="fas fa-comment"></i> Contatar Lojista
            </button>
            ${pedido.recebidoPeloCliente
                ? '<span style="color:#65e09a;padding:8px 0;"><i class="fas fa-check"></i> Recebimento confirmado</span>'
                : `<button type="button" class="btn-confirmar-recebimento" data-order-id="${escaparHTML(pedido._id)}"
                    style="background:#00cc66;border:0;color:#111;padding:8px 12px;border-radius:5px;cursor:pointer;font-weight:700;">
                    <i class="fas fa-check"></i> Recebi o Pedido
                </button>`}
        </div>` : '';

    return `
        <article class="card-pedido" style="border:1px solid #333;border-radius:8px;padding:16px;margin-bottom:18px;background:#111;color:#eee;">
            <header style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;border-bottom:1px solid #262626;padding-bottom:12px;margin-bottom:14px;">
                <div>
                    <strong style="color:#ff6a2a;">PEDIDO #${idPedido}</strong>
                    <div style="font-size:12px;color:#888;margin-top:5px;">${escaparHTML(formatarData(pedido.dataCompra))} · ${ehCompra ? `Vendido por: ${nomeLoja}` : `Comprado por: ${nomeCliente}`}</div>
                </div>
                ${identificacao}
            </header>
            <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;">
                <img src="${escaparHTML(imagem)}" alt="${nomeProduto}" style="width:68px;height:68px;object-fit:cover;border-radius:6px;border:1px solid #333;">
                <div>
                    <h3 style="margin:0 0 6px;font-size:16px;">${nomeProduto}</h3>
                    ${badgeQuantidade}
                    <strong style="display:block;color:#fff;margin-top:${badgeQuantidade ? '8px' : '0'};">${escaparHTML(formatarValor(valorTotalPedido))}</strong>
                    <p style="margin:7px 0 0;color:#c7a77a;font-size:12px;line-height:1.4;">
                        <i class="fas fa-clock" aria-hidden="true"></i> 🚨 Previsão de entrega: O tempo de chegada varia conforme a distância do lojista até o local do seu veículo. Para alinhar o tempo exato e passar mais detalhes do problema, clique no botão Contatar Lojista.   
                    </p>
                </div>
            </div>
            ${enderecoVenda}
            <footer style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;border-top:1px solid #262626;padding-top:13px;">
                <span style="background:#292929;color:#ddd;padding:5px 9px;border-radius:4px;font-size:12px;">${statusEscapado}</span>
                ${ehCompra ? botoesCompra : controlesVenda}
            </footer>
        </article>`;
}

async function carregarPedidos() {
    lerSessao();
    if (!tokenSessao || !idDoUsuarioLogado) {
        listaPedidosElement.innerHTML = `
            <div style="text-align:center;margin-top:50px;color:#ff7777;">
                <p>Faça login para visualizar suas compras e vendas.</p>
                <a href="login.html" style="color:#ff6a2a;font-weight:bold;">Fazer Login</a>
            </div>`;
        return;
    }

    listaPedidosElement.innerHTML = '<p style="text-align:center;color:#888;">Carregando compras e vendas…</p>';
    try {
        const resposta = await apiFetch(`${API_URL}/meus-pedidos`, {
            headers: apiHeaders({ 'Authorization': `Bearer ${tokenSessao}` })
        });
        const dados = await resposta.json().catch(() => ({}));
        if (!resposta.ok) throw new Error(dados.error || `Falha ao carregar pedidos (HTTP ${resposta.status}).`);
        if (!Array.isArray(dados) || dados.length === 0) {
            listaPedidosElement.innerHTML = `
                <div style="text-align:center;margin-top:50px;color:#888;">
                    <p>Nenhuma compra ou venda encontrada.</p>
                    <a href="feed.html" style="color:#ff4d00;text-decoration:none;font-weight:bold;">IR PARA A LOJA</a>
                </div>`;
            return;
        }
        listaPedidosElement.innerHTML = dados.map(renderizarPedido).join('');
        listaPedidosElement.querySelectorAll('img').forEach((imagem) => {
            imagem.addEventListener('error', () => { imagem.src = 'https://via.placeholder.com/80'; }, { once: true });
        });
    } catch (erro) {
        console.error('Erro ao carregar compras e vendas:', erro);
        listaPedidosElement.innerHTML = `<p style="color:#ff7777;text-align:center;">${escaparHTML(erro.message || 'Erro ao carregar pedidos.')}</p>`;
    }
}

listaPedidosElement.addEventListener('change', async (evento) => {
    const seletor = evento.target.closest('.status-entrega-select');
    if (!seletor) return;
    const feedback = seletor.parentElement.querySelector('.status-feedback');
    const statusAnterior = seletor.dataset.currentStatus;
    seletor.disabled = true;
    feedback.style.color = '#aaa';
    feedback.textContent = 'Salvando…';
    try {
        const resposta = await apiFetch(`${API_URL}/pedidos/${encodeURIComponent(seletor.dataset.orderId)}/status`, {
            method: 'PUT',
            headers: apiHeaders({
                'Authorization': `Bearer ${tokenSessao}`,
                'Content-Type': 'application/json'
            }),
            body: JSON.stringify({ statusEntrega: seletor.value })
        });
        const dados = await resposta.json().catch(() => ({}));
        if (!resposta.ok) throw new Error(dados.error || 'Não foi possível atualizar o status.');
        seletor.dataset.currentStatus = seletor.value;
        feedback.style.color = '#65e09a';
        feedback.textContent = 'Status atualizado';
        setTimeout(() => { if (feedback.isConnected) feedback.textContent = ''; }, 2500);
    } catch (erro) {
        seletor.value = statusAnterior;
        feedback.style.color = '#ff7777';
        feedback.textContent = erro.message || 'Falha ao atualizar';
    } finally {
        seletor.disabled = false;
    }
});

listaPedidosElement.addEventListener('click', async (evento) => {
    const botaoContato = evento.target.closest('.btn-contatar-lojista');
    if (botaoContato) {
        botaoContato.disabled = true;
        const textoOriginal = botaoContato.innerHTML;
        botaoContato.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Abrindo conversa…';

        try {
            const resposta = await apiFetch(`${API_URL}/pedidos/${encodeURIComponent(botaoContato.dataset.orderId)}/contatar`, {
                method: 'POST',
                headers: apiHeaders({ 'Authorization': `Bearer ${tokenSessao}` })
            });
            const dados = await resposta.json().catch(() => ({}));
            if (!resposta.ok) throw new Error(dados.error || 'Não foi possível notificar o lojista.');
        } catch (erro) {
            console.error('Falha ao iniciar contato com o lojista:', erro);
        } finally {
            const parametros = new URLSearchParams({
                loja: botaoContato.dataset.storeName || '',
                pedidoId: botaoContato.dataset.orderId || '',
                produto: botaoContato.dataset.productName || ''
            });
            window.location.href = `mensagens.html?${parametros.toString()}`;
            botaoContato.disabled = false;
            botaoContato.innerHTML = textoOriginal;
        }
        return;
    }

    const botao = evento.target.closest('.btn-confirmar-recebimento');
    if (!botao) return;
    botao.disabled = true;
    const textoOriginal = botao.innerHTML;
    botao.textContent = 'Confirmando…';
    try {
        const resposta = await apiFetch(`${API_URL}/pedidos/${encodeURIComponent(botao.dataset.orderId)}/confirmar-recebimento`, {
            method: 'POST',
            headers: apiHeaders({ 'Authorization': `Bearer ${tokenSessao}` })
        });
        const dados = await resposta.json().catch(() => ({}));
        if (!resposta.ok) throw new Error(dados.error || 'Não foi possível confirmar o recebimento.');
        botao.outerHTML = '<span style="color:#65e09a;padding:8px 0;"><i class="fas fa-check"></i> Recebimento confirmado</span>';
    } catch (erro) {
        botao.disabled = false;
        botao.innerHTML = textoOriginal;
        alert(erro.message || 'Falha ao confirmar o recebimento.');
    }
});

window.onload = carregarPedidos;
