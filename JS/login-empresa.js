const API_URL = ['127.0.0.1', 'localhost'].includes(window.location.hostname)
    ? `http://${window.location.hostname}:3000/api`
    : 'https://api.pecabruta.com.br/api';
function apiFetch(url, options = {}) {
    const headers = {
        ...(options.headers || {}),
    };
    return fetch(url, { ...options, headers });
}

        function togglePass() {
            const input = document.getElementById('senha');
            input.type = input.type === 'password' ? 'text' : 'password';
        }

        document.getElementById('loginForm').onsubmit = async function(e) {
            e.preventDefault();
            const email = document.getElementById('email').value;
            const senha = document.getElementById('senha').value;
            const msgErro = document.getElementById('msgErro');

            try {
                const response = await apiFetch(`${API_URL}/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, senha })
                });

                const data = await response.json();

                if (response.ok) {
                    if (data.user?.isAdmin === true) {
                        // O administrador fará uma segunda autenticação no formulário dedicado já existente.
                        ['token', 'usuario', 'usuarioLogado', 'tipoUsuario', 'apiBaseUrl']
                            .forEach((chave) => sessionStorage.removeItem(chave));
                        window.location.href = 'admin-pb-secret.html';
                        return;
                    }

                    // O painel usa a mesma origem da API que validou este login.
                    const urlApiLogin = new URL(response.url);
                    const caminhoApi = urlApiLogin.pathname.replace(/\/login\/?$/, '');
                    sessionStorage.setItem('apiBaseUrl', `${urlApiLogin.origin}${caminhoApi}`.replace(/\/+$/, ''));

                    if (data.user && data.user.tipo === 'loja') {
                        // Salva o objeto completo para as outras páginas reconhecerem o login
                        sessionStorage.setItem('usuario', JSON.stringify(data.user));
                        
                        // Salva as chaves individuais que você já utilizava
                        sessionStorage.setItem('usuarioLogado', data.user.nome);
                        sessionStorage.setItem('tipoUsuario', data.user.tipo);
                        
                        sessionStorage.setItem('token',data.token);

                        window.location.href = 'feed.html';
                    } else {
                        msgErro.innerText = "Este portal é exclusivo para empresas.";
                        msgErro.style.display = 'block';
                    }
                } else {
                    msgErro.innerText = data.error || "E-mail ou senha incorretos.";
                    msgErro.style.display = 'block';
                }
            } catch (err) {
                msgErro.innerText = "Erro ao conectar com o servidor.";
                msgErro.style.display = 'block';
            }
        };
