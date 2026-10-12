document.addEventListener('DOMContentLoaded', () => {
    const usuarioNome = sessionStorage.getItem('usuarioNome');
    const authSection = document.getElementById('auth-section');
    const nomeSidebar = document.getElementById('nomeUsuarioSidebar');

    if (usuarioNome) {
        // Atualiza a Navbar (onde eram os botões Entrar/Sou Loja)
        if (authSection) {
            authSection.innerHTML = `
                <div style="display: flex; align-items: center; gap: 12px; background: rgba(255,77,0,0.1); padding: 5px 15px; border-radius: 4px; border: 1px solid rgba(255,77,0,0.2);">
                    <span style="color: #ff4d00; font-family: 'Orbitron'; font-size: 11px; font-weight: 900; letter-spacing: 1px;">
                        <i class="fas fa-user"></i> ${usuarioNome.toUpperCase()}
                    </span>
                    <button onclick="logout()" style="background: #ff4d00; border: none; color: white; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 9px; font-weight: 900; font-family: 'Orbitron'; transition: 0.3s;">SAIR</button>
                </div>
            `;
        }
        // Atualiza a Sidebar
        if (nomeSidebar) {
            nomeSidebar.innerText = `OLÁ, ${usuarioNome.toUpperCase()}`;
        }
    }
});

function logout() {
    sessionStorage.removeItem('usuarioNome'); // Remove o nome salvo
    sessionStorage.removeItem('usuario_logado'); // Remove dados extras se houver
    window.location.href = 'feed.html'; // Manda de volta pro início
}