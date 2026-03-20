function login() {
    const user = document.getElementById("user").value;
    const pass = document.getElementById("pass").value;

    if (user === "admin" && pass === "admin123") {
        localStorage.setItem("perfil", "admin");
        window.location = "admin.html";
    } else if (user === "usuario" && pass === "123") {
        localStorage.setItem("perfil", "user");
        window.location = "dashboard.html";
    } else {
        document.getElementById("msg").innerText = "Login inválido";
    }
}
