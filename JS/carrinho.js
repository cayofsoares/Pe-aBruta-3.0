let totalGlobal = 0; 

function carregarCarrinho() {
    
    const container = document.getElementById('cart-items');
    const totalElement = document.getElementById('cart-total');
    const itens = JSON.parse(sessionStorage.getItem('carrinho')) || [];

    if (itens.length === 0) {
        container.innerHTML = `<p class="empty-msg" style="text-align:center; padding:50px; color:#555;">Seu carrinho está vazio.</p>`;
        totalElement.innerText = "R$ 0,00";
        totalGlobal = 0;
        return;
    }

    let total = 0;
    container.innerHTML = itens.map((item, index) => {
        
        let valorBruto = item.preco && item.preco.$numberDecimal ? item.preco.$numberDecimal : item.preco;
        let precoNumerico = parseFloat(valorBruto) || 0;
        let qtd = item.quantidade || 1;
        
        // MÁGICA NOVA: Calcula o subtotal daquele item específico
        let subtotalItem = precoNumerico * qtd;
        
        total += subtotalItem;

        // Formata os preços para a tela
        let precoUnitarioFormatado = precoNumerico.toFixed(2).replace('.', ',');
        let subtotalFormatado = subtotalItem.toFixed(2).replace('.', ',');

        let nomeDaLoja = item.nomeLoja || item.loja || "Loja Parceira";
        let imagemSrc = (item.imagens && item.imagens.length > 0) ? item.imagens[0] : 'https://via.placeholder.com/150';

        return `
        <div class="cart-item">
            <img src="${imagemSrc}" alt="Produto">
            <div class="item-info">
                <h3>${item.titulo}</h3>
                <p style="font-size: 11px; color: #888; text-transform: uppercase; margin-top: 3px;">${nomeDaLoja}</p>
                
                <div style="display: flex; gap: 15px; align-items: center; margin-top: 8px;">
                    <span class="price" style="font-size: 13px; color: #aaa;">Unidade: R$ ${precoUnitarioFormatado}</span>
                    <span style="font-size: 12px; color: #aaa; background: #222; padding: 2px 8px; border-radius: 4px;">Qtd: ${qtd}</span>
                </div>
                
                <!-- MOSTRANDO O SUBTOTAL DA LINHA PARA NÃO CONFUNDIR O CLIENTE -->
                <div style="margin-top: 8px;">
                    <strong style="color: #ff4d00; font-size: 16px;">Subtotal: R$ ${subtotalFormatado}</strong>
                </div>
            </div>
            <button class="remove-btn" onclick="removerItem(${index})">🗑️</button>
        </div>
        `;
    }).join('');

    totalGlobal = total;
    totalElement.innerText = total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function removerItem(index) {
    let itens = JSON.parse(sessionStorage.getItem('carrinho')) || [];
    itens.splice(index, 1);
    sessionStorage.setItem('carrinho', JSON.stringify(itens));
    carregarCarrinho();
}

function finalizarCompra() {
    if (totalGlobal <= 0) {
        alert("O seu carrinho está vazio!");
        return;
    }
    
    // 🔴 A CORREÇÃO: Pegamos a ID e o Nome do produto para o checkout não crashar!
    let itens = JSON.parse(sessionStorage.getItem('carrinho')) || [];
    if (itens.length > 0) {
        let itemPrincipal = itens[0];
        sessionStorage.setItem('checkoutId', itemPrincipal._id || itemPrincipal.id);
        sessionStorage.setItem('checkoutNome', itens.map(i => i.titulo).join(' + '));
        sessionStorage.setItem('checkoutPreco', totalGlobal.toFixed(2));
    }
    
    sessionStorage.setItem('valor_final_pagamento', totalGlobal.toFixed(2));
    window.location.href = 'checkout.html';
}

window.onload = carregarCarrinho;
