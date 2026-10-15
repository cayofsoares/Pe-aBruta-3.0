const API_URL = ['127.0.0.1', 'localhost'].includes(window.location.hostname) ? 'http://localhost:3000/api' : 'https://api.pecabruta.com.br/api';
function apiFetch(url, options = {}) {
    const headers = {
        ...(options.headers || {}),
    };
    return fetch(url, { ...options, headers });
}
 document.getElementById('loginForm').onsubmit = async function(e) {

            e.preventDefault();
            
            // CORREÇÃO: Envia o tipoAcesso 'cliente' para garantir o bloqueio cruzado no backend
            const dados = {
                email: document.getElementById('emailLogin').value,
                senha: document.getElementById('senhaLogin').value,
                tipoAcesso: 'cliente' 
            };

            try {
                const response = await apiFetch(`${API_URL}/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(dados)
                });

                const result = await response.json();

                if (response.ok) {
                    // PADRONIZAÇÃO DO sessionStorage
                    debugger;
                    sessionStorage.setItem('token', result.token);
                    sessionStorage.setItem('usuario', JSON.stringify(result.user));
                    sessionStorage.setItem('usuarioNome', result.user.nome);
                    sessionStorage.setItem('tipoUsuario', result.user.tipo);
                    window.location.href = 'feed.html';
                } else {
                    alert(result.error);
                }
            } catch (err) {
                console.error(err);
                alert('ERRO DE CONEXÃO: Certifique-se que o "node server.js" está rodando!');
            }
        };

        