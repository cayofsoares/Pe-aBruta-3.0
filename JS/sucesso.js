window.onload = function() {
    // 1. Resgata os dados do produto da sessão atual
    const idProduto = sessionStorage.getItem('checkoutId');
    const nomeProduto = sessionStorage.getItem('checkoutNome');
    let precoProduto = sessionStorage.getItem('checkoutPreco');

    // Se não houver produto, manda de volta para o feed
    if (!idProduto) {
        window.location.href = 'feed.html';
        return;
    }

    // 2. Preenche o ecrã com os dados da peça comprada
    document.getElementById('sucessoNomeProduto').textContent = nomeProduto;
    
    if (precoProduto && !isNaN(precoProduto)) {
        precoProduto = `R$ ${parseFloat(precoProduto).toFixed(2).replace('.', ',')}`;
    }
    document.getElementById('sucessoPrecoProduto').textContent = precoProduto || 'Valor não disponível';

    // 3. Esvazia o carrinho e limpa a sessão de checkout
    // O Webhook já tratou de separar o dinheiro e criar o pedido no servidor!
    sessionStorage.removeItem('checkoutId');
    sessionStorage.removeItem('checkoutNome');
    sessionStorage.removeItem('checkoutPreco');
    sessionStorage.removeItem('valor_final_pagamento');
    sessionStorage.removeItem('carrinho');
};